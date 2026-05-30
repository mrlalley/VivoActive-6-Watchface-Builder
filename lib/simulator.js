// Simulator process management and polling.

const { execFile } = require('child_process');
const { logWarn } = require('./logger');

// Platform-specific check: returns [command, args, detectionFn]
// detectionFn receives (err, stdout) and returns true when the simulator is found.
function platformSimulatorCheck() {
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

function waitForSimulator(callback, deadline) {
  if (!deadline) deadline = Date.now() + 20000;

  const { cmd, args, detect, processName } = platformSimulatorCheck();
  let delay = 500; // Start at 500ms for fast initial detection
  let callbackInvoked = false;
  let timer = null;        // Track the pending callback timer (8s post-detection or final callback)
  let pollTimer = null;    // Track the adaptive polling timer

  const invokeCallbackOnce = (afterDelay = 0) => {
    if (!callbackInvoked) {
      callbackInvoked = true;

      // Clear any pending timers before invoking callback
      if (timer) { clearTimeout(timer); timer = null; }
      if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }

      if (afterDelay > 0) {
        timer = setTimeout(() => {
          timer = null;
          callback();
        }, afterDelay);
      } else {
        callback();
      }
    }
  };

  const poll = () => {
    execFile(cmd, args, (err, out) => {
      // Guard against callback already invoked (race safety)
      if (callbackInvoked) return;

      if (detect(err, out)) {
        console.log(`[sim] ${processName} is running — waiting 8s for init`);
        invokeCallbackOnce(8000);
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
          console.error('[sim] simulator never became ready within 20s');
          invokeCallbackOnce();
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

module.exports = { waitForSimulator };
