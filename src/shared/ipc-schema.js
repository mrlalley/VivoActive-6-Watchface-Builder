/**
 * IPC Input Validation Schemas
 *
 * Defines validation functions for all IPC invoke channels.
 * Applied at the handler boundary to prevent malformed payloads from reaching business logic.
 *
 * Pattern: each validator returns { valid, error } or throws with descriptive message.
 */

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
  if (!config || typeof config !== 'object') {
    return { valid: false, error: 'settings:saveConfig config must be an object' };
  }
  if (config.sdkBin && typeof config.sdkBin !== 'string') {
    return { valid: false, error: 'settings:saveConfig sdkBin must be a string' };
  }
  if (config.devKey && typeof config.devKey !== 'string') {
    return { valid: false, error: 'settings:saveConfig devKey must be a string' };
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
