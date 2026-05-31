const { contextBridge, ipcRenderer } = require('electron');

// Track all persistent .on() listeners so they can be removed in cleanup().
// This prevents listener accumulation if the renderer reloads within the same
// Electron window (e.g. webContents.reload() rather than app.relaunch()).
const _listeners = [];

function _on(channel, callback) {
  ipcRenderer.on(channel, callback);
  _listeners.push({ channel, callback });
}

// Expose a minimal, safe API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Open a file dialog and return the result
  openFileDialog: (options) => {
    return ipcRenderer.invoke('dialog:open', options);
  },

  // Settings IPC
  getConfig: () => ipcRenderer.invoke('settings:getConfig'),
  saveConfig: (config) => ipcRenderer.invoke('settings:saveConfig', config),
  autoDetect: () => ipcRenderer.invoke('settings:autoDetect'),

  // .once(): main sends this exactly once after did-finish-load per context.
  // Auto-removes itself after firing — no cleanup entry needed.
  onSettingsShow: (callback) => ipcRenderer.once('settings:showOverlay', callback),

  // .on(): user can trigger "New Design" from the menu multiple times per session.
  onNewDesign: (callback) => _on('file:newDesign', callback),

  // .on(): fires continuously during health polling for the lifetime of the window.
  onHealthStatus:  (callback) => _on('app:health-status',  callback),
  onHealthWarning: (callback) => _on('app:health-warning', callback),

  // Remove all persistent listeners registered via _on().
  // Call this in the renderer's beforeunload handler to prevent accumulation
  // if the page reloads within the same Electron window.
  cleanup: () => {
    _listeners.forEach(({ channel, callback }) => {
      ipcRenderer.removeListener(channel, callback);
    });
    _listeners.length = 0;
  },

  // Open VS Code with a folder
  openInVSCode: (folderPath) => ipcRenderer.invoke('shell:openVSCode', folderPath),

  // Generate a new developer key
  generateDevKey: (options) => ipcRenderer.invoke('key:generate', options),

  // Return the platform (win32, darwin, linux)
  platform: process.platform,
});
