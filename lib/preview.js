// Simulator and preview management.
// Handles launching the simulator and loading .prg files.

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

const { logInfo, logError, logWarn } = require('./logger');
const { waitForSimulator, platformSimulatorCheck } = require('./simulator');
const { PREVIEW_TIMEOUT_MS } = require('../src/constants/timing');

// Canonical implementation lives in simulator.js; re-exported here for backward compatibility.
const isSimulatorRunning = platformSimulatorCheck;

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
    requestId = crypto.randomBytes(6).toString('hex');
  }

  // Return immediately, continue work asynchronously
  setImmediate(async () => {
    // Declared outside try so the catch block can cancel the simulator poll timers
    // if an error is thrown before waitForSimulator resolves.
    let cancelWait;

    try {
      // Check if simulator is running
      const simRunning = await platformSimulatorCheck();
      if (!simRunning) {
        launchSimulator(cfg);
      }

      // Wait for simulator to become ready.
      // Capture the cancellation handle so the catch block can stop the poll timers.
      await new Promise((resolve) => {
        cancelWait = waitForSimulator((timedOut) => {
          if (timedOut) {
            logWarn('preview:simulator-timeout', { requestId });
          }
          resolve();
        });
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

      // On Windows: .bat files require shell: true; on Unix: native binaries
      // monkeydo arguments: [prgPath, device]
      const previewArgs = [prgArg, 'vivoactive6'];
      const spawnOpts = process.platform === 'win32' ? { shell: true } : {};
      const monkeydoExe = process.platform === 'win32' ? `"${cfg.monkeydo}"` : cfg.monkeydo;
      const child = spawn(monkeydoExe, previewArgs, spawnOpts);

      // Set up timeout: kill process if it exceeds PREVIEW_TIMEOUT_MS
      const timeoutHandle = setTimeout(() => {
        logWarn('preview:timeout-killing-process', { requestId, timeout: PREVIEW_TIMEOUT_MS });
        child.kill('SIGTERM');
      }, PREVIEW_TIMEOUT_MS);

      let mdOut = '';
      let mdErr = '';
      let spawnError = null;

      child.stdout.on('data', (data) => {
        mdOut += data.toString();
      });

      child.stderr.on('data', (data) => {
        mdErr += data.toString();
      });

      child.on('error', (err) => {
        // Clear timeout to prevent it from firing after error
        clearTimeout(timeoutHandle);
        spawnError = err;
        const mdLog = [mdOut, mdErr].filter(Boolean).join('\n').trim();
        let userMessage;

        if (err.code === 'ENOENT') {
          userMessage = `monkeydo not found — Garmin SDK may not be properly installed`;
          logError('preview:monkeydo-not-found', { path: cfg.monkeydo, requestId });
        } else if (err.code === 'EACCES') {
          userMessage = `Permission denied executing monkeydo`;
          logError('preview:permission-denied', { path: cfg.monkeydo, requestId });
        } else {
          userMessage = `Failed to load .prg: ${err.message}`;
          logError('preview:spawn-failed', { error: err.message, requestId });
        }

        if (onError) onError(userMessage);

        // Cleanup temporary directory
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
          logInfo('preview:temp-cleanup', { requestId, tmpDir });
        } catch (cleanupErr) {
          logWarn('preview:cleanup-failed', { requestId, tmpDir, reason: cleanupErr.message });
        }
      });

      child.on('close', (code, signal) => {
        // Clear timeout to prevent it from firing after process exit
        clearTimeout(timeoutHandle);

        const mdLog = [mdOut, mdErr].filter(Boolean).join('\n').trim();

        try {
          // Only treat exit code 0 as success; non-zero codes indicate failure
          if (code !== 0 && !spawnError) {
            let userMessage;

            if (signal === 'SIGTERM' || signal === 'SIGKILL') {
              userMessage = `Preview timed out after ${PREVIEW_TIMEOUT_MS / 1000} seconds. Try again or check simulator.`;
              logError('preview:timeout', { signal, requestId, timeoutMs: PREVIEW_TIMEOUT_MS });
            } else {
              userMessage = `Simulator loading failed (exit code ${code})`;
              logError('preview:monkeydo-failed', { code, signal, stderr: mdErr || '(no stderr)', requestId });
            }

            if (onError) onError(userMessage);
          } else if (code === 0 && !spawnError) {
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
      // Cancel any in-flight waitForSimulator poll timers before reporting the error.
      if (cancelWait) cancelWait();
      logError('preview:failed', { reason: err.message, requestId });
      if (onError) onError(err.message);
    }
  });
}

module.exports = { previewInSimulator, isSimulatorRunning, launchSimulator };
