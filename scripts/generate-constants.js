#!/usr/bin/env node
// scripts/generate-constants.js
//
// Generates builder/constants.js from src/constants/device.js.
// Run via: npm run generate-constants
// Runs automatically before npm start / npm run server / npm run build.
//
// Device constants are read directly from the Node.js source-of-truth module
// so algebraic relationships (e.g. SAFE_AREA_RADIUS = CANVAS_SIZE * 0.9...)
// are always re-evaluated rather than copy-pasted as stale literals.
//
// UI and timing constants that have no server-side equivalent are defined
// statically in this script and written verbatim to the output.

'use strict';

const fs              = require('fs');
const path            = require('path');
const crypto          = require('crypto');
const { spawnSync }   = require('child_process');

// ── JDK version check ─────────────────────────────────────────────────────────
// Must run as the very first check. A missing or incompatible JDK causes cryptic
// Connect IQ SDK failures; catching it here gives an actionable error message.

const REQUIRED_JAVA_MAJOR = 17;
const SKIP_JAVA_CHECK     = process.env.SKIP_JAVA_CHECK === '1';

/**
 * parseJavaVersion(versionOutput)
 * Parses the stderr output of `java -version` and returns the integer major version,
 * or null if the format is unrecognized.
 *
 * All known formats:
 *   JDK 8 and earlier: java version "1.8.0_362"    → 8
 *   JDK 9+:            java version "17.0.10"       → 17
 *                      openjdk version "21.0.2"     → 21
 *                      java version "21.0.11+9-LTS" → 21
 */
function parseJavaVersion(versionOutput) {
  const match = versionOutput.match(/"(\d+)(?:\.(\d+))?[^"]*"/);
  if (!match) return null;

  const first  = parseInt(match[1], 10);
  const second = match[2] ? parseInt(match[2], 10) : null;

  // JDK 8 and earlier use 1.MAJOR.minor versioning (e.g. "1.8.0_362")
  if (first === 1 && second !== null) return second;

  // JDK 9+ use MAJOR.minor.patch directly
  return first;
}

/**
 * assertJdkVersion()
 * Checks that java is on PATH and meets REQUIRED_JAVA_MAJOR.
 * Exits with code 1 and an actionable error message on failure.
 * Skipped entirely when SKIP_JAVA_CHECK=1 (CI pipelines without a JDK install).
 */
function assertJdkVersion() {
  if (SKIP_JAVA_CHECK) {
    console.log('[generate-constants] SKIP_JAVA_CHECK=1 — skipping JDK version check');
    return;
  }

  const result = spawnSync('java', ['-version'], { encoding: 'utf8', timeout: 5000 });

  // java -version writes to stderr, not stdout
  const output = (result.stderr || '') + (result.stdout || '');

  if (result.error) {
    const isNotFound = result.error.code === 'ENOENT' || (result.error.message || '').includes('ENOENT');
    if (isNotFound) {
      console.error(
        '[generate-constants] FATAL: java not found on PATH.\n' +
        `  Required: JDK ${REQUIRED_JAVA_MAJOR} or later\n` +
        '  Install:  https://adoptium.net/temurin/releases/?version=17\n' +
        '  After installing, ensure java is on your PATH and retry.'
      );
    } else {
      console.error(
        '[generate-constants] FATAL: failed to run java -version.\n' +
        `  Error: ${result.error.message}`
      );
    }
    process.exit(1);
  }

  const majorVersion = parseJavaVersion(output);

  if (majorVersion === null) {
    console.error(
      '[generate-constants] FATAL: could not parse java -version output.\n' +
      `  Output received:\n    ${output.trim().replace(/\n/g, '\n    ')}\n` +
      `  Expected format: java version "17.0.x" or openjdk version "17.0.x"\n` +
      '  Install a supported JDK from: https://adoptium.net/temurin/releases/?version=17'
    );
    process.exit(1);
  }

  if (majorVersion < REQUIRED_JAVA_MAJOR) {
    console.error(
      `[generate-constants] FATAL: JDK ${majorVersion} is too old.\n` +
      `  Found:    JDK ${majorVersion}\n` +
      `  Required: JDK ${REQUIRED_JAVA_MAJOR} or later\n` +
      `  Reason:   Garmin Connect IQ SDK 9.x requires JDK ${REQUIRED_JAVA_MAJOR}+.\n` +
      `            JDK ${majorVersion} will cause cryptic SDK launch failures.\n` +
      '  Install:  https://adoptium.net/temurin/releases/?version=17\n' +
      '  After installing, ensure the new java is first on your PATH.'
    );
    process.exit(1);
  }

  console.log(
    `[generate-constants] JDK ${majorVersion} confirmed. Minimum required: ${REQUIRED_JAVA_MAJOR}. OK.`
  );
}

// First check — runs before cache guard, SDK detection, and generation logic.
assertJdkVersion();

// ── Cache configuration ───────────────────────────────────────────────────────

const DEVICE_SRC = path.resolve(__dirname, '../src/constants/device.js');
const OUTPUT     = path.resolve(__dirname, '../builder/constants.js');

// INPUT_SOURCES: every file whose content influences the output.
// Adding this script itself ensures that editing the static constants block
// (grid options, timing values) also invalidates the cache.
const INPUT_SOURCES = [
  DEVICE_SRC,
  path.resolve(__filename), // scripts/generate-constants.js itself
];

// No environment variables affect the generated output.
const ENV_INPUTS = [];

const CACHE_FILE = OUTPUT + '.cache.json';

// GENERATE_FORCE=1 or --force CLI flag bypass the cache unconditionally.
const FORCE = process.env.GENERATE_FORCE === '1' || process.argv.includes('--force');

// ── Cache helpers ─────────────────────────────────────────────────────────────

/**
 * hashFile(filePath)
 * Returns SHA-256 hex digest of file contents.
 * Returns null if the file does not exist or cannot be read.
 */
function hashFile(filePath) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch {
    return null;
  }
}

/**
 * hashString(value)
 * Returns SHA-256 hex digest of a string value (for env vars).
 */
function hashString(value) {
  return crypto.createHash('sha256').update(String(value ?? '')).digest('hex');
}

/**
 * buildInputManifest()
 * Returns an object mapping each input source to its current SHA-256 hash.
 */
function buildInputManifest() {
  const manifest = {};
  for (const filePath of INPUT_SOURCES) {
    manifest[filePath] = hashFile(filePath);
  }
  for (const envVar of ENV_INPUTS) {
    manifest[`env:${envVar}`] = hashString(process.env[envVar]);
  }
  return manifest;
}

/**
 * isCacheValid()
 * Returns true only when:
 *   1. OUTPUT_FILE exists
 *   2. CACHE_FILE exists and parses as valid JSON
 *   3. Every input hash in the cache matches the current input hash
 *   4. The cached output hash matches the current OUTPUT_FILE hash
 *      (detects manual edits to the generated file)
 */
function isCacheValid() {
  if (!fs.existsSync(OUTPUT)) {
    console.log('[generate-constants] output file missing — regenerating');
    return false;
  }
  if (!fs.existsSync(CACHE_FILE)) {
    console.log('[generate-constants] no cache file — regenerating');
    return false;
  }

  let cached;
  try {
    cached = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  } catch {
    console.log('[generate-constants] cache file unreadable — regenerating');
    return false;
  }

  // Validate every input hash.
  const current = buildInputManifest();
  for (const [key, hash] of Object.entries(current)) {
    if (cached.inputs?.[key] !== hash) {
      console.log(`[generate-constants] input changed: ${path.basename(key)} — regenerating`);
      return false;
    }
  }

  // Validate that the output file has not been manually edited since generation.
  const currentOutputHash = hashFile(OUTPUT);
  if (cached.outputHash !== currentOutputHash) {
    console.log('[generate-constants] output file was modified externally — regenerating');
    return false;
  }

  return true;
}

/**
 * writeCache()
 * Persists the cache manifest after a successful generation.
 * Must be called immediately after OUTPUT is written.
 */
function writeCache() {
  const manifest = {
    generatedAt: new Date().toISOString(),
    inputs:      buildInputManifest(),
    outputHash:  hashFile(OUTPUT),
  };
  fs.writeFileSync(CACHE_FILE, JSON.stringify(manifest, null, 2), 'utf8');
}

// ── SDK version detection and compatibility validation ────────────────────────

const TEMPLATE_VERSION_FILE = path.resolve(__dirname, '../garmin-project-template/VERSION');

const SDK_SEARCH_PATHS = [
  process.env.GARMIN_SDK_PATH,
  process.env.CIQ_HOME,
  // Windows: %APPDATA%\Garmin\ConnectIQ\Sdks\
  path.join(process.env.APPDATA || '', 'Garmin', 'ConnectIQ', 'Sdks'),
  // macOS: ~/Library/Application Support/Garmin/ConnectIQ/Sdks/
  path.join(process.env.HOME || '', 'Library', 'Application Support', 'Garmin', 'ConnectIQ', 'Sdks'),
  // Linux: ~/.Garmin/ConnectIQ/Sdks/
  path.join(process.env.HOME || '', '.Garmin', 'ConnectIQ', 'Sdks'),
].filter(Boolean);

// Device definitions in Connect IQ are stored separately from the SDK install.
// default.jungle references this path: %APPDATA%\Garmin\ConnectIQ\Devices
const CIQ_DEVICE_PATHS = [
  // Windows
  path.join(process.env.APPDATA || '', 'Garmin', 'ConnectIQ', 'Devices'),
  // macOS
  path.join(process.env.HOME || '', 'Library', 'Application Support', 'Garmin', 'ConnectIQ', 'Devices'),
  // Linux
  path.join(process.env.HOME || '', '.Garmin', 'ConnectIQ', 'Devices'),
].filter(Boolean);

/**
 * compareVersions(a, b)
 * Returns -1 if a < b, 0 if equal, 1 if a > b.
 * Handles three-part semver strings: "4.2.0", "9.1.0", "4.10.0" > "4.2.0".
 */
function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * extractSdkVersion(dirName)
 * Extracts the X.Y.Z version from a connectiq-sdk directory name.
 * Handles both simple format (connectiq-sdk-9.1.0) and platform-prefixed
 * format (connectiq-sdk-win-8.2.3-2025-08-11-cac5b3b21).
 * Returns the first X.Y.Z match found, or null.
 */
function extractSdkVersion(dirName) {
  const m = dirName.match(/(\d+\.\d+\.\d+)/);
  return m ? m[1] : null;
}

/**
 * detectInstalledSdk()
 * Returns { sdkVersion, sdkPath, deviceIds } on success.
 * Returns null if no SDK is found (non-fatal — standalone mode).
 *
 * SDK version: read from bin/version.txt (authoritative).
 * Device IDs: read from the Connect IQ Devices directory (separate from SDK install)
 *   OR parsed from bin/default.jungle which references device IDs inline.
 */
function detectInstalledSdk() {
  for (const searchPath of SDK_SEARCH_PATHS) {
    if (!fs.existsSync(searchPath)) continue;

    let entries;
    try {
      entries = fs.readdirSync(searchPath)
        .filter(d => d.startsWith('connectiq-sdk-') && extractSdkVersion(d) !== null)
        .sort((a, b) => -compareVersions(extractSdkVersion(a), extractSdkVersion(b)));
    } catch {
      continue;
    }

    if (entries.length === 0) continue;

    const latestSdk = entries[0];
    const sdkPath   = path.join(searchPath, latestSdk);
    const binPath   = path.join(sdkPath, 'bin');

    // Prefer bin/version.txt (authoritative) over directory-name extraction.
    let sdkVersion = extractSdkVersion(latestSdk);
    try {
      const versionTxt = fs.readFileSync(path.join(binPath, 'version.txt'), 'utf8').trim();
      if (/^\d+\.\d+\.\d+/.test(versionTxt)) sdkVersion = versionTxt.match(/^\d+\.\d+\.\d+/)[0];
    } catch { /* fall back to directory-name extraction */ }

    // Device IDs: check the Garmin Connect IQ Devices directory (shared across SDK versions).
    let deviceIds = [];
    for (const devBase of CIQ_DEVICE_PATHS) {
      if (!fs.existsSync(devBase)) continue;
      try {
        deviceIds = fs.readdirSync(devBase)
          .filter(d => {
            try { return fs.statSync(path.join(devBase, d)).isDirectory(); }
            catch { return false; }
          });
        if (deviceIds.length > 0) break;
      } catch { /* try next path */ }
    }

    // Fallback: parse device IDs from bin/default.jungle if Devices dir is empty.
    if (deviceIds.length === 0) {
      try {
        const jungleContent = fs.readFileSync(path.join(binPath, 'default.jungle'), 'utf8');
        // Device IDs appear as "deviceId.sourcePath = ..." or in list form.
        const matches = jungleContent.match(/^([a-z][a-z0-9_]+)\./gmi) || [];
        const parsed = [...new Set(matches.map(m => m.replace('.', '')))];
        if (parsed.length > 0) deviceIds = parsed;
      } catch { /* leave deviceIds empty */ }
    }

    return { sdkVersion, sdkPath, deviceIds };
  }
  return null; // SDK not installed — non-fatal for standalone mode
}

/**
 * validateSdkCompatibility(sdk)
 * Validates the installed SDK against the VERSION file.
 * Returns { deviceId, usingFallback } on success.
 * Throws with an actionable message on version incompatibility.
 * Throws with a non-fatal warning pattern if device IDs cannot be resolved.
 */
function validateSdkCompatibility(sdk) {
  let templateMeta;
  try {
    templateMeta = JSON.parse(fs.readFileSync(TEMPLATE_VERSION_FILE, 'utf8'));
  } catch (err) {
    // VERSION file missing — warn but don't block (it's checked in Electron main too)
    console.warn('[generate-constants] WARN: garmin-project-template/VERSION unreadable — skipping compatibility check.');
    return { deviceId: null, usingFallback: false };
  }

  // Incompatible SDK version: warn in generate-constants (runs for both npm start and
  // npm run server). The hard block for Electron mode is in electron/main.js which
  // shows dialog.showErrorBox() and quits. This warning ensures developers see the
  // issue immediately in both modes without blocking the standalone server.
  if (compareVersions(sdk.sdkVersion, templateMeta.minSdkVersion) < 0) {
    console.warn(
      `[generate-constants] WARN: Installed Connect IQ SDK ${sdk.sdkVersion} is older than ` +
      `recommended ${templateMeta.minSdkVersion}.\n` +
      `  Export and Preview may fail. Download the latest SDK from: https://developer.garmin.com/connect-iq/sdk/\n` +
      `  SDK found at: ${sdk.sdkPath}`
    );
    // Return with null deviceId — main.js will perform the hard block if needed.
    return { deviceId: null, usingFallback: false, sdkTooOld: true };
  }

  // Resolve device ID: prefer vivoactive6, fall back to VERSION.fallbackDeviceId.
  const preferredDevice = templateMeta.targetDeviceId   || 'vivoactive6';
  const fallbackDevice  = templateMeta.fallbackDeviceId || 'venu3';

  if (sdk.deviceIds.includes(preferredDevice)) {
    console.log(
      `[generate-constants] SDK ${sdk.sdkVersion} compatible. Device: ${preferredDevice}.`
    );
    return { deviceId: preferredDevice, usingFallback: false };
  }

  if (sdk.deviceIds.includes(fallbackDevice)) {
    console.warn(
      `[generate-constants] WARN: ${preferredDevice} not found in SDK ${sdk.sdkVersion} device list. ` +
      `Using fallback: ${fallbackDevice}. ` +
      `Update garmin-project-template/manifest.xml targetDevice when ${preferredDevice} is available.`
    );
    return { deviceId: fallbackDevice, usingFallback: true };
  }

  // Neither device found — warn but do not exit. Build may still work with a manually set device.
  console.warn(
    `[generate-constants] WARN: Neither ${preferredDevice} nor ${fallbackDevice} found in SDK device list.\n` +
    `Available: ${sdk.deviceIds.slice(0, 10).join(', ')}${sdk.deviceIds.length > 10 ? '…' : ''}.\n` +
    `Set GARMIN_SDK_PATH to a SDK version that includes ${preferredDevice} or ${fallbackDevice}.`
  );
  return { deviceId: preferredDevice, usingFallback: false };
}

// Run SDK check on every invocation (even cache hits) so a changed or missing
// SDK is reported immediately. Detection is fast (filesystem stat only).
// This is a WARNING-only check — the hard block for Electron mode is in main.js.
(function runSdkCheck() {
  const sdk = detectInstalledSdk();

  if (!sdk) {
    console.warn(
      '[generate-constants] WARN: Garmin Connect IQ SDK not found.\n' +
      '  Searched: ' + SDK_SEARCH_PATHS.slice(0, 3).join(', ') + '\n' +
      '  Download SDK from: https://developer.garmin.com/connect-iq/sdk/\n' +
      '  Export and Preview features will not work until the SDK is installed.'
    );
    return; // non-fatal — standalone mode allows running without SDK
  }

  validateSdkCompatibility(sdk);
})();

// ── Cache guard ───────────────────────────────────────────────────────────────

if (!FORCE && isCacheValid()) {
  console.log('[generate-constants] inputs unchanged — skipping generation');
  process.exit(0);
}

if (FORCE) {
  console.log('[generate-constants] force flag set — bypassing cache');
}

// ── Generation logic (unchanged) ──────────────────────────────────────────────

try {
  const device = require(DEVICE_SRC);

  function fmt(v) {
    return typeof v === 'string' ? `'${v}'` : String(v);
  }

  // Build the device-constants block from the live module values.
  // Each value is re-evaluated from src/constants/device.js at generation time,
  // so changing CANVAS_SIZE there propagates automatically via npm run generate-constants.
  const deviceBlock = [
    `export const CANVAS_SIZE          = ${fmt(device.CANVAS_SIZE)};`,
    `export const CANVAS_CENTER        = ${fmt(device.CANVAS_CENTER)};`,
    `export const SAFE_AREA_INSET      = ${fmt(device.SAFE_AREA_INSET)};`,
    `export const SAFE_AREA_DIAMETER   = ${fmt(device.SAFE_AREA_DIAMETER)};`,
    `export const SAFE_AREA_RADIUS     = ${fmt(device.SAFE_AREA_RADIUS)};`,
    `export const EDGE_WARN_DISTANCE   = ${fmt(device.EDGE_WARN_DISTANCE)};`,
    `export const MIN_ELEMENT_SIZE     = ${fmt(device.MIN_ELEMENT_SIZE)};`,
    `export const MAX_DESIGN_ELEMENTS  = ${fmt(device.MAX_DESIGN_ELEMENTS)};`,
    `export const LAUNCHER_ICON_SIZE   = ${fmt(device.LAUNCHER_ICON_SIZE)};`,
    `export const TARGET_API_LEVEL     = ${fmt(device.TARGET_API_LEVEL)};`,
    `export const MIN_API_LEVEL        = ${fmt(device.MIN_API_LEVEL)};`,
    `export const DEVICE_ID            = ${fmt(device.DEVICE_ID)};`,
  ].join('\n');

  // ── UI and timing constants (browser-only, no server-side equivalent) ─────────
  // These are maintained here rather than in src/constants/device.js because they
  // are purely presentation/timing values with no bearing on server-side validation.
  const staticBlock = `\
// Grid display options
export const GRID_SPACING_OPTIONS              = [20, 10, 5];
export const GRID_LEVEL_1_MINOR               = 20;
export const GRID_LEVEL_1_MAJOR               = 100;
export const GRID_LEVEL_2_MINOR               = 10;
export const GRID_LEVEL_2_MAJOR               = 50;
export const GRID_LEVEL_3_MINOR               = 5;
export const GRID_LEVEL_3_MAJOR               = 25;
export const GRID_MINOR_ALPHA                 = 0.18;
export const GRID_MAJOR_ALPHA                 = 0.40;
export const DEFAULT_ELEMENT_X                = ${fmt(device.CANVAS_CENTER)};
export const DEFAULT_ELEMENT_Y                = ${fmt(device.CANVAS_CENTER)};

// Timing (ms)
export const ANALOG_RENDER_INTERVAL           = 1000;
export const SAVE_INDICATOR_HIDE_DELAY        = 2000;
export const BUILD_TIMEOUT_MS                 = 60000;
export const PREVIEW_TIMEOUT_MS               = 30000;
export const KEYGEN_TIMEOUT_MS                = 60000;
export const APP_RESTART_DELAY_MS             = 100;
export const HEALTH_CHECK_DELAY_MS            = 8000;
export const SIMULATOR_POLL_INITIAL_DELAY_MS  = 500;
export const SIMULATOR_POLL_MAX_DELAY_MS      = 3000;
export const SIMULATOR_STARTUP_DEADLINE_MS    = 20000;`;

  // ── Write output ──────────────────────────────────────────────────────────────
  const header = `\
// !! GENERATED FILE — DO NOT EDIT MANUALLY !!
// Source: src/constants/device.js
// Regenerate: npm run generate-constants
// Generated: ${new Date().toISOString()}
//
// Browser-compatible ES module mirror of src/constants/device.js.
// Device constants are evaluated from the source file at generation time,
// so algebraic relationships are preserved and stale literals are impossible.

`;

  const output = header + '// Device constants (from src/constants/device.js)\n' + deviceBlock
    + '\n\n' + staticBlock + '\n';

  fs.writeFileSync(OUTPUT, output, 'utf8');

  writeCache();

  console.log(`[generate-constants] ✓ builder/constants.js generated and cache updated`);
  console.log(`  CANVAS_SIZE=${device.CANVAS_SIZE}  SAFE_AREA_RADIUS=${device.SAFE_AREA_RADIUS}  DEVICE_ID=${device.DEVICE_ID}`);

} catch (err) {
  console.error('[generate-constants] FATAL: generation failed:', err.message);
  process.exit(1);
}
