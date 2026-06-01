// Health polling: check server health and send status to renderer

// Polling state for adaptive backoff logic
const HEALTH_POLL_MS = 5000; // Initial poll interval
const HEALTH_POLL_BACKOFF_SLOW = 15000; // Slower interval after consecutive healthy responses
const HEALTH_POLL_BACKOFF_SLOWEST = 30000; // Slowest interval when health is stable

function createHealthPollingManager(serverUrl, sessionToken, log) {
  let healthPollTimeoutId = null;
  let mainWindow = null;

  const healthPollingState = {
    isRunning: false,
    consecutiveHealthy: 0,
    consecutiveErrors: 0,
    currentDelayMs: HEALTH_POLL_MS,
  };

  function scheduleNextHealthCheck() {
    if (!healthPollingState.isRunning) return;

    // Determine delay for next check based on health state
    let nextDelayMs = HEALTH_POLL_MS;
    if (healthPollingState.consecutiveHealthy >= 4) {
      // After many consecutive healthy responses, slow down significantly
      nextDelayMs = HEALTH_POLL_BACKOFF_SLOWEST;
    } else if (healthPollingState.consecutiveHealthy >= 2) {
      // After a couple healthy responses, slow down moderately
      nextDelayMs = HEALTH_POLL_BACKOFF_SLOW;
    } else if (healthPollingState.consecutiveErrors > 0) {
      // On errors, back off progressively (5s → 15s → 30s)
      if (healthPollingState.consecutiveErrors >= 2) {
        nextDelayMs = HEALTH_POLL_BACKOFF_SLOWEST;
      } else {
        nextDelayMs = HEALTH_POLL_BACKOFF_SLOW;
      }
    }

    healthPollingState.currentDelayMs = nextDelayMs;
    healthPollTimeoutId = setTimeout(() => {
      if (healthPollingState.isRunning) {
        checkHealth();
        scheduleNextHealthCheck();
      }
    }, nextDelayMs);
  }

  // Check server health and send status to renderer.
  // Sends x-wfb-token so /api/health auth passes when token enforcement is active.
  // Updates adaptive polling backoff state.
  async function checkHealth() {
    try {
      const res = await fetch(`${serverUrl}/api/health`, {
        headers: { 'x-wfb-token': sessionToken },
      });

      if (res.status === 429) {
        // Rate-limited — back off but don't treat as error
        healthPollingState.consecutiveErrors = 0;
        healthPollingState.consecutiveHealthy = 0;
        return;
      }

      const health = await res.json();

      // Successful fetch and parse — either health.ok or health.ok === false
      if (health && typeof health === 'object') {
        healthPollingState.consecutiveErrors = 0;
        healthPollingState.consecutiveHealthy++;

        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('app:health-status', health);
          if (health.ok === false) { // strict: only real failures, not undefined/missing
            mainWindow.webContents.send('app:health-warning', health);
          }
        }
      } else {
        // Unexpected response format — treat as error
        healthPollingState.consecutiveErrors++;
        healthPollingState.consecutiveHealthy = 0;
      }
    } catch (err) {
      // Network error, timeout, or JSON parse error — increment error backoff
      healthPollingState.consecutiveErrors++;
      healthPollingState.consecutiveHealthy = 0;

      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('app:health-warning', {
          ok: false,
          error: 'Server unreachable',
          message: err.message
        });
      }
    }
  }

  function startHealthPolling() {
    if (healthPollingState.isRunning) return; // Already polling — guard against double-start

    healthPollingState.isRunning = true;
    healthPollingState.consecutiveHealthy = 0;
    healthPollingState.consecutiveErrors = 0;
    healthPollingState.currentDelayMs = HEALTH_POLL_MS;

    // Immediate check so the UI sees the initial state without waiting
    checkHealth();

    // Schedule the next check (will reschedule itself on completion)
    scheduleNextHealthCheck();
  }

  function stopHealthPolling() {
    if (healthPollTimeoutId) {
      clearTimeout(healthPollTimeoutId);
      healthPollTimeoutId = null;
    }
    healthPollingState.isRunning = false;
  }

  function setMainWindow(win) {
    mainWindow = win;
  }

  return {
    startHealthPolling,
    stopHealthPolling,
    checkHealth,
    setMainWindow,
  };
}

module.exports = {
  createHealthPollingManager,
};
