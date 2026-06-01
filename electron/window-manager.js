// Window management: create and manage the main BrowserWindow

const { BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

function createWindowManager(serverUrl, healthPolling, log) {
  let mainWindow = null;

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
    if (fs.existsSync(iconPath)) {
      windowConfig.icon = iconPath;
    }

    mainWindow = new BrowserWindow(windowConfig);
    healthPolling.setMainWindow(mainWindow);

    // Pause health polling while the window is out of focus or minimized.
    // start* is idempotent (guarded by healthPollInterval); stop* is safe to call redundantly.
    mainWindow.on('focus', healthPolling.startHealthPolling);
    mainWindow.on('show', healthPolling.startHealthPolling); // restore from tray / un-minimize
    mainWindow.on('blur', healthPolling.stopHealthPolling);
    mainWindow.on('minimize', healthPolling.stopHealthPolling);
    mainWindow.on('hide', healthPolling.stopHealthPolling); // hide-to-tray
    mainWindow.on('closed', () => {
      healthPolling.stopHealthPolling(); // prevent interval surviving after window is destroyed
      mainWindow = null;
    });

    // Load the app from localhost — waitForServer() ensures it is ready before this runs.
    mainWindow.loadURL(serverUrl);

    // CSP violation logger — Chromium reports blocked resources as console errors
    // containing the string "Content Security Policy". Captured here and logged via pino.
    // Updated for Electron 42 which passes a single event object with properties:
    // https://electronjs.org/docs/latest/api/web-contents#event-console-message
    mainWindow.webContents.on('console-message', (event) => {
      // Extract properties from the event object (Electron 42 API)
      const level = event.level ?? -1;
      const message = event.message ?? '';
      const line = event.line ?? event.lineNumber ?? 0;
      const sourceId = event.sourceId ?? '';

      if (message && (message.includes('Content Security Policy') || message.includes('content-security-policy'))) {
        log.warn({
          event: 'csp.violation',
          message: message.trim(),
          line,
          sourceId: sourceId || '(unknown)',
        });
      }
    });

    // Open DevTools only if explicitly requested via OPEN_DEVTOOLS flag.
    // F12 and Ctrl+Shift+I shortcuts always work (not blocked).
    if (process.env.OPEN_DEVTOOLS === '1') {
      mainWindow.webContents.openDevTools();
    }
  }

  function getMainWindow() {
    return mainWindow;
  }

  function setMainWindow(win) {
    mainWindow = win;
  }

  return {
    createWindow,
    getMainWindow,
    setMainWindow,
  };
}

module.exports = {
  createWindowManager,
};
