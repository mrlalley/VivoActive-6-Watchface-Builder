const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');
const { createServer } = require('../server');
const { generateKey, getDefaultKeyPath, validateKeyFile } = require('../lib/keygen');

let mainWindow;
let expressServer;
let serverPort;

// Initialize persistent config store
const store = new Store({
  defaults: {
    sdkBin: '',
    devKey: '',
  },
});

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

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Start the Express server with stored config
function startServer() {
  return new Promise((resolve) => {
    const cfg = {
      sdkBin: store.get('sdkBin'),
      devKey: store.get('devKey'),
      exportDir: path.join(app.getPath('documents'), 'WatchFaceBuilder', 'exported'),
      tempDir: path.join(app.getPath('temp'), 'CIQPreview'),
    };
    const expressApp = createServer(cfg);
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

// Handle IPC: save config
ipcMain.handle('settings:saveConfig', (event, config) => {
  store.set('sdkBin', config.sdkBin);
  store.set('devKey', config.devKey);
  // Schedule app relaunch after a brief delay to allow response to reach renderer
  setTimeout(() => {
    app.relaunch();
    app.exit(0);
  }, 100);
  return { success: true };
});

// Handle IPC: auto-detect SDK and dev key paths
ipcMain.handle('settings:autoDetect', () => {
  const sdkPath = detectSdkPath();
  const keyPath = getDefaultKeyPath();
  return {
    sdkBin: sdkPath || '',
    devKey: keyPath,
    sdkFound: !!sdkPath,
    keyFound: fs.existsSync(keyPath),
  };
});

// Scan for Garmin SDK installation
function detectSdkPath() {
  const appData = process.env.APPDATA;
  if (!appData) return null;

  const garminPath = path.join(appData, 'Garmin', 'ConnectIQ', 'Sdks');
  try {
    if (!fs.existsSync(garminPath)) return null;

    // Find the latest SDK version (highest version number)
    const dirs = fs.readdirSync(garminPath);
    const sdkDirs = dirs
      .filter(d => d.startsWith('connectiq-sdk-'))
      .sort((a, b) => b.localeCompare(a)); // reverse sort for latest first

    if (sdkDirs.length === 0) return null;

    const latestSdk = path.join(garminPath, sdkDirs[0], 'bin');
    if (fs.existsSync(latestSdk)) {
      return latestSdk;
    }
  } catch (err) {
    // silently fail, return null
  }
  return null;
}

// Handle IPC: generate developer key
ipcMain.handle('key:generate', async (event, options = {}) => {
  const { outputPath = null, force = false } = options;
  const resolvedPath = outputPath ? path.resolve(outputPath) : getDefaultKeyPath();

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
});

// Handle IPC: open folder in VS Code
ipcMain.handle('shell:openVSCode', async (event, folderPath) => {
  try {
    await shell.openExternal(`vscode://file/${folderPath}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// App lifecycle
app.on('ready', async () => {
  await startServer();
  createWindow();
  createMenu();

  // Show Settings if config is incomplete
  if (!hasCompleteConfig()) {
    mainWindow.webContents.send('settings:showOverlay');
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
