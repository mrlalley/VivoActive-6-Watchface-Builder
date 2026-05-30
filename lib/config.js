// Configuration management for SDK paths and settings.
// Supports cross-platform defaults: Windows, macOS, Linux.

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Scan a directory for the latest Garmin SDK installation (connectiq-sdk-* pattern).
 * Returns the /bin subdirectory of the latest version found, or null if not found.
 *
 * @param {string} basePath - Directory to scan for SDK installations
 * @returns {string|null} Path to bin/ subdirectory of latest SDK, or null
 */
function scanForLatestSdk(basePath) {
  try {
    if (!fs.existsSync(basePath)) return null;

    const dirs = fs.readdirSync(basePath);
    const sdkDirs = dirs
      .filter(d => d.startsWith('connectiq-sdk-'))
      .sort((a, b) => b.localeCompare(a)); // reverse sort for latest first

    if (sdkDirs.length === 0) return null;

    const latestSdk = path.join(basePath, sdkDirs[0], 'bin');
    if (fs.existsSync(latestSdk)) {
      return latestSdk;
    }
  } catch (err) {
    // silently fail
  }
  return null;
}

/**
 * Get the platform-aware default SDK bin directory.
 * Scans for the latest installed SDK version and returns path to its /bin directory.
 * Falls back to base path if no SDK found (will error at build time with clear message).
 *
 * @returns {string} Platform-specific SDK bin directory (latest version if available)
 */
function getDefaultSdkBasePath() {
  const platform = process.platform;
  let basePath = '';

  if (platform === 'win32') {
    // Windows: %APPDATA%\Garmin\ConnectIQ\Sdks\
    basePath = path.join(process.env.APPDATA || '', 'Garmin', 'ConnectIQ', 'Sdks');
  } else if (platform === 'darwin') {
    // macOS: ~/Library/Application Support/Garmin/ConnectIQ/Sdks/
    basePath = path.join(os.homedir(), 'Library', 'Application Support', 'Garmin', 'ConnectIQ', 'Sdks');
  } else {
    // Linux: ~/.local/share/Garmin/ConnectIQ/Sdks/ (preferred) or /opt/garmin/connectiq/sdk
    basePath = path.join(os.homedir(), '.local', 'share', 'Garmin', 'ConnectIQ', 'Sdks');

    // Try to scan for latest SDK
    const found = scanForLatestSdk(basePath);
    if (found) return found;

    // Fall back to /opt/garmin/connectiq/sdk on Linux
    if (fs.existsSync('/opt/garmin/connectiq/sdk/bin')) {
      return '/opt/garmin/connectiq/sdk/bin';
    }

    return basePath;
  }

  // Try to scan for latest SDK in base path
  const found = scanForLatestSdk(basePath);
  return found || basePath;
}

/**
 * Get the platform-aware default developer key path.
 * Matches the VS Code Monkey C extension convention.
 *
 * @returns {string} ~/.garmin/developer_key.der on all platforms
 */
function getDefaultDevKeyPath() {
  return path.join(os.homedir(), '.garmin', 'developer_key.der');
}

/**
 * Get the platform-aware default export directory.
 * Used as fallback when not provided by electron/main.js.
 *
 * @returns {string} Platform-specific documents/cache directory
 */
function getDefaultExportDir() {
  const platform = process.platform;

  if (platform === 'win32' || platform === 'darwin') {
    // Windows/macOS: ~/Documents/WatchFaceBuilder/exported/
    return path.join(os.homedir(), 'Documents', 'WatchFaceBuilder', 'exported');
  } else {
    // Linux: ~/.local/share/WatchFaceBuilder/exported/
    return path.join(os.homedir(), '.local', 'share', 'WatchFaceBuilder', 'exported');
  }
}

/**
 * Get the platform-aware default temp directory.
 *
 * @returns {string} Platform-specific temp directory
 */
function getDefaultTempDir() {
  const platform = process.platform;

  if (platform === 'win32') {
    // Windows: %TEMP%\CIQPreview
    return path.join(process.env.TEMP || os.tmpdir(), 'CIQPreview');
  } else {
    // macOS/Linux: /tmp/CIQPreview or $TMPDIR/CIQPreview
    return path.join(os.tmpdir(), 'CIQPreview');
  }
}

/**
 * Resolve configuration with multi-level fallback chain.
 * Priority order:
 * 1. Function parameter overrides (highest)
 * 2. Environment variables (GARMIN_SDK_BIN, GARMIN_DEV_KEY, GARMIN_EXPORT_DIR)
 * 3. Detector function results (e.g., auto-detected SDK path)
 * 4. Platform-aware defaults (lowest)
 *
 * @param {Object} overrides - { sdkBin, devKey, exportDir, tempDir } from caller
 * @param {Object} detectors - { detectSdkPath, getDefaultKeyPath } from electron/main.js (optional)
 * @returns {Object} Full config object with all required paths
 */
function getConfig(overrides = {}, detectors = {}) {
  // Helper: resolve with fallback chain
  const resolve = (key, envVar, detectorFn, defaultFn) => {
    // 1. Override parameter (highest priority)
    if (overrides[key]) {
      return overrides[key];
    }

    // 2. Environment variable
    const envValue = process.env[envVar];
    if (envValue) {
      return envValue;
    }

    // 3. Detector function (if provided)
    if (detectorFn) {
      const detected = detectorFn();
      if (detected) {
        return detected;
      }
    }

    // 4. Default function (lowest priority)
    return defaultFn();
  };

  const SDK_BIN = resolve('sdkBin', 'GARMIN_SDK_BIN', detectors.detectSdkPath, getDefaultSdkBasePath);
  const DEV_KEY = resolve('devKey', 'GARMIN_DEV_KEY', detectors.getDefaultKeyPath, getDefaultDevKeyPath);
  const EXPORT_DIR = resolve('exportDir', 'GARMIN_EXPORT_DIR', null, getDefaultExportDir);
  const TEMP_DIR = overrides.tempDir || process.env.GARMIN_TEMP_DIR || getDefaultTempDir();

  // Determine tool extensions based on platform (for future cross-platform support)
  const isWindows = process.platform === 'win32';
  const batExt = isWindows ? '.bat' : '';
  const exeExt = isWindows ? '.exe' : '';

  // Validate that critical paths exist before returning
  const monkeycPath = path.join(SDK_BIN, `monkeyc${batExt}`);
  const monkeydoPath = path.join(SDK_BIN, `monkeydo${batExt}`);
  const simExePath = path.join(SDK_BIN, `simulator${exeExt}`);

  // Track validation status for health checks
  const config = {
    sdkBin: SDK_BIN,
    monkeyc: monkeycPath,
    monkeydo: monkeydoPath,
    simExe: simExePath,
    devKey: DEV_KEY,
    exportDir: EXPORT_DIR,
    tempDir: TEMP_DIR,
  };

  // Validate SDK binaries exist (SDK is required for build/preview)
  config.sdkFound = fs.existsSync(monkeycPath) && fs.existsSync(monkeydoPath);

  // Validate developer key exists (required for signing .prg files)
  config.keyFound = fs.existsSync(DEV_KEY);

  // Create export and temp directories if they don't exist
  try {
    if (!fs.existsSync(EXPORT_DIR)) {
      fs.mkdirSync(EXPORT_DIR, { recursive: true });
    }
  } catch (err) {
    // Directory creation may fail on some systems; log but don't fail
  }

  try {
    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR, { recursive: true });
    }
  } catch (err) {
    // Directory creation may fail on some systems; log but don't fail
  }

  return config;
}

module.exports = { getConfig, getDefaultSdkBasePath, getDefaultDevKeyPath, getDefaultExportDir, getDefaultTempDir, scanForLatestSdk };
