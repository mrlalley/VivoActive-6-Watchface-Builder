/**
 * IPC Input Validation Schemas
 *
 * Defines validation functions for all IPC invoke channels.
 * Applied at the handler boundary to prevent malformed payloads from reaching business logic.
 *
 * Pattern: each validator returns { valid, error } or throws with descriptive message.
 */

const path = require('path');

/**
 * Validate 'dialog:open' options
 * @param {any} options - from ipcRenderer.invoke('dialog:open', options)
 * @returns {{ valid: boolean, error?: string }}
 */
function validateDialogOpenOptions(options) {
  if (!options || typeof options !== 'object') {
    return { valid: false, error: 'dialog:open options must be an object' };
  }
  if (options.title && typeof options.title !== 'string') {
    return { valid: false, error: 'dialog:open title must be a string' };
  }
  if (options.defaultPath && typeof options.defaultPath !== 'string') {
    return { valid: false, error: 'dialog:open defaultPath must be a string' };
  }
  if (options.filters && !Array.isArray(options.filters)) {
    return { valid: false, error: 'dialog:open filters must be an array' };
  }
  return { valid: true };
}

/**
 * Validate 'settings:saveConfig' payload
 * @param {any} config - from ipcRenderer.invoke('settings:saveConfig', config)
 * @returns {{ valid: boolean, error?: string }}
 */
function validateSettingsSaveConfig(config) {
  // Rule 1 — Type and structure (existing checks, preserved verbatim)
  if (!config || typeof config !== 'object') {
    return { valid: false, error: 'settings:saveConfig config must be an object' };
  }
  if (config.sdkBin && typeof config.sdkBin !== 'string') {
    return { valid: false, error: 'settings:saveConfig sdkBin must be a string' };
  }
  if (config.devKey && typeof config.devKey !== 'string') {
    return { valid: false, error: 'settings:saveConfig devKey must be a string' };
  }

  // If sdkBin is provided (including as empty string), validate it according to Rules 2-5.
  // Undefined/null sdkBin is allowed (user has not configured it yet).
  if (config.sdkBin !== undefined && config.sdkBin !== null) {
    // Rule 2 — Non-empty strings
    if (!config.sdkBin.trim()) {
      return { valid: false, error: 'sdkBin must not be empty' };
    }

    // Rule 3 — No control characters (U+0000–U+001F)
    // Control chars can corrupt env var parsing and log output.
    if (/[\x00-\x1f]/.test(config.sdkBin)) {
      return { valid: false, error: 'sdkBin contains invalid characters' };
    }

    // Rule 4 — Absolute path required
    // Relative paths are meaningless as process-level env vars and enable
    // directory traversal. All valid SDK bin paths are absolute.
    if (!path.isAbsolute(path.normalize(config.sdkBin))) {
      return { valid: false, error: 'sdkBin must be an absolute path' };
    }

    // Rule 5 — Expected filename semantics
    // sdkBin must name the monkeyc binary, not a directory or other binary.
    const expectedMonkeyc = process.platform === 'win32' ? 'monkeyc.bat' : 'monkeyc';
    if (path.basename(path.normalize(config.sdkBin)) !== expectedMonkeyc) {
      return { valid: false, error: `sdkBin must point to the monkeyc binary (${expectedMonkeyc})` };
    }
  }

  // If devKey is provided (including as empty string), validate it according to Rules 2-5.
  // Undefined/null devKey is allowed (user has not configured it yet).
  if (config.devKey !== undefined && config.devKey !== null) {
    // Rule 2 — Non-empty strings
    if (!config.devKey.trim()) {
      return { valid: false, error: 'devKey must not be empty' };
    }

    // Rule 3 — No control characters (U+0000–U+001F)
    if (/[\x00-\x1f]/.test(config.devKey)) {
      return { valid: false, error: 'devKey contains invalid characters' };
    }

    // Rule 4 — Absolute path required
    if (!path.isAbsolute(path.normalize(config.devKey))) {
      return { valid: false, error: 'devKey must be an absolute path' };
    }

    // Rule 5 — Expected filename semantics (must be a .der file)
    // lib/keygen.js and the monkeyc signing pipeline assume DER encoding.
    if (path.extname(path.normalize(config.devKey)).toLowerCase() !== '.der') {
      return { valid: false, error: 'devKey must point to a .der file' };
    }
  }

  return { valid: true };
}

/**
 * Validate 'key:generate' options
 * @param {any} options - from ipcRenderer.invoke('key:generate', options)
 * @returns {{ valid: boolean, error?: string }}
 */
function validateKeyGenerateOptions(options) {
  if (!options) {
    // options is optional; undefined/null is valid
    return { valid: true };
  }
  if (typeof options !== 'object') {
    return { valid: false, error: 'key:generate options must be an object' };
  }
  if (options.outputPath && typeof options.outputPath !== 'string') {
    return { valid: false, error: 'key:generate outputPath must be a string' };
  }
  if (options.force && typeof options.force !== 'boolean') {
    return { valid: false, error: 'key:generate force must be a boolean' };
  }
  return { valid: true };
}

/**
 * Validate 'shell:openVSCode' requestId
 * @param {any} requestId - from ipcRenderer.invoke('shell:openVSCode', requestId)
 * @returns {{ valid: boolean, error?: string }}
 */
function validateShellOpenVSCode(requestId) {
  if (typeof requestId !== 'string') {
    return { valid: false, error: 'shell:openVSCode requestId must be a string' };
  }
  if (!/^[a-z0-9]+$/.test(requestId)) {
    return { valid: false, error: 'shell:openVSCode requestId must contain only lowercase letters and digits' };
  }
  return { valid: true };
}

module.exports = {
  validateDialogOpenOptions,
  validateSettingsSaveConfig,
  validateKeyGenerateOptions,
  validateShellOpenVSCode,
};
