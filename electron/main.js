const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const path = require('path');
const { createServer } = require('../server');

let mainWindow;
let expressServer;
let serverPort;

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
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Start the Express server and wait for it to be listening
function startServer() {
  return new Promise((resolve) => {
    const expressApp = createServer();
    expressServer = expressApp.listen(0, '127.0.0.1', () => {
      const addr = expressServer.address();
      serverPort = addr.port;
      console.log(`[Express] listening on http://127.0.0.1:${serverPort}`);
      resolve();
    });
  });
}

// Handle IPC: open file dialog
ipcMain.handle('dialog:open', async (event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, options);
  return result;
});

// App lifecycle
app.on('ready', async () => {
  await startServer();
  createWindow();
  createMenu();
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
          label: 'Settings',
          accelerator: 'Ctrl+,',
          click: () => {
            // TODO: In Phase 4, open Settings window or overlay
            console.log('[Menu] Settings clicked');
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
