// lib/sdk-detect.js
//
// Single source of truth for Garmin Connect IQ SDK detection.
// Previously duplicated across:
//   electron/main.js          checkSdkCompatibility() — inline detection
//   scripts/generate-constants.js  detectInstalledSdk()
//   lib/config.js             getDefaultSdkBasePath() + scanForLatestSdk()
//
// All three call sites now delegate here. This file owns every env var,
// search path, and version-comparison decision. Change here — it propagates
// everywhere.

'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const { createLogger } = require('./logger');
const log = createLogger('sdk-detect');

// ── SdkNotFoundError ────────────────────────────────────────────────────────
// Exported so callers can do: catch (e) { if (e instanceof SdkNotFoundError) }

class SdkNotFoundError extends Error {
  constructor(searchedPaths) {
    super(
      'Garmin Connect IQ SDK not found. Searched: ' +
      searchedPaths.join(', ') + '. ' +
      'Install from https://developer.garmin.com/connect-iq/sdk/ ' +
      'or set GARMIN_SDK_PATH to the Sdks/ directory.'
    );
    this.name          = 'SdkNotFoundError';
    this.searchedPaths = searchedPaths;
  }
}

// ── compareVersions ─────────────────────────────────────────────────────────
// Returns negative if a < b, 0 if equal, positive if a > b.
// Handles three-part semver: "4.10.0" > "4.2.0" (numeric, not lexicographic).

function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// ── Canonical env-var priority ───────────────────────────────────────────────
// GARMIN_SDK_PATH and CIQ_HOME point to the Sdks/ root that contains
// connectiq-sdk-* subdirectories (not the bin/ subdir directly).
// GARMIN_SDK_BIN (used by config.js) points to an SDK bin/ directory — handled
// separately by config.js's getDefaultSdkBasePath(); not included here because
// the scan logic expects a Sdks/ root, not a bin/ path.

function _envSdkRoots() {
  return [
    process.env.GARMIN_SDK_PATH,
    process.env.CIQ_HOME,
  ].filter(Boolean);
}

// ── Canonical search paths ───────────────────────────────────────────────────
// Union of every path used by any of the three prior implementations.
// Checked in order after env vars; first hit with a valid SDK wins.

function _defaultSdkRoots() {
  const home    = os.homedir();
  const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');

  return [
    // Windows
    path.join(appData,  'Garmin', 'ConnectIQ', 'Sdks'),
    // macOS
    path.join(home, 'Library', 'Application Support', 'Garmin', 'ConnectIQ', 'Sdks'),
    // Linux — all variants found across the three prior implementations
    path.join(home, '.Garmin', 'ConnectIQ', 'Sdks'),
    path.join(home, '.local', 'share', 'Garmin', 'ConnectIQ', 'Sdks'),
  ].filter(Boolean);
}

// Standalone SDK installs on Linux (non-Sdks/ layout, bin/ directly present)
const _LINUX_STANDALONE = [
  '/opt/garmin/connectiq/sdk',
];

// ── CIQ Devices directory paths ─────────────────────────────────────────────
// Device definitions are stored separately from the SDK installation.
// Referenced by bin/default.jungle as devicesPath.

function _ciqDeviceRoots() {
  const home    = os.homedir();
  const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  return [
    path.join(appData, 'Garmin', 'ConnectIQ', 'Devices'),
    path.join(home, 'Library', 'Application Support', 'Garmin', 'ConnectIQ', 'Devices'),
    path.join(home, '.Garmin', 'ConnectIQ', 'Devices'),
  ].filter(Boolean);
}

// ── extractSdkVersion ────────────────────────────────────────────────────────
// Extracts X.Y.Z from a connectiq-sdk directory name.
// Handles both "connectiq-sdk-9.1.0" and "connectiq-sdk-win-8.2.3-2025-08-11-hash".

function _extractSdkVersion(dirName) {
  const m = dirName.match(/(\d+\.\d+\.\d+)/);
  return m ? m[1] : null;
}

// ── Device ID resolution ─────────────────────────────────────────────────────

function _resolveDeviceIds(sdkBin) {
  // Primary: CIQ Devices directory (shared across SDK versions)
  for (const devBase of _ciqDeviceRoots()) {
    if (!fs.existsSync(devBase)) continue;
    try {
      const ids = fs.readdirSync(devBase)
        .filter(d => { try { return fs.statSync(path.join(devBase, d)).isDirectory(); } catch { return false; } });
      if (ids.length > 0) return ids;
    } catch { /* try next */ }
  }

  // Fallback: parse device IDs from bin/default.jungle
  try {
    const jungleContent = fs.readFileSync(path.join(sdkBin, 'default.jungle'), 'utf8');
    const matches = jungleContent.match(/^([a-z][a-z0-9_]+)\./gmi) || [];
    const ids = [...new Set(matches.map(m => m.replace('.', '')))];
    if (ids.length > 0) return ids;
  } catch { /* no jungle file */ }

  return [];
}

// ── scanSdksRoot ─────────────────────────────────────────────────────────────
// Scans a Sdks/ root for connectiq-sdk-* subdirs, returns the descriptor for
// the highest-versioned valid SDK found, or null.

function _scanSdksRoot(sdksRoot) {
  if (!fs.existsSync(sdksRoot)) return null;

  let entries;
  try {
    entries = fs.readdirSync(sdksRoot)
      .filter(d => d.startsWith('connectiq-sdk-') && _extractSdkVersion(d) !== null)
      .sort((a, b) => -compareVersions(_extractSdkVersion(a), _extractSdkVersion(b)));
  } catch { return null; }

  for (const entry of entries) {
    const sdkPath = path.join(sdksRoot, entry);
    const sdkBin  = path.join(sdkPath, 'bin');
    if (!fs.existsSync(sdkBin)) continue;

    // Prefer bin/version.txt (authoritative) over directory-name extraction.
    let sdkVersion = _extractSdkVersion(entry);
    try {
      const raw = fs.readFileSync(path.join(sdkBin, 'version.txt'), 'utf8').trim();
      const m = raw.match(/^(\d+\.\d+\.\d+)/);
      if (m) sdkVersion = m[1];
    } catch { /* use dir-name version */ }

    const deviceIds = _resolveDeviceIds(sdkBin);
    return { sdkPath, sdkBin, sdkVersion, deviceIds, source: sdksRoot };
  }
  return null;
}

// ── validateSdkBin ───────────────────────────────────────────────────────────
// Validates a direct path to an SDK bin/ directory (used for env-var overrides
// that point directly at a specific SDK install, not a Sdks/ root).

function _validateSdkBin(binPath) {
  if (!fs.existsSync(binPath)) return null;
  const versionTxt = path.join(binPath, 'version.txt');
  if (!fs.existsSync(versionTxt)) return null;
  const raw = fs.readFileSync(versionTxt, 'utf8').trim();
  const m = raw.match(/^(\d+\.\d+\.\d+)/);
  if (!m) return null;
  const sdkPath   = path.dirname(binPath);
  const deviceIds = _resolveDeviceIds(binPath);
  return { sdkPath, sdkBin: binPath, sdkVersion: m[1], deviceIds, source: binPath };
}

// ── _detectSdkSync ───────────────────────────────────────────────────────────
// Core sync implementation shared by detectSdk() and detectSdkSync().

function _detectSdkSync() {
  const searched = [];

  // 1. Env vars — most specific, checked first.
  for (const envRoot of _envSdkRoots()) {
    searched.push(envRoot);
    // Env var may point to a Sdks/ root or directly to a specific SDK's bin/.
    const direct = _validateSdkBin(envRoot);
    if (direct) {
      log.info({ ...direct }, 'SDK resolved via env-var bin path');
      return direct;
    }
    const scanned = _scanSdksRoot(envRoot);
    if (scanned) {
      log.info({ ...scanned }, 'SDK resolved via env-var Sdks root');
      return scanned;
    }
  }

  // 2. Platform default Sdks/ directories.
  for (const root of _defaultSdkRoots()) {
    searched.push(root);
    const result = _scanSdksRoot(root);
    if (result) {
      log.info({ ...result }, 'SDK resolved via filesystem scan');
      return result;
    }
  }

  // 3. Linux standalone installs (bin/ directly present, no Sdks/ parent).
  for (const standalone of _LINUX_STANDALONE) {
    searched.push(standalone);
    const result = _validateSdkBin(path.join(standalone, 'bin')) ||
                   _validateSdkBin(standalone);
    if (result) {
      log.info({ ...result }, 'SDK resolved via Linux standalone path');
      return result;
    }
  }

  log.warn({ searched }, 'SDK not found after exhausting all search paths');
  throw new SdkNotFoundError(searched);
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * detectSdkSync()
 * Synchronous SDK detection — for callers that cannot use async (config.js,
 * generate-constants.js top-level script).
 * Returns { sdkPath, sdkBin, sdkVersion, deviceIds, source }.
 * Throws SdkNotFoundError when no SDK is found.
 */
function detectSdkSync() {
  return _detectSdkSync();
}

/**
 * detectSdk()
 * Async wrapper around detectSdkSync(). Async signature allows future
 * network-based resolution without a breaking API change.
 * Returns { sdkPath, sdkBin, sdkVersion, deviceIds, source }.
 * Throws SdkNotFoundError when no SDK is found.
 */
async function detectSdk() {
  return _detectSdkSync();
}

module.exports = { detectSdk, detectSdkSync, SdkNotFoundError, compareVersions };
