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
const { detectSdk, SdkNotFoundError } = require('../lib/sdk-detect');
const { createLogger } = require('../lib/logger');
const { registerIpcHandlers } = require('../src/main/ipc/handlers');
const { createLoggedHandle, createRateLimitHandler } = require('./ipc-helpers');
const { createHealthPollingManager } = require('./health-polling');
const { createWindowManager } = require('./window-manager');
const { createServerManager } = require('./server-manager');

// Module-level logger — available before app.ready.
// LOG_FILE_PATH is resolved in app.on('ready') via app.getPath('logs').
const log = createLogger('main');

let mainWindow;

// Generated once per Electron session. Never persisted to disk. Never logged.
// Injected into server.js child process via WFB_SESSION_TOKEN env var.
// Forwarded to the renderer via the 'get-session-token' IPC channel (preload holds it in closure).
const SESSION_TOKEN = crypto.randomBytes(32).toString('hex');

// Resolved in app.on('ready') via app.getPath('logs') — not available at module load time.
let LOG_FILE_PATH = null;

// IPC helpers created from module factories
const loggedHandle = createLoggedHandle(ipcMain, log);
const withRateLimit = createRateLimitHandler(ipcMain);

// Port is fixed so the health gate and renderer URL are known before spawn completes.
// Override with WFB_SERVER_PORT env var to avoid conflicts in test environments.
const SERVER_PORT   = parseInt(process.env.WFB_SERVER_PORT, 10) || 3000;
const SERVER_URL    = `http://127.0.0.1:${SERVER_PORT}`;
const HEALTH_URL    = `${SERVER_URL}/internal/healthz`;  // Liveness probe (unauthenticated)
const MAX_WAIT_MS   = 10_000;
const POLL_INTERVAL = 200;

// Health polling manager will be created in app.ready
let healthPollingManager = null;


// Initialize persistent config store
const store = new Store({
  defaults: {
    sdkBin: '',
    devKey: '',
  },
});

// Rate limiter for IPC handlers: prevents rapid-fire calls causing resource exhaustion

// Initialize all IPC handlers with injected dependencies
function initializeIpcHandlers() {
  registerIpcHandlers({
    ipcMain,
    dialog,
    app,
    shell,
    fs,
    path,
    store,
    generateKey,
    getDefaultKeyPath,
    detectSdkPath,
    loggedHandle,
    withRateLimit,
    SESSION_TOKEN,
    mainWindow,
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

// Window manager will be created in app.ready
let windowManager = null;

// Server manager will be created in app.ready
let serverManager = null;

// Check if config is complete
function hasCompleteConfig() {
  return store.get('sdkBin') && store.get('devKey');
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

// Initialize all IPC handlers (invoke + send channels)
// This must be called before the app is ready so handlers are registered when
// the renderer loads. Handler implementations are in src/main/ipc/handlers.js.
initializeIpcHandlers();

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

  // SDK detection delegated to lib/sdk-detect.js — single source of truth.
  let sdk;
  try {
    sdk = await detectSdk();
  } catch (err) {
    if (err instanceof SdkNotFoundError) {
      log.warn({ event: 'startup.sdk_not_found', searched: err.searchedPaths });
      return; // Non-fatal — warn and continue; export/preview will surface the error.
    }
    throw err;
  }

  const { sdkVersion, deviceIds } = sdk;
  const { compareVersions } = require('../lib/sdk-detect');

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

  // Create manager instances
  serverManager = createServerManager(SERVER_PORT, SERVER_URL, SESSION_TOKEN, LOG_FILE_PATH, store, log);
  healthPollingManager = createHealthPollingManager(SERVER_URL, SESSION_TOKEN, log);

  // Skip server startup during electron-builder packaging pass
  if (!process.env.PACKAGING_MODE) {
    serverManager.startServer(); // spawn child process — synchronous, does not block

    // Health gate: do not load the renderer until /health returns 200.
    // If the server does not become ready within MAX_WAIT_MS, show an error and quit.
    try {
      await serverManager.waitForServer();
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
  // Static CSP (no nonce): fallback for responses without server CSP header.
  // Enforces strict security when the HTTP layer header is absent (defense-in-depth).
  // CRITICAL: connect-src is restricted to the local server ONLY. Do not add
  // wildcards, external origins, or broad schemes here. See CLAUDE.md for the
  // contract: any new outbound connection must be added to BOTH server.js CSP
  // header AND this STATIC_CSP constant, with explicit justification.
  const STATIC_CSP = [
    "default-src 'none'",
    "script-src 'self' 'strict-dynamic'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${SERVER_URL}`,  // ONLY the local Electron server, e.g. http://127.0.0.1:3000
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

  // Create window manager and create the main window
  windowManager = createWindowManager(SERVER_URL, healthPollingManager, log);
  windowManager.createWindow();
  mainWindow = windowManager.getMainWindow();

  createMenu();

  // Start health polling — fires one immediate check and then every HEALTH_POLL_MS.
  // Focus/blur/minimize events in createWindow() will pause/resume the interval.
  healthPollingManager.startHealthPolling();

  // Show Settings if config is incomplete — wait for renderer to finish loading
  // Note: Settings can be accessed via File > Settings menu or Ctrl+, keyboard shortcut.
  // Auto-opening is disabled to avoid interrupting workflow on startup.
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
  if (serverManager) {
    serverManager.killServer();
  }
});

app.on('activate', () => {
  // On macOS, re-create window when dock icon is clicked
  if (mainWindow === null && windowManager) {
    windowManager.createWindow();
    mainWindow = windowManager.getMainWindow();
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
      label: 'View',
      submenu: [
        {
          label: 'Toggle Developer Tools',
          accelerator: 'F12',
          click: () => {
            mainWindow?.webContents?.toggleDevTools();
          },
        },
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

// Safety net: delegate cleanup through serverManager if Electron exits without before-quit
// (e.g., uncaught exception in main process). before-quit is the primary cleanup path.
process.on('exit', () => {
  serverManager?.killServer();
});
