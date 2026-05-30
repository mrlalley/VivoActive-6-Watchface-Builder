// Simulator process management and polling.

const { execFile } = require('child_process');
const { logWarn } = require('./logger');

function waitForSimulator(callback, deadline) {
  if (!deadline) deadline = Date.now() + 20000;
  execFile('tasklist.exe', ['/FI', 'IMAGENAME eq simulator.exe', '/NH'], (err, out) => {
    // Log errors for visibility, but continue anyway (assume simulator not running)
    if (err) {
      logWarn('simulator:tasklist-error', { code: err.code, message: err.message });
      // Treat error as "simulator not running" (safe default)
      if (Date.now() < deadline) {
        setTimeout(() => waitForSimulator(callback, deadline), 1000);
      } else {
        console.error('[sim] simulator never became ready within 20s');
        callback();
      }
      return;
    }

    if (out && out.toLowerCase().includes('simulator.exe')) {
      console.log('[sim] simulator.exe is running — waiting 8s for init');
      setTimeout(callback, 8000);
    } else if (Date.now() < deadline) {
      setTimeout(() => waitForSimulator(callback, deadline), 1000);
    } else {
      console.error('[sim] simulator never became ready within 20s');
      callback();
    }
  });
}

module.exports = { waitForSimulator };
