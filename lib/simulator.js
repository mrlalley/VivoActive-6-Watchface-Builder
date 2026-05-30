// Simulator process management and polling.

const { execFile } = require('child_process');
const { logWarn } = require('./logger');

function waitForSimulator(callback, deadline) {
  if (!deadline) deadline = Date.now() + 20000;

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
    execFile('tasklist.exe', ['/FI', 'IMAGENAME eq simulator.exe', '/NH'], (err, out) => {
      // Guard against callback already invoked (race safety)
      if (callbackInvoked) return;

      // Log errors for visibility, but continue anyway (assume simulator not running)
      if (err) {
        logWarn('simulator:tasklist-error', { code: err.code, message: err.message });
        // Treat error as "simulator not running" (safe default)
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
        return;
      }

      if (out && out.toLowerCase().includes('simulator.exe')) {
        console.log('[sim] simulator.exe is running — waiting 8s for init');
        invokeCallbackOnce(8000);
      } else if (Date.now() < deadline) {
        delay = Math.min(delay * 1.5, 3000); // Exponential backoff, capped at 3s
        pollTimer = setTimeout(() => {
          pollTimer = null;
          poll();
        }, delay);
      } else {
        console.error('[sim] simulator never became ready within 20s');
        invokeCallbackOnce();
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
