// Load environment variables from .env file (if present)
require('dotenv').config();

const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { default: Store } = require('electron-store');
const { createServer } = require('../server');
const { generateKey, getDefaultKeyPath, validateKeyFile } = require('../lib/keygen');
const { scanForLatestSdk } = require('../lib/config');

let mainWindow;
let expressServer;
let serverPort;

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

  // Load the app from localhost once Express is ready
  mainWindow.loadURL(`http://127.0.0.1:${serverPort}`);

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

// Start the Express server with stored config.
// Uses electron-store values if available, otherwise auto-detects or uses platform defaults.
function startServer() {
  return new Promise((resolve) => {
    const cfg = {
      sdkBin: store.get('sdkBin'),
      devKey: store.get('devKey'),
      exportDir: path.join(app.getPath('documents'), 'WatchFaceBuilder', 'exported'),
      tempDir: path.join(app.getPath('temp'), 'CIQPreview'),
    };

    // Pass detector functions to config layer for platform-aware auto-detection
    const detectors = {
      detectSdkPath: detectSdkPath,
      getDefaultKeyPath: getDefaultKeyPath,
    };

    const expressApp = createServer(cfg, detectors);
    expressServer = expressApp.listen(0, '127.0.0.1', () => {
      const addr = expressServer.address();
      serverPort = addr.port;
      console.log(`[Express] listening on http://127.0.0.1:${serverPort}`);
      resolve();
    });
  });
}

// Check if config is complete
function hasCompleteConfig() {
  return store.get('sdkBin') && store.get('devKey');
}

// Check server health and send status to renderer
async function checkHealth() {
  try {
    const res = await fetch(`http://127.0.0.1:${serverPort}/api/health`);
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

// Handle IPC: open file dialog
ipcMain.handle('dialog:open', async (event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, options);
  return result;
});

// Handle IPC: get current config
ipcMain.handle('settings:getConfig', () => {
  return {
    sdkBin: store.get('sdkBin') || '',
    devKey: store.get('devKey') || '',
  };
});

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
ipcMain.handle('shell:openVSCode', async (event, requestId) => {
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

// App lifecycle
app.on('ready', async () => {
  // Skip server startup during packaging
  if (!process.env.PACKAGING_MODE) {
    await startServer();
  }
  createWindow();
  createMenu();

  // Start health polling — fires one immediate check and then every HEALTH_POLL_MS.
  // Focus/blur/minimize events in createWindow() will pause/resume the interval.
  if (serverPort) {
    startHealthPolling();
  }

  // Show Settings if config is incomplete — wait for renderer to finish loading
  // before sending the IPC message, otherwise the listener isn't registered yet
  // and the message is silently dropped (webContents.send has no delivery guarantee
  // before DOMContentLoaded fires in the renderer).
  if (!hasCompleteConfig()) {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow?.webContents.send('settings:showOverlay');
    });
  }
});

app.on('window-all-closed', () => {
  // On macOS, apps stay active until the user explicitly quits them
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On macOS, re-create window when dock icon is clicked
  if (mainWindow === null) {
    createWindow();
  }
});

// Prevent navigation to external URLs
app.on('web-contents-created', (event, contents) => {
  contents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    if (parsedUrl.origin !== 'http://127.0.0.1:' + serverPort) {
      event.preventDefault();
    }
  });

  // Disable opening new windows
  contents.setWindowOpenHandler(({ url }) => {
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
            mainWindow.webContents.send('file:newDesign');
          },
        },
        {
          label: 'Settings',
          accelerator: 'Ctrl+,',
          click: () => {
            mainWindow.webContents.send('settings:showOverlay');
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
            dialog.showMessageBox(mainWindow, {
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

// Cleanup on exit
process.on('exit', () => {
  if (expressServer) {
    expressServer.close();
  }
});
