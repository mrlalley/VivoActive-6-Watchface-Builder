// Simulator and preview management.
// Handles launching the simulator and loading .prg files.

const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

const { logInfo, logError, logWarn } = require('./logger');
const { waitForSimulator } = require('./simulator');

/**
 * Check if the Garmin Connect IQ simulator is currently running.
 * Windows-only implementation using tasklist.exe.
 *
 * @returns {Promise<boolean>} True if simulator is running
 */
async function isSimulatorRunning() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      // On macOS/Linux, assume simulator isn't running for now
      // TODO: Implement cross-platform simulator detection
      resolve(false);
      return;
    }

    execFile('tasklist.exe', ['/FI', 'IMAGENAME eq simulator.exe', '/NH'], (err, out) => {
      const isRunning = out && out.toLowerCase().includes('simulator.exe');
      resolve(isRunning);
    });
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
 * @param {Function} onError - Optional error callback
 */
function previewInSimulator(cfg, prgPath, onError = null) {
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

      // Copy .prg to temp directory for preview
      const tmpDir = cfg.tempDir;
      const tmpPrg = path.join(tmpDir, 'WatchFace.prg');

      try {
        fs.mkdirSync(tmpDir, { recursive: true });
        fs.copyFileSync(prgPath, tmpPrg);
        logInfo('preview:prg-copied', { from: prgPath, to: tmpPrg });
      } catch (copyErr) {
        logWarn('preview:prg-copy-failed', { reason: copyErr.message });
      }

      // Execute monkeydo to load .prg into simulator
      const prgArg = fs.existsSync(tmpPrg) ? tmpPrg : prgPath;
      logInfo('preview:loading-prg', { prgPath: prgArg });

      const isWindows = process.platform === 'win32';
      const cmd = isWindows ? 'cmd.exe' : cfg.monkeydo;
      const args = isWindows
        ? ['/c', cfg.monkeydo, prgArg, 'vivoactive6']
        : [prgArg, 'vivoactive6'];

      execFile(cmd, args, (mdErr, mdOut, mdErr2) => {
        const mdLog = [mdOut, mdErr2].filter(Boolean).join('\n').trim();

        if (mdErr) {
          // Distinguish error types for better diagnostics
          let userMessage;

          if (mdErr.code === 'ENOENT') {
            userMessage = `monkeydo not found — Garmin SDK may not be properly installed`;
            logError('preview:monkeydo-not-found', { path: cfg.monkeydo });
          } else if (mdErr.code === 'EACCES') {
            userMessage = `Permission denied executing monkeydo`;
            logError('preview:permission-denied', { path: cfg.monkeydo });
          } else if (mdErr.signal === 'SIGTERM') {
            userMessage = `Simulator loading was interrupted`;
            logError('preview:interrupted', { signal: mdErr.signal });
          } else {
            userMessage = `Failed to load .prg: ${mdErr.message}`;
            logError('preview:monkeydo-failed', { code: mdErr.code, message: mdErr.message });
          }

          if (onError) onError(userMessage);
        } else {
          logInfo('preview:monkeydo-success', {});
        }
      });
    } catch (err) {
      logError('preview:failed', { reason: err.message });
      if (onError) onError(err.message);
    }
  });
}

module.exports = { previewInSimulator, isSimulatorRunning, launchSimulator };
