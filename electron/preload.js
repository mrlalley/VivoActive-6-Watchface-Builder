const { contextBridge, ipcRenderer } = require('electron');

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
  onSettingsShow: (callback) => ipcRenderer.on('settings:showOverlay', callback),

  // File menu events
  onNewDesign: (callback) => ipcRenderer.on('file:newDesign', callback),

  // Open VS Code with a folder
  openInVSCode: (folderPath) => ipcRenderer.invoke('shell:openVSCode', folderPath),

  // Generate a new developer key
  generateDevKey: (options) => ipcRenderer.invoke('key:generate', options),

  // Return the platform (win32, darwin, linux)
  platform: process.platform,
});
