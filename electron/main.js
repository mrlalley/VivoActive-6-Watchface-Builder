// Load environment variables from .env file (if present)
require('dotenv').config();

const { app, BrowserWindow, Menu, ipcMain, dialog, shell, session } = require('electron');
const { spawn } = require('child_process');
const crypto = require('crypto');
const http  = require('http');
const path  = require('path');
const fs    = require('fs');
const os    = require('os');
const { default: Store } = require('electron-store');
const { generateKey, getDefaultKeyPath, validateKeyFile } = require('../lib/keygen');
const { scanForLatestSdk } = require('../lib/config');
const { createLogger } = require('../lib/logger');

// Module-level logger — available before app.ready.
// LOG_FILE_PATH is resolved in app.on('ready') via app.getPath('logs').
const log = createLogger('main');

let mainWindow;
let serverProcess = null;

// Generated once per Electron session. Never persisted to disk. Never logged.
// Injected into server.js child process via WFB_SESSION_TOKEN env var.
// Forwarded to the renderer via the 'get-session-token' IPC channel (preload holds it in closure).
const SESSION_TOKEN = crypto.randomBytes(32).toString('hex');

// Resolved in app.on('ready') via app.getPath('logs') — not available at module load time.
let LOG_FILE_PATH = null;

/**
 * Wrap an ipcMain.handle() registration with structured logging.
 * Logs every invoke start, success, and failure with channel name and duration.
 * @param {string} channel
 * @param {Function} handler - async (event, payload) => result
 */
function loggedHandle(channel, handler) {
  ipcMain.handle(channel, async (event, payload) => {
    const ipcLog  = log.child({ channel });
    const startMs = Date.now();
    ipcLog.debug({ event: 'ipc.invoke.start' });
    try {
      const result = await handler(event, payload);
      ipcLog.debug({ event: 'ipc.invoke.success', durationMs: Date.now() - startMs });
      return result;
    } catch (err) {
      ipcLog.error({ event: 'ipc.invoke.failure', message: err.message, durationMs: Date.now() - startMs });
      throw err;
    }
  });
}

// Port is fixed so the health gate and renderer URL are known before spawn completes.
// Override with WFB_SERVER_PORT env var to avoid conflicts in test environments.
const SERVER_PORT   = parseInt(process.env.WFB_SERVER_PORT, 10) || 3000;
const SERVER_URL    = `http://127.0.0.1:${SERVER_PORT}`;
const HEALTH_URL    = `${SERVER_URL}/health`;
const MAX_WAIT_MS   = 10_000;
const POLL_INTERVAL = 200;

let healthPollInterval = null;
const HEALTH_POLL_MS = 5000;

// Initialize persistent config store
const store = new Store({
  defaults: {
    sdkBin: '',
    devKey: '',
  },
});

// Rate limiter for IPC handlers: prevents rapid-fire calls causing resource exhaustion
function withRateLimit(handlerName, handler, delayMs = 1000) {
  let lastCall = 0;
  ipcMain.handle(handlerName, async (event, ...args) => {
    const now = Date.now();
    if (now - lastCall < delayMs) {
      throw new Error(`Rate limited: please wait ${Math.ceil((delayMs - (now - lastCall)) / 1000)}s before retrying`);
    }
    lastCall = now;
    return handler(event, ...args);
  });
}

// Helper to resolve binary paths in both dev and packaged modes
function resolveBinaryPath(relativePath) {
  if (process.env.ELECTRON_IS_DEV) {
    // Dev mode: path relative to project root
    return path.join(__dirname, '..', relativePath);
  } else {
    // Packaged mode (ASAR): unpacked binaries are in app.asar.unpacked/
    return path.join(process.resourcesPath, 'app.asar.unpacked', relativePath);
  }
}

// Create and show the main window
function createWindow() {
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.ico');
  const windowConfig = {
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  };

  // Only set icon if it exists
  const fs = require('fs');
  if (fs.existsSync(iconPath)) {
    windowConfig.icon = iconPath;
  }

  mainWindow = new BrowserWindow(windowConfig);

  // Pause health polling while the window is out of focus or minimized.
  // start* is idempotent (guarded by healthPollInterval); stop* is safe to call redundantly.
  mainWindow.on('focus',    startHealthPolling);
  mainWindow.on('show',     startHealthPolling); // restore from tray / un-minimize
  mainWindow.on('blur',     stopHealthPolling);
  mainWindow.on('minimize', stopHealthPolling);
  mainWindow.on('hide',     stopHealthPolling);  // hide-to-tray
  mainWindow.on('closed',   () => {
    stopHealthPolling(); // prevent interval surviving after window is destroyed
    mainWindow = null;
  });

  // Load the app from localhost — waitForServer() ensures it is ready before this runs.
  mainWindow.loadURL(SERVER_URL);

  // CSP violation logger — Chromium reports blocked resources as console errors
  // containing the string "Content Security Policy". Captured here and logged via pino.
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    if (message.includes('Content Security Policy') || message.includes('content-security-policy')) {
      log.warn({
        event:    'csp.violation',
        message:  message.trim(),
        line,
        sourceId: sourceId || '(unknown)',
      });
    }
  });

  // Open DevTools in dev mode
  if (process.env.ELECTRON_IS_DEV) {
    mainWindow.webContents.openDevTools();
  } else {
    // Block DevTools shortcuts in production
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.control && input.shift && input.key.toLowerCase() === 'i') event.preventDefault();
      if (input.key === 'F12') event.preventDefault();
    });
  }
}

// Spawn server.js as a managed child process.
// In Electron's main process, process.execPath is the Electron binary, which runs
// Node.js scripts directly. Outside Electron, WFB_NODE_PATH or 'node' is used.
function startServer() {
  const nodeBin = process.type === 'browser'
    ? process.execPath
    : (process.env.WFB_NODE_PATH || 'node');

  // Resolve platform-specific paths here (app.getPath() is unavailable in the child
  // process) and pass them as env vars. lib/config.js reads these at fallback level 2.
  const env = {
    ...process.env,
    WFB_SERVER_PORT:    String(SERVER_PORT),
    WFB_SESSION_TOKEN:  SESSION_TOKEN,        // auth token for all /api/ routes
    WFB_LOG_FILE:       LOG_FILE_PATH || '',  // log file path (empty = stdout only)
    GARMIN_EXPORT_DIR:  path.join(app.getPath('documents'), 'WatchFaceBuilder', 'exported'),
    GARMIN_TEMP_DIR:    path.join(app.getPath('temp'), 'CIQPreview'),
    GARMIN_DESIGNS_DIR: path.join(app.getPath('userData'), 'designs'),
  };
  // Only override SDK/key paths when explicitly configured; allow auto-detect otherwise.
  if (store.get('sdkBin')) env.GARMIN_SDK_BIN = store.get('sdkBin');
  if (store.get('devKey')) env.GARMIN_DEV_KEY  = store.get('devKey');

  serverProcess = spawn(
    nodeBin,
    [path.join(__dirname, '..', 'server.js')],
    { env, stdio: 'inherit' }
  );

  serverProcess.on('exit', (code, signal) => {
    log.error({ event: 'server.exit', code, signal });
  });
}

// Poll GET /health until the server responds 200 or the deadline expires.
// The /health route is always 200 when the process is alive — distinct from
// /api/health which reflects SDK/key configuration status.
function waitForServer(timeoutMs = MAX_WAIT_MS) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;

    function poll() {
      http.get(HEALTH_URL, (res) => {
        res.resume(); // consume response body to release the socket
        if (res.statusCode === 200) return resolve();
        retry();
      }).on('error', retry);
    }

    function retry() {
      if (Date.now() >= deadline) {
        return reject(
          new Error(`server.js did not become ready within ${timeoutMs}ms`)
        );
      }
      setTimeout(poll, POLL_INTERVAL);
    }

    poll();
  });
}

// Check if config is complete
function hasCompleteConfig() {
  return store.get('sdkBin') && store.get('devKey');
}

// Check server health and send status to renderer.
// Sends x-wfb-token so /api/health auth passes when token enforcement is active.
async function checkHealth() {
  try {
    const res = await fetch(`${SERVER_URL}/api/health`, {
      headers: { 'x-wfb-token': SESSION_TOKEN },
    });
    if (res.status === 429) return; // rate-limited — skip this cycle, try again next poll
    const health = await res.json();
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('app:health-status', health);
      if (health.ok === false) { // strict: only real failures, not undefined/missing
        mainWindow.webContents.send('app:health-warning', health);
      }
    }
  } catch (err) {
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('app:health-warning', {
        ok: false,
        error: 'Server unreachable',
        message: err.message
      });
    }
  }
}

function startHealthPolling() {
  if (healthPollInterval) return; // Already polling — guard against double-start
  checkHealth(); // Immediate check so the UI sees the initial state without waiting
  healthPollInterval = setInterval(checkHealth, HEALTH_POLL_MS);
}

function stopHealthPolling() {
  if (healthPollInterval) {
    clearInterval(healthPollInterval);
    healthPollInterval = null;
  }
}

// ─── IPC handlers ──────────────────────────────────────────────────────────────
// All channels use ipcMain.handle() (request/response). No ipcMain.on().
// No synchronous IPC (event.returnValue is never used).
// Every channel here must appear in VALID_INVOKE_CHANNELS in electron/preload.js.
//
// IPC CHANNELS (renderer → main, invoke):
//   dialog:open        — show native file-open dialog
//   settings:getConfig — read sdkBin and devKey from electron-store
//   settings:saveConfig — persist sdkBin and devKey, then relaunch (rate-limited 2s)
//   settings:autoDetect — scan platform paths for SDK and dev key (rate-limited 2s)
//   key:generate        — generate RSA-4096 developer key (rate-limited 5s)
//   shell:openVSCode    — open exported project folder in VS Code
//
// IPC CHANNELS (main → renderer, send):
//   app:health-status  — SDK/key health object, every 5s while window is focused
//   app:health-warning — SDK/key health object when ok === false
//   file:newDesign     — fired by File → New Design menu item
//   settings:showOverlay — fired on startup if config incomplete, or via Ctrl+,
//   get-session-token  — one-time token fetch; preload holds result in closure

// Handle IPC: supply session token to preload (called once on renderer load).
// Returns the token string — preload stores it in a closure, never on window.
loggedHandle('get-session-token', async () => SESSION_TOKEN);

// Handle IPC: open file dialog
loggedHandle('dialog:open', async (event, options) => {
  return dialog.showOpenDialog(mainWindow, options);
});

// Handle IPC: get current config
loggedHandle('settings:getConfig', () => ({
  sdkBin: store.get('sdkBin') || '',
  devKey: store.get('devKey') || '',
}));

// Handle IPC: save config (rate-limited to prevent config thrashing)
withRateLimit('settings:saveConfig', (event, config) => {
  store.set('sdkBin', config.sdkBin);
  store.set('devKey', config.devKey);
  // Schedule app relaunch after a brief delay to allow response to reach renderer
  setTimeout(() => {
    app.relaunch();
    app.exit(0);
  }, 100);
  return { success: true };
}, 2000);

// Handle IPC: auto-detect SDK and dev key paths (rate-limited to prevent filesystem spam)
withRateLimit('settings:autoDetect', (event) => {
  const sdkPath = detectSdkPath();
  const keyPath = getDefaultKeyPath();
  return {
    sdkBin: sdkPath || '',
    devKey: keyPath,
    sdkFound: !!sdkPath,
    keyFound: fs.existsSync(keyPath),
  };
}, 2000);

// Detect Garmin SDK installation across Windows, macOS, and Linux.
// Uses platform-aware defaults from config.js and scans for latest SDK version.
function detectSdkPath() {
  const platform = process.platform;
  let basePaths = [];

  if (platform === 'win32') {
    // Windows: %APPDATA%\Garmin\ConnectIQ\Sdks\
    const appData = process.env.APPDATA;
    if (appData) {
      basePaths.push(path.join(appData, 'Garmin', 'ConnectIQ', 'Sdks'));
    }
  } else if (platform === 'darwin') {
    // macOS: ~/Library/Application Support/Garmin/ConnectIQ/Sdks/
    basePaths.push(path.join(os.homedir(), 'Library', 'Application Support', 'Garmin', 'ConnectIQ', 'Sdks'));
  } else {
    // Linux: ~/.local/share/Garmin/ConnectIQ/Sdks/ (preferred) or /opt/garmin/connectiq/sdk
    basePaths.push(path.join(os.homedir(), '.local', 'share', 'Garmin', 'ConnectIQ', 'Sdks'));
    basePaths.push('/opt/garmin/connectiq/sdk');
  }

  // Try each path in order, using scanForLatestSdk from config.js
  for (const basePath of basePaths) {
    const found = scanForLatestSdk(basePath);
    if (found) return found;
  }

  return null;
}

// Handle IPC: generate developer key (rate-limited to prevent key generation spam)
// outputPath is renderer-supplied; restrict writes to an allowlist of safe directories
// to prevent a compromised renderer from writing key material anywhere on the filesystem.
withRateLimit('key:generate', async (event, options = {}) => {
  const { outputPath = null, force = false } = options;

  // Build the allowlist once per call (app paths are stable after ready).
  // Keys may only be written inside ~/.garmin/ or the user's Documents folder.
  const allowedRoots = [
    path.resolve(path.dirname(getDefaultKeyPath())), // ~/.garmin
    path.resolve(app.getPath('documents')),           // ~/Documents (or platform equivalent)
  ];

  // Resolve the requested path (handles ../ traversal and relative paths).
  // Fall back to the canonical default when the renderer omits outputPath.
  const resolvedPath = path.resolve(outputPath || getDefaultKeyPath());

  // Reject any path that doesn't sit inside one of the allowed roots.
  const isAllowed = allowedRoots.some(root => {
    const boundary = root + path.sep;
    return resolvedPath === root || resolvedPath.startsWith(boundary);
  });

  if (!isAllowed) {
    return {
      success: false,
      error: `Key output path must be inside ${allowedRoots.join(' or ')}`,
    };
  }

  // Check if file already exists (unless force is true)
  if (!force && fs.existsSync(resolvedPath)) {
    return { success: false, exists: true, path: resolvedPath };
  }

  try {
    await generateKey(resolvedPath);
    return { success: true, path: resolvedPath };
  } catch (err) {
    return { success: false, error: err.message, path: resolvedPath };
  }
}, 5000);

// Handle IPC: open the exported project folder in VS Code.
// The renderer passes a requestId (not a path) — the main process reconstructs
// the full path from the known export directory, keeping filesystem paths out
// of the renderer context entirely.
loggedHandle('shell:openVSCode', async (event, requestId) => {
  try {
    if (typeof requestId !== 'string' || !/^[a-z0-9]+$/.test(requestId)) {
      return { success: false, error: 'Invalid requestId' };
    }

    // Construct the path entirely in the main process — never trust the renderer
    // with a full filesystem path.
    const exportDir = path.resolve(
      path.join(app.getPath('documents'), 'WatchFaceBuilder', 'exported')
    );
    const resolved = path.join(exportDir, requestId);

    // Sanity-check: resolved must still be inside exportDir (guards against
    // any edge case where path.join collapses the requestId unexpectedly).
    const boundary = exportDir + path.sep;
    if (!resolved.startsWith(boundary)) {
      return { success: false, error: 'Resolved path is outside the exports directory' };
    }

    // Build a valid vscode:// URI with forward slashes (required by VS Code's
    // protocol handler on all platforms; Windows paths become C:/… not C:\…).
    const uriPath = resolved.split(path.sep).join('/');
    await shell.openExternal(`vscode://file/${uriPath}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── Template version and SDK compatibility helpers ────────────────────────────
// These run once in app.on('ready') before the server or renderer starts.
// They are synchronous guards — the app will not load in a broken state.

const TEMPLATE_VERSION_FILE = path.join(__dirname, '..', 'garmin-project-template', 'VERSION');

/**
 * assertTemplateVersionExists()
 * Hard-exits if garmin-project-template/VERSION is missing.
 * This file is required for SDK compatibility checking.
 */
function assertTemplateVersionExists() {
  if (!fs.existsSync(TEMPLATE_VERSION_FILE)) {
    log.fatal({ event: 'startup.version_file_missing', path: TEMPLATE_VERSION_FILE });
    dialog.showErrorBox(
      'Template Version File Missing',
      'garmin-project-template/VERSION was not found.\n\n' +
      'The application cannot validate SDK compatibility.\n\n' +
      'Reinstall the application or run:\n  npm run generate-constants:force'
    );
    app.quit();
  }
}

/**
 * checkSdkCompatibility()
 * Reads the VERSION file and the installed SDK version.
 * Shows a blocking error dialog if the SDK is too old.
 * Shows a non-blocking warning dialog if the target device uses a fallback.
 */
async function checkSdkCompatibility() {
  let templateMeta;
  try {
    templateMeta = JSON.parse(fs.readFileSync(TEMPLATE_VERSION_FILE, 'utf8'));
  } catch (err) {
    log.warn({ event: 'startup.version_file_unreadable', message: err.message });
    return; // Non-fatal — generate-constants pre-script would have already warned.
  }

  // Re-use the same SDK detection logic as generate-constants.js by requiring
  // it inline here. The functions are module-level in that file so we can't
  // require() them — instead we replicate the fast path inline.
  const sdkSearchPaths = [
    process.env.GARMIN_SDK_PATH,
    process.env.CIQ_HOME,
    path.join(process.env.APPDATA || '', 'Garmin', 'ConnectIQ', 'Sdks'),
    path.join(os.homedir(), 'Library', 'Application Support', 'Garmin', 'ConnectIQ', 'Sdks'),
    path.join(os.homedir(), '.Garmin', 'ConnectIQ', 'Sdks'),
  ].filter(Boolean);

  const ciqDevicePaths = [
    path.join(process.env.APPDATA || '', 'Garmin', 'ConnectIQ', 'Devices'),
    path.join(os.homedir(), 'Library', 'Application Support', 'Garmin', 'ConnectIQ', 'Devices'),
    path.join(os.homedir(), '.Garmin', 'ConnectIQ', 'Devices'),
  ].filter(Boolean);

  // compareVersions: -1 if a < b, 0 equal, 1 if a > b
  function compareVersions(a, b) {
    const pa = String(a).split('.').map(Number);
    const pb = String(b).split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const diff = (pa[i] || 0) - (pb[i] || 0);
      if (diff !== 0) return diff > 0 ? 1 : -1;
    }
    return 0;
  }

  // Detect installed SDK version
  let sdkVersion = null;
  for (const searchPath of sdkSearchPaths) {
    if (!fs.existsSync(searchPath)) continue;
    try {
      const entries = fs.readdirSync(searchPath)
        .filter(d => d.startsWith('connectiq-sdk-'));
      for (const entry of entries) {
        const versionTxt = path.join(searchPath, entry, 'bin', 'version.txt');
        if (fs.existsSync(versionTxt)) {
          const raw = fs.readFileSync(versionTxt, 'utf8').trim();
          const m = raw.match(/^(\d+\.\d+\.\d+)/);
          if (m) { sdkVersion = m[1]; break; }
        }
        // Fallback: extract from directory name
        const m = entry.match(/(\d+\.\d+\.\d+)/);
        if (m) { sdkVersion = m[1]; break; }
      }
    } catch { /* try next */ }
    if (sdkVersion) break;
  }

  if (!sdkVersion) {
    // SDK not installed — warn but don't block (standalone mode or no SDK yet).
    log.warn({
      event:   'startup.sdk_not_found',
      message: 'Connect IQ SDK not found. Export and Preview will not work.',
    });
    return;
  }

  // Hard block: SDK too old
  if (compareVersions(sdkVersion, templateMeta.minSdkVersion) < 0) {
    log.error({
      event:        'startup.sdk_incompatible',
      installed:    sdkVersion,
      required:     templateMeta.minSdkVersion,
    });
    dialog.showErrorBox(
      'Incompatible Connect IQ SDK',
      `Installed SDK: ${sdkVersion}\n` +
      `Required:      ${templateMeta.minSdkVersion} or later\n\n` +
      `Generated watch faces will not compile correctly.\n\n` +
      `Download the correct SDK from:\n` +
      `https://developer.garmin.com/connect-iq/sdk/`
    );
    app.quit();
    return;
  }

  log.info({ event: 'startup.sdk_compatible', sdkVersion, minSdkVersion: templateMeta.minSdkVersion });

  // Device fallback warning: show once if vivoactive6 is absent
  const preferredDevice = templateMeta.targetDeviceId   || 'vivoactive6';
  const fallbackDevice  = templateMeta.fallbackDeviceId || 'venu3';

  // Read device list from CIQ Devices directory
  let deviceIds = [];
  for (const devBase of ciqDevicePaths) {
    if (!fs.existsSync(devBase)) continue;
    try {
      deviceIds = fs.readdirSync(devBase)
        .filter(d => { try { return fs.statSync(path.join(devBase, d)).isDirectory(); } catch { return false; } });
      if (deviceIds.length > 0) break;
    } catch { /* try next */ }
  }

  if (deviceIds.length > 0 && !deviceIds.includes(preferredDevice) && deviceIds.includes(fallbackDevice)) {
    log.warn({
      event:          'startup.device_fallback',
      preferred:      preferredDevice,
      fallback:       fallbackDevice,
    });
    dialog.showMessageBoxSync({
      type:    'warning',
      title:   'Device Definition Not Found',
      message: `${preferredDevice} is not in your Connect IQ SDK ${sdkVersion}.`,
      detail:
        `Using ${fallbackDevice} as a fallback for compilation.\n\n` +
        `Watch faces will compile correctly but you should update\n` +
        `garmin-project-template/manifest.xml to target ${preferredDevice}\n` +
        `once the SDK device definition is available.`,
      buttons: ['OK'],
    });
  }
}

// App lifecycle
app.on('ready', async () => {
  // Resolve log file path now that app.getPath() is available.
  // LOG_FILE_PATH is read by startServer() when building the child process env.
  LOG_FILE_PATH = path.join(
    app.getPath('logs'),
    `wfb-${new Date().toISOString().slice(0, 10)}.log`
  );

  log.info({
    event:   'app.ready',
    logFile: LOG_FILE_PATH,
    version: app.getVersion(),
  });

  // ── Template version and SDK compatibility gate ──────────────────────────
  // Must run before the server starts and before the renderer loads.
  // generate-constants.js (prestart) warns on incompatibility; this is the hard block.
  assertTemplateVersionExists();
  await checkSdkCompatibility();

  // Skip server startup during electron-builder packaging pass
  if (!process.env.PACKAGING_MODE) {
    startServer(); // spawn child process — synchronous, does not block

    // Health gate: do not load the renderer until /health returns 200.
    // If the server does not become ready within MAX_WAIT_MS, show an error and quit.
    try {
      await waitForServer();
    } catch (err) {
      dialog.showErrorBox(
        'Server failed to start',
        `server.js did not become ready:\n\n${err.message}`
      );
      app.quit();
      return;
    }
  }

  // ── Electron session CSP enforcement ────────────────────────────────────
  // The Express server already sends a nonce-based CSP header on every response.
  // This session handler is the FALLBACK enforcement layer: it adds a static CSP
  // only when the server's header is absent (e.g., devtools-originated requests,
  // chrome-extension:// pages, or future file:// loading paths).
  // It PRESERVES the server's existing CSP header (with nonce) for all renderer
  // requests — replacing it would break the nonce-based script-src mechanism.
  //
  // Static CSP (no nonce): permits 'self' scripts via 'strict-dynamic' semantics.
  // connect-src uses the resolved SERVER_URL so the explicit IP:PORT is enforced.
  const STATIC_CSP = [
    "default-src 'none'",
    "script-src 'self' 'strict-dynamic'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${SERVER_URL}`,
    "worker-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    // Preserve the server's nonce-bearing CSP header. Only inject a fallback
    // if the response has no CSP header at all.
    if (!headers['content-security-policy'] && !headers['Content-Security-Policy']) {
      headers['content-security-policy'] = [STATIC_CSP];
    }
    callback({ responseHeaders: headers });
  });

  createWindow();
  createMenu();

  // Start health polling — fires one immediate check and then every HEALTH_POLL_MS.
  // Focus/blur/minimize events in createWindow() will pause/resume the interval.
  startHealthPolling();

  // Show Settings if config is incomplete — wait for renderer to finish loading
  // before sending the IPC message, otherwise the listener isn't registered yet
  // and the message is silently dropped (webContents.send has no delivery guarantee
  // before DOMContentLoaded fires in the renderer).
  if (!hasCompleteConfig()) {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow?.webContents?.send('settings:showOverlay');
    });
  }
});

app.on('window-all-closed', () => {
  // On macOS, apps stay active until the user explicitly quits them
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Send SIGTERM to the server child process before Electron begins its own shutdown.
// This allows server.js to call server.close() and exit cleanly before the main
// process exits. On Windows, kill() sends SIGKILL — see docs/architecture.md §Known Limitations.
app.on('before-quit', () => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill('SIGTERM');
  }
});

app.on('activate', () => {
  // On macOS, re-create window when dock icon is clicked
  if (mainWindow === null) {
    createWindow();
  }
});

// Prevent navigation to external URLs and block new window creation.
// These are defence-in-depth guards complementing the CSP frame-src 'none' directive.
app.on('web-contents-created', (event, contents) => {
  contents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    if (parsedUrl.origin !== SERVER_URL) {
      event.preventDefault();
      log.warn({ event: 'navigation.blocked', attemptedUrl: navigationUrl });
    }
  });

  // Block all new window / popup creation from the renderer.
  contents.setWindowOpenHandler(({ url }) => {
    log.warn({ event: 'window.open.blocked', attemptedUrl: url });
    return { action: 'deny' };
  });
});

// Create application menu
function createMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Design',
          accelerator: 'Ctrl+N',
          click: () => {
            mainWindow?.webContents?.send('file:newDesign');
          },
        },
        {
          label: 'Settings',
          accelerator: 'Ctrl+,',
          click: () => {
            mainWindow?.webContents?.send('settings:showOverlay');
          },
        },
        { type: 'separator' },
        {
          label: 'Exit',
          accelerator: 'Ctrl+Q',
          click: () => app.quit(),
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About',
          click: () => {
            dialog.showMessageBox(mainWindow ?? null, {
              type: 'info',
              title: 'About WatchFace Builder',
              message: 'WatchFace Builder v1.0.0',
              detail: 'Garmin Vivoactive 6 Watch Face Visual Designer',
            });
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// Safety net: kill the server child process if Electron exits without triggering before-quit
// (e.g., uncaught exception in main process). before-quit is the primary cleanup path.
process.on('exit', () => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
  }
});
