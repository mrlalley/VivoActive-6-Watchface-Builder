'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// ── Channel allowlists ──────────────────────────────────────────────────────
// VALID_INVOKE_CHANNELS: channels the renderer may call via ipcRenderer.invoke().
// Every entry must have a matching ipcMain.handle() in electron/main.js.
// Adding a channel here without a corresponding handle() is a silent no-op.
const VALID_INVOKE_CHANNELS = [
  'dialog:open',
  'settings:getConfig',
  'settings:saveConfig',
  'settings:autoDetect',
  'key:generate',
  'shell:openVSCode',
  'get-session-token',   // one-time fetch; result held in closure, never on window
];

// VALID_RECEIVE_CHANNELS: channels the renderer may subscribe to via ipcRenderer.on/once().
// These are main → renderer sends only. The renderer cannot invoke them.
const VALID_RECEIVE_CHANNELS = [
  'app:health-status',
  'app:health-warning',
  'file:newDesign',
  'settings:showOverlay',
];

// ── Listener registry ────────────────────────────────────────────────────────
// Track all persistent .on() listeners so they can be removed in cleanup().
// This prevents listener accumulation if the renderer reloads within the same
// Electron window (e.g. webContents.reload() rather than app.relaunch()).
const _listeners = [];

function _on(channel, callback) {
  if (!VALID_RECEIVE_CHANNELS.includes(channel)) {
    throw new Error(`IPC receive channel not permitted: ${channel}`);
  }
  ipcRenderer.on(channel, callback);
  _listeners.push({ channel, callback });
}

// ── Session token (held in closure — NEVER exposed on window) ────────────────
// Fetched once from the Electron main process via 'get-session-token' IPC.
// apiFetch() attaches it as 'x-wfb-token' on every server request automatically.
// The renderer never sees the token as a readable property.
let _sessionToken = null;

async function _getToken() {
  if (!_sessionToken) {
    _sessionToken = await ipcRenderer.invoke('get-session-token');
  }
  return _sessionToken;
}

// ── Secure API bridge ────────────────────────────────────────────────────────
// Named methods are intentionally more restrictive than a generic invoke(channel).
// A generic invoke() with an allowlist would allow any renderer code (including
// XSS) to call any channel with any payload. Named methods restrict both the
// channel AND the call signature at the preload boundary.
//
// Rules enforced here:
//   - Only channels in VALID_INVOKE_CHANNELS may be invoked.
//   - Only channels in VALID_RECEIVE_CHANNELS may be subscribed to.
//   - No Node.js built-ins (require, process, __dirname, Buffer) are exposed.
//   - process.platform is read once at preload time; the string value 'win32' /
//     'darwin' / 'linux' is exposed — not a reference to process itself.
//   - _sessionToken is never exposed on window; apiFetch() attaches it internally.
contextBridge.exposeInMainWorld('electronAPI', {
  // Open a native file dialog and return the result.
  openFileDialog: (options) => {
    return ipcRenderer.invoke('dialog:open', options);
  },

  // Settings IPC
  getConfig:   ()       => ipcRenderer.invoke('settings:getConfig'),
  saveConfig:  (config) => ipcRenderer.invoke('settings:saveConfig', config),
  autoDetect:  ()       => ipcRenderer.invoke('settings:autoDetect'),

  // .once(): main sends this exactly once after did-finish-load per context.
  // Auto-removes itself after firing — no cleanup entry needed.
  onSettingsShow: (callback) => {
    if (typeof callback !== 'function') throw new TypeError('callback must be a function');
    ipcRenderer.once('settings:showOverlay', callback);
  },

  // .on(): user can trigger "New Design" from the menu multiple times per session.
  onNewDesign: (callback) => {
    if (typeof callback !== 'function') throw new TypeError('callback must be a function');
    _on('file:newDesign', callback);
  },

  // .on(): fires continuously during health polling for the lifetime of the window.
  onHealthStatus: (callback) => {
    if (typeof callback !== 'function') throw new TypeError('callback must be a function');
    _on('app:health-status', callback);
  },
  onHealthWarning: (callback) => {
    if (typeof callback !== 'function') throw new TypeError('callback must be a function');
    _on('app:health-warning', callback);
  },

  // Remove all persistent listeners registered via _on().
  // Call this in the renderer's beforeunload handler to prevent accumulation
  // if the page reloads within the same Electron window.
  cleanup: () => {
    _listeners.forEach(({ channel, callback }) => {
      ipcRenderer.removeListener(channel, callback);
    });
    _listeners.length = 0;
  },

  // Open VS Code with a folder identified by requestId (not a raw path).
  openInVSCode: (requestId) => ipcRenderer.invoke('shell:openVSCode', requestId),

  // Generate a new RSA-4096 developer key.
  generateDevKey: (options) => ipcRenderer.invoke('key:generate', options),

  // Authenticated fetch helper.
  // Attaches x-wfb-token from the preload closure on every request.
  // Renderer code uses this instead of fetch() for all /api/ calls.
  // The token is NEVER accessible as window.electronAPI.token or similar.
  apiFetch: async (apiPath, options = {}) => {
    if (typeof fetch === 'undefined') {
      throw new Error('fetch is not available in preload context');
    }
    const token = await _getToken();
    const response = fetch(apiPath, {
      ...options,
      headers: {
        ...(options.headers || {}),
        'x-wfb-token': token,
      },
    });
    if (!response || typeof response.then !== 'function') {
      throw new Error(`fetch returned invalid value: ${typeof response}`);
    }
    return response;
  },

  // The OS platform string, read once at preload time.
  // Exposed as a plain string — process itself is NOT accessible to the renderer.
  platform: process.platform,
});
