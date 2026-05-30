// Simulator and preview management.
// Handles launching the simulator and loading .prg files.

const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

const { logInfo, logError, logWarn } = require('./logger');
const { waitForSimulator } = require('./simulator');
const { PREVIEW_TIMEOUT_MS } = require('../src/constants/timing');

/**
 * Check if the Garmin Connect IQ simulator is currently running.
 * Platform-specific implementations:
 * - Windows: tasklist.exe
 * - macOS/Linux: pgrep (POSIX process grep)
 *
 * @returns {Promise<boolean>} True if simulator is running
 */
async function isSimulatorRunning() {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      // Windows: use tasklist.exe to check for simulator.exe
      execFile('tasklist.exe', ['/FI', 'IMAGENAME eq simulator.exe', '/NH'], (err, out) => {
        const isRunning = out && out.toLowerCase().includes('simulator.exe');
        resolve(isRunning);
      });
    } else if (process.platform === 'darwin' || process.platform === 'linux') {
      // macOS (darwin) and Linux: use pgrep to check for simulator process
      // pgrep -i simulator (case-insensitive) returns exit code 0 if found
      execFile('pgrep', ['-i', 'simulator'], (err) => {
        // pgrep exits with code 0 if process found, 1 if not found, 2+ for errors
        const isRunning = !err || err.code === 0;
        resolve(isRunning);
      });
    } else {
      // Unknown platform: assume simulator not running
      resolve(false);
    }
  });
}

/**
 * Launch the Garmin Connect IQ simulator.
 * Spawns as detached process so it runs independently.
 *
 * @param {Object} cfg - Configuration object { simExe, ... }
 */
function launchSimulator(cfg) {
  try {
    logInfo('preview:launching-simulator', {});
    const child = spawn(cfg.simExe, [], { detached: true, stdio: 'ignore' });
    // Handle spawn errors (e.g., executable not found)
    child.on('error', (err) => {
      logError('preview:launch-failed', { reason: err.message, code: err.code });
    });
    child.unref();
  } catch (err) {
    logError('preview:launch-failed', { reason: err.message });
  }
}

/**
 * Preview a watch face in the running simulator.
 *
 * This is a fire-and-forget operation:
 * - Returns immediately after the simulator is running or launching
 * - Continues work asynchronously (copy .prg, execute monkeydo)
 * - Errors are logged but don't block the caller
 *
 * @param {Object} cfg - Configuration object { simExe, monkeydo, exportDir, tempDir, ... }
 * @param {string} prgPath - Full path to compiled .prg file
 * @param {string} requestId - Optional unique request ID for temp directory isolation
 * @param {Function} onError - Optional error callback
 */
function previewInSimulator(cfg, prgPath, requestId = null, onError = null) {
  // Handle argument overloading (requestId or onError could be passed as second param)
  if (typeof requestId === 'function') {
    onError = requestId;
    requestId = null;
  }

  // Generate unique request ID if not provided (prevents temp file collisions)
  if (!requestId) {
    requestId = Math.random().toString(36).slice(2, 10);
  }

  // Return immediately, continue work asynchronously
  setImmediate(async () => {
    try {
      // Check if simulator is running
      const simRunning = await isSimulatorRunning();
      if (!simRunning) {
        launchSimulator(cfg);
      }

      // Wait for simulator to become ready
      await new Promise((resolve) => {
        waitForSimulator(() => resolve());
      });

      // Copy .prg to request-scoped temp directory (prevents collisions from concurrent previews)
      const tmpDir = path.join(cfg.tempDir, `preview-${requestId}`);
      const tmpPrg = path.join(tmpDir, 'WatchFace.prg');

      try {
        fs.mkdirSync(tmpDir, { recursive: true });
        fs.copyFileSync(prgPath, tmpPrg);
        logInfo('preview:prg-copied', { from: prgPath, to: tmpPrg, requestId });
      } catch (copyErr) {
        logWarn('preview:prg-copy-failed', { reason: copyErr.message, requestId });
      }

      // Execute monkeydo to load .prg into simulator
      const prgArg = fs.existsSync(tmpPrg) ? tmpPrg : prgPath;
      logInfo('preview:loading-prg', { prgPath: prgArg, requestId });

      const isWindows = process.platform === 'win32';
      const cmd = isWindows ? 'cmd.exe' : cfg.monkeydo;
      const args = isWindows
        ? ['/c', cfg.monkeydo, prgArg, 'vivoactive6']
        : [prgArg, 'vivoactive6'];

      execFile(cmd, args, { timeout: PREVIEW_TIMEOUT_MS }, (mdErr, mdOut, mdErr2) => {
        const mdLog = [mdOut, mdErr2].filter(Boolean).join('\n').trim();

        try {
          if (mdErr) {
            // Distinguish error types for better diagnostics
            let userMessage;

            if (mdErr.code === 'ETIMEDOUT') {
              userMessage = `Simulator loading timed out after ${PREVIEW_TIMEOUT_MS / 1000} seconds`;
              logError('preview:monkeydo-timeout', { timeout: PREVIEW_TIMEOUT_MS, requestId });
            } else if (mdErr.code === 'ENOENT') {
              userMessage = `monkeydo not found — Garmin SDK may not be properly installed`;
              logError('preview:monkeydo-not-found', { path: cfg.monkeydo, requestId });
            } else if (mdErr.code === 'EACCES') {
              userMessage = `Permission denied executing monkeydo`;
              logError('preview:permission-denied', { path: cfg.monkeydo, requestId });
            } else if (mdErr.signal === 'SIGTERM') {
              userMessage = `Simulator loading was interrupted`;
              logError('preview:interrupted', { signal: mdErr.signal, requestId });
            } else {
              userMessage = `Failed to load .prg: ${mdErr.message}`;
              logError('preview:monkeydo-failed', { code: mdErr.code, message: mdErr.message, requestId });
            }

            if (onError) onError(userMessage);
          } else {
            logInfo('preview:monkeydo-success', { requestId });
          }
        } finally {
          // Cleanup temporary directory in all paths (success, error, timeout)
          try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
            logInfo('preview:temp-cleanup', { requestId, tmpDir });
          } catch (cleanupErr) {
            logWarn('preview:cleanup-failed', { requestId, tmpDir, reason: cleanupErr.message });
          }
        }
      });
    } catch (err) {
      logError('preview:failed', { reason: err.message, requestId });
      if (onError) onError(err.message);
    }
  });
}

module.exports = { previewInSimulator, isSimulatorRunning, launchSimulator };
