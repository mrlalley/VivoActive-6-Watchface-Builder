const { contextBridge, ipcRenderer } = require('electron');

// Expose a minimal, safe API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Return the port the Express server is listening on
  getPort: async () => {
    const params = new URLSearchParams(window.location.search);
    return params.get('port') || null;
  },

  // Open a file dialog and return the result
  openFileDialog: (options) => {
    return ipcRenderer.invoke('dialog:open', options);
  },

  // Settings IPC
  getConfig: () => ipcRenderer.invoke('settings:getConfig'),
  saveConfig: (config) => ipcRenderer.invoke('settings:saveConfig', config),
  onSettingsShow: (callback) => ipcRenderer.on('settings:showOverlay', callback),

  // Return the platform (win32, darwin, linux)
  platform: process.platform,
});
