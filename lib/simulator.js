// Simulator process management and polling.

const { execFile } = require('child_process');
const { createLogger, logWarn } = require('./logger');
const log = createLogger('simulator');

// Platform-specific config: returns { cmd, args, detect, processName } for the polling loop.
function _getSimulatorConfig() {
  if (process.platform === 'win32') {
    return {
      cmd: 'tasklist.exe',
      args: ['/FI', 'IMAGENAME eq simulator.exe', '/NH'],
      detect: (err, out) => !err && out && out.toLowerCase().includes('simulator.exe'),
      processName: 'simulator.exe',
    };
  }
  // macOS and Linux: use pgrep (case-insensitive)
  return {
    cmd: 'pgrep',
    args: ['-i', 'simulator'],
    detect: (err) => !err, // pgrep exits 0 when the process is found
    processName: 'simulator',
  };
}

/**
 * One-shot check: is the Garmin simulator process currently running?
 * Canonical implementation — preview.js re-exports this as isSimulatorRunning.
 *
 * @returns {Promise<boolean>}
 */
async function platformSimulatorCheck() {
  const { cmd, args, detect } = _getSimulatorConfig();
  return new Promise((resolve) => {
    execFile(cmd, args, (err, out) => resolve(detect(err, out)));
  });
}

function waitForSimulator(callback, deadline) {
  if (!deadline) deadline = Date.now() + 20000;

  const { cmd, args, detect, processName } = _getSimulatorConfig();
  let delay = 500; // Start at 500ms for fast initial detection
  let callbackInvoked = false;
  let timer = null;        // Track the pending callback timer (8s post-detection or final callback)
  let pollTimer = null;    // Track the adaptive polling timer

  const invokeCallbackOnce = (afterDelay = 0, timedOut = false) => {
    if (!callbackInvoked) {
      callbackInvoked = true;

      // Clear any pending timers before invoking callback
      if (timer) { clearTimeout(timer); timer = null; }
      if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }

      if (afterDelay > 0) {
        timer = setTimeout(() => {
          timer = null;
          callback(timedOut);
        }, afterDelay);
      } else {
        callback(timedOut);
      }
    }
  };

  const poll = () => {
    execFile(cmd, args, (err, out) => {
      // Guard against callback already invoked (race safety)
      if (callbackInvoked) return;

      if (detect(err, out)) {
        log.info({ processName }, 'Simulator running — waiting 8s for init');
        invokeCallbackOnce(8000, false); // success: timedOut = false
      } else {
        // Log unexpected errors (ENOENT means tool missing — warn once, keep polling)
        if (err && err.code !== 1) {
          logWarn('simulator:poll-error', { cmd, code: err.code, message: err.message });
        }
        if (Date.now() < deadline) {
          delay = Math.min(delay * 1.5, 3000); // Exponential backoff, capped at 3s
          pollTimer = setTimeout(() => {
            pollTimer = null;
            poll();
          }, delay);
        } else {
          log.error({ deadlineMs: 20000 }, 'Simulator never became ready within timeout');
          invokeCallbackOnce(0, true); // deadline expired: timedOut = true
        }
      }
    });
  };

  // Initial poll
  poll();

  // Return a cleanup function for early cancellation (if user closes preview before simulator ready)
  return () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  };
}

module.exports = { waitForSimulator, platformSimulatorCheck };
