/**
 * IPC Handler Implementations
 *
 * Centralized request/response handlers for all invoke channels.
 * Handlers are registered via registerIpcHandlers() with all required dependencies injected.
 *
 * Input validation is applied at the boundary via src/shared/ipc-schema.js.
 */

const crypto = require('crypto');

const {
  validateDialogOpenOptions,
  validateSettingsSaveConfig,
  validateKeyGenerateOptions,
  validateShellOpenVSCode,
} = require('../../shared/ipc-schema');

// Max allowed file size for imported background images (512 KB)
const MAX_BACKGROUND_BYTES = 512 * 1024;

// PNG magic bytes: \x89PNG
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

// Parse width/height from a PNG buffer's IHDR chunk.
// Returns null when the buffer is too short or not a valid PNG.
function parsePngDimensions(buf) {
  if (buf.length < 24) return null;
  if (!buf.slice(0, 4).equals(PNG_MAGIC)) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/**
 * Register all IPC invoke handlers.
 *
 * @param {Object} deps - Injected dependencies
 * @param {Object} deps.ipcMain - Electron ipcMain
 * @param {Object} deps.dialog - Electron dialog
 * @param {Object} deps.app - Electron app
 * @param {Object} deps.shell - Electron shell
 * @param {Object} deps.fs - Node fs (or wrapper)
 * @param {Object} deps.path - Node path
 * @param {Object} deps.store - electron-store instance
 * @param {Function} deps.generateKey - keygen.generateKey
 * @param {Function} deps.getDefaultKeyPath - keygen.getDefaultKeyPath
 * @param {Function} deps.detectSdkPath - main.detectSdkPath
 * @param {Function} deps.loggedHandle - main.loggedHandle wrapper
 * @param {Function} deps.withRateLimit - main.withRateLimit wrapper
 * @param {string} deps.SESSION_TOKEN - Generated session token (hex string)
 * @param {Object} deps.mainWindow - BrowserWindow instance
 */
function registerIpcHandlers(deps) {
  const {
    ipcMain,
    dialog,
    app,
    shell,
    fs,
    path,
    store,
    generateKey,
    getDefaultKeyPath,
    detectSdkPath,
    loggedHandle,
    withRateLimit,
    SESSION_TOKEN,
    mainWindow,
  } = deps;

  // ─────────────────────────────────────────────────────────────────────
  // Invoke handlers: get-session-token
  // ─────────────────────────────────────────────────────────────────────
  loggedHandle('get-session-token', async () => SESSION_TOKEN);

  // ─────────────────────────────────────────────────────────────────────
  // Invoke handlers: dialog:open
  // ─────────────────────────────────────────────────────────────────────
  loggedHandle('dialog:open', async (event, options) => {
    const validation = validateDialogOpenOptions(options);
    if (!validation.valid) {
      throw new Error(validation.error);
    }
    return dialog.showOpenDialog(mainWindow, options);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Invoke handlers: settings:getConfig
  // ─────────────────────────────────────────────────────────────────────
  loggedHandle('settings:getConfig', () => ({
    sdkBin: store.get('sdkBin') || '',
    devKey: store.get('devKey') || '',
  }));

  // ─────────────────────────────────────────────────────────────────────
  // Invoke handlers: settings:saveConfig (rate-limited 2s)
  // ─────────────────────────────────────────────────────────────────────
  withRateLimit(
    'settings:saveConfig',
    (event, config) => {
      const validation = validateSettingsSaveConfig(config);
      if (!validation.valid) {
        throw new Error(validation.error);
      }
      // Normalize paths before persisting: eliminates redundant separators
      // and ensures stored values match the form expected by lib/config.js.
      // Validation already confirmed these are absolute, non-empty, and
      // contain no control characters — normalization is safe at this point.
      store.set('sdkBin', config.sdkBin ? path.normalize(config.sdkBin) : '');
      store.set('devKey', config.devKey ? path.normalize(config.devKey) : '');
      // Schedule app relaunch after a brief delay to allow response to reach renderer
      setTimeout(() => {
        app.relaunch();
        app.exit(0);
      }, 100);
      return { success: true };
    },
    2000
  );

  // ─────────────────────────────────────────────────────────────────────
  // Invoke handlers: settings:autoDetect (rate-limited 2s)
  // ─────────────────────────────────────────────────────────────────────
  withRateLimit(
    'settings:autoDetect',
    (event) => {
      const sdkPath = detectSdkPath();
      const keyPath = getDefaultKeyPath();
      return {
        sdkBin: sdkPath || '',
        devKey: keyPath,
        sdkFound: !!sdkPath,
        keyFound: fs.existsSync(keyPath),
      };
    },
    2000
  );

  // ─────────────────────────────────────────────────────────────────────
  // Invoke handlers: key:generate (rate-limited 5s)
  // ─────────────────────────────────────────────────────────────────────
  withRateLimit(
    'key:generate',
    async (event, options = {}) => {
      const validation = validateKeyGenerateOptions(options);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      const { outputPath = null, force = false } = options;

      // Build the allowlist once per call (app paths are stable after ready).
      // Keys may only be written inside ~/.garmin/ or the user's Documents folder.
      const allowedRoots = [
        path.resolve(path.dirname(getDefaultKeyPath())), // ~/.garmin
        path.resolve(app.getPath('documents')), // ~/Documents (or platform equivalent)
      ];

      // Resolve the requested path (handles ../ traversal and relative paths).
      // Fall back to the canonical default when the renderer omits outputPath.
      const resolvedPath = path.resolve(outputPath || getDefaultKeyPath());

      // Reject any path that doesn't sit inside one of the allowed roots.
      const isAllowed = allowedRoots.some((root) => {
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
    },
    5000
  );

  // ─────────────────────────────────────────────────────────────────────
  // Invoke handlers: background:import (rate-limited 2s)
  // Opens a native file picker, validates the selected PNG, copies it to
  // the managed backgrounds directory, and returns { success, assetId, dataUrl }.
  // The renderer never receives the filesystem path — only assetId and dataUrl.
  // ─────────────────────────────────────────────────────────────────────
  withRateLimit(
    'background:import',
    async (event) => {
      // Open native file picker — user selects the file, not the renderer.
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Import Watch Face Background',
        properties: ['openFile'],
        filters: [{ name: 'PNG Images', extensions: ['png'] }],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true };
      }

      const srcPath = result.filePaths[0];

      // ── Validate ───────────────────────────────────────────────────────
      let fileBuffer;
      try {
        fileBuffer = fs.readFileSync(srcPath);
      } catch (readErr) {
        return { success: false, error: `Cannot read file: ${readErr.message}` };
      }

      if (fileBuffer.length > MAX_BACKGROUND_BYTES) {
        return {
          success: false,
          error: `File too large (${(fileBuffer.length / 1024).toFixed(0)} KB). Maximum is 512 KB.`,
        };
      }

      // Verify PNG magic bytes
      if (!fileBuffer.slice(0, 4).equals(PNG_MAGIC)) {
        return { success: false, error: 'File is not a valid PNG image. Please select a PNG file.' };
      }

      // Validate dimensions — must be exactly 390×390
      const dims = parsePngDimensions(fileBuffer);
      if (!dims) {
        return { success: false, error: 'Could not read image dimensions. File may be corrupt.' };
      }
      if (dims.width !== 390 || dims.height !== 390) {
        return {
          success: false,
          error: `Image must be 390×390 pixels. This image is ${dims.width}×${dims.height}.`,
        };
      }

      // ── Copy to managed directory ──────────────────────────────────────
      const bgDir = path.join(app.getPath('userData'), 'wfb-backgrounds');
      try {
        fs.mkdirSync(bgDir, { recursive: true });
      } catch (mkdirErr) {
        return { success: false, error: `Cannot create backgrounds directory: ${mkdirErr.message}` };
      }

      // UUID-based assetId prevents path traversal and preserves no original filename
      const uuid     = crypto.randomUUID();
      const assetId  = `custom-${uuid}`;
      const dstPath  = path.join(bgDir, `${assetId}.png`);

      // Belt-and-suspenders: confirm destination is inside bgDir
      if (!path.resolve(dstPath).startsWith(path.resolve(bgDir) + path.sep)) {
        return { success: false, error: 'Internal path safety check failed.' };
      }

      try {
        fs.writeFileSync(dstPath, fileBuffer);
      } catch (writeErr) {
        return { success: false, error: `Cannot save background: ${writeErr.message}` };
      }

      // Return dataUrl for immediate canvas use; renderer never sees the file path
      const dataUrl = `data:image/png;base64,${fileBuffer.toString('base64')}`;
      return { success: true, assetId, dataUrl };
    },
    2000
  );

  // ─────────────────────────────────────────────────────────────────────
  // Invoke handlers: shell:openVSCode
  // ─────────────────────────────────────────────────────────────────────
  loggedHandle('shell:openVSCode', async (event, requestId) => {
    const validation = validateShellOpenVSCode(requestId);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    try {
      // Construct the path entirely in the main process — never trust the renderer
      // with a full filesystem path.
      const exportDir = path.resolve(path.join(app.getPath('documents'), 'WatchFaceBuilder', 'exported'));
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
}

module.exports = { registerIpcHandlers };
