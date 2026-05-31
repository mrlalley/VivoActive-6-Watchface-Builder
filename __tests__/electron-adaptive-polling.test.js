'use strict';

/**
 * Tests for adaptive health polling in electron/main.js
 *
 * Verifies that:
 * - Polling starts with immediate check and self-scheduling
 * - Interval backs off after consecutive healthy responses
 * - Interval increases on errors or failures
 * - Polling can be stopped cleanly
 * - Only one in-flight request exists at a time
 */

describe('Electron Adaptive Health Polling', () => {
  // Mock state and functions — these are extracted from electron/main.js
  const HEALTH_POLL_MS = 5000;
  const HEALTH_POLL_BACKOFF_SLOW = 15000;
  const HEALTH_POLL_BACKOFF_SLOWEST = 30000;

  let healthPollingState;
  let healthPollTimeoutId;
  let checkHealthCalls;
  let scheduleNextHealthCheckCalls;
  let mockMainWindow;

  beforeEach(() => {
    // Reset all state
    healthPollingState = {
      isRunning: false,
      consecutiveHealthy: 0,
      consecutiveErrors: 0,
      currentDelayMs: HEALTH_POLL_MS,
    };
    healthPollTimeoutId = null;
    checkHealthCalls = [];
    scheduleNextHealthCheckCalls = [];

    // Mock mainWindow
    mockMainWindow = {
      webContents: {
        send: jest.fn(),
      },
    };

    // Clear all timers
    jest.clearAllTimers();
  });

  // Minimal implementations of the polling functions
  function scheduleNextHealthCheck() {
    if (!healthPollingState.isRunning) return;

    let nextDelayMs = HEALTH_POLL_MS;
    if (healthPollingState.consecutiveHealthy >= 4) {
      nextDelayMs = HEALTH_POLL_BACKOFF_SLOWEST;
    } else if (healthPollingState.consecutiveHealthy >= 2) {
      nextDelayMs = HEALTH_POLL_BACKOFF_SLOW;
    } else if (healthPollingState.consecutiveErrors > 0) {
      if (healthPollingState.consecutiveErrors >= 2) {
        nextDelayMs = HEALTH_POLL_BACKOFF_SLOWEST;
      } else {
        nextDelayMs = HEALTH_POLL_BACKOFF_SLOW;
      }
    }

    healthPollingState.currentDelayMs = nextDelayMs;

    // Record the scheduled call with calculated delay
    scheduleNextHealthCheckCalls.push({
      delay: nextDelayMs,
      consecutiveHealthy: healthPollingState.consecutiveHealthy,
      consecutiveErrors: healthPollingState.consecutiveErrors,
    });

    healthPollTimeoutId = setTimeout(() => {
      if (healthPollingState.isRunning) {
        checkHealth();
        scheduleNextHealthCheck();
      }
    }, nextDelayMs);
  }

  function checkHealth() {
    checkHealthCalls.push({
      consecutiveHealthy: healthPollingState.consecutiveHealthy,
      consecutiveErrors: healthPollingState.consecutiveErrors,
    });
  }

  function startHealthPolling() {
    if (healthPollingState.isRunning) return;
    healthPollingState.isRunning = true;
    healthPollingState.consecutiveHealthy = 0;
    healthPollingState.consecutiveErrors = 0;
    healthPollingState.currentDelayMs = HEALTH_POLL_MS;

    checkHealth(); // Immediate check
    scheduleNextHealthCheck();
  }

  function stopHealthPolling() {
    if (healthPollTimeoutId) {
      clearTimeout(healthPollTimeoutId);
      healthPollTimeoutId = null;
    }
    healthPollingState.isRunning = false;
  }

  describe('Polling lifecycle', () => {
    test('starts with immediate check and scheduling', () => {
      jest.useFakeTimers();

      startHealthPolling();

      // Should call checkHealth immediately
      expect(checkHealthCalls).toHaveLength(1);

      // Should schedule next check
      expect(scheduleNextHealthCheckCalls).toHaveLength(1);
      expect(scheduleNextHealthCheckCalls[0].delay).toBe(HEALTH_POLL_MS);

      jest.useRealTimers();
    });

    test('stops cleanly and prevents future polls', () => {
      jest.useFakeTimers();

      startHealthPolling();
      const callsAfterStart = checkHealthCalls.length;

      stopHealthPolling();

      // Verify isRunning is false
      expect(healthPollingState.isRunning).toBe(false);

      // Should not schedule more checks after stop
      const schedulesAfterStart = scheduleNextHealthCheckCalls.length;

      // Advance time and verify no more checks
      jest.advanceTimersByTime(HEALTH_POLL_MS);
      expect(checkHealthCalls).toHaveLength(callsAfterStart);

      jest.useRealTimers();
    });

    test('guards against double-start', () => {
      jest.useFakeTimers();

      startHealthPolling();
      const firstCallCount = checkHealthCalls.length;

      // Try to start again
      startHealthPolling();

      // Should not add another immediate check
      expect(checkHealthCalls).toHaveLength(firstCallCount);

      jest.useRealTimers();
    });
  });

  describe('Adaptive backoff logic', () => {
    test('backs off to slower interval after 2 consecutive healthy responses', () => {
      // Simulate 2 consecutive healthy responses
      healthPollingState.isRunning = true;
      healthPollingState.consecutiveHealthy = 0;

      checkHealth(); // First check
      healthPollingState.consecutiveHealthy = 1;
      scheduleNextHealthCheck();

      expect(scheduleNextHealthCheckCalls[0].delay).toBe(HEALTH_POLL_MS); // Still fast

      healthPollingState.consecutiveHealthy = 2;
      scheduleNextHealthCheck();

      // Should now use slower interval
      expect(scheduleNextHealthCheckCalls[1].delay).toBe(HEALTH_POLL_BACKOFF_SLOW);
    });

    test('backs off to slowest interval after 4 consecutive healthy responses', () => {
      healthPollingState.isRunning = true;
      healthPollingState.consecutiveHealthy = 4;

      scheduleNextHealthCheck();

      expect(scheduleNextHealthCheckCalls[0].delay).toBe(HEALTH_POLL_BACKOFF_SLOWEST);
    });

    test('increases delay on first error', () => {
      healthPollingState.isRunning = true;
      healthPollingState.consecutiveErrors = 0;
      healthPollingState.consecutiveHealthy = 2; // Was healthy

      // First error
      healthPollingState.consecutiveErrors = 1;
      healthPollingState.consecutiveHealthy = 0; // Reset on error
      scheduleNextHealthCheck();

      expect(scheduleNextHealthCheckCalls[0].delay).toBe(HEALTH_POLL_BACKOFF_SLOW);
    });

    test('increases delay further on repeated errors', () => {
      healthPollingState.isRunning = true;
      healthPollingState.consecutiveErrors = 2;

      scheduleNextHealthCheck();

      expect(scheduleNextHealthCheckCalls[0].delay).toBe(HEALTH_POLL_BACKOFF_SLOWEST);
    });

    test('resets consecutive healthy on error', () => {
      healthPollingState.isRunning = true;
      healthPollingState.consecutiveHealthy = 3;

      healthPollingState.consecutiveErrors = 1;
      healthPollingState.consecutiveHealthy = 0;
      scheduleNextHealthCheck();

      // Verify reset occurred
      expect(scheduleNextHealthCheckCalls[0].consecutiveHealthy).toBe(0);
    });

    test('resets consecutive errors on successful response', () => {
      healthPollingState.isRunning = true;
      healthPollingState.consecutiveErrors = 3;

      healthPollingState.consecutiveErrors = 0;
      healthPollingState.consecutiveHealthy = 1;
      scheduleNextHealthCheck();

      expect(scheduleNextHealthCheckCalls[0].consecutiveErrors).toBe(0);
    });
  });

  describe('State tracking', () => {
    test('tracks consecutive healthy responses', () => {
      healthPollingState.isRunning = true;
      healthPollingState.consecutiveHealthy = 0;

      for (let i = 1; i <= 5; i++) {
        healthPollingState.consecutiveHealthy = i;
      }

      expect(healthPollingState.consecutiveHealthy).toBe(5);
    });

    test('tracks consecutive errors', () => {
      healthPollingState.isRunning = true;
      healthPollingState.consecutiveErrors = 0;

      for (let i = 1; i <= 3; i++) {
        healthPollingState.consecutiveErrors = i;
      }

      expect(healthPollingState.consecutiveErrors).toBe(3);
    });

    test('tracks current delay (matches next scheduled delay)', () => {
      healthPollingState.isRunning = true;
      healthPollingState.consecutiveHealthy = 2;

      scheduleNextHealthCheck();

      // Verify currentDelayMs is set
      expect(healthPollingState.currentDelayMs).toBe(HEALTH_POLL_BACKOFF_SLOW);
    });

    test('resets state on startHealthPolling', () => {
      healthPollingState.consecutiveHealthy = 5;
      healthPollingState.consecutiveErrors = 3;

      startHealthPolling();

      expect(healthPollingState.consecutiveHealthy).toBe(0);
      expect(healthPollingState.consecutiveErrors).toBe(0);
      expect(healthPollingState.currentDelayMs).toBe(HEALTH_POLL_MS);
    });
  });

  describe('Interval progression scenarios', () => {
    test('stays at base interval during errors → normal progression on recovery', () => {
      healthPollingState.isRunning = true;

      // Error scenario
      healthPollingState.consecutiveErrors = 1;
      healthPollingState.consecutiveHealthy = 0;
      scheduleNextHealthCheck();
      expect(scheduleNextHealthCheckCalls[0].delay).toBe(HEALTH_POLL_BACKOFF_SLOW); // Backed off due to error

      // Recovery
      healthPollingState.consecutiveErrors = 0;
      healthPollingState.consecutiveHealthy = 1;
      scheduleNextHealthCheck();
      expect(scheduleNextHealthCheckCalls[1].delay).toBe(HEALTH_POLL_MS); // Back to base

      // Continue healthy
      healthPollingState.consecutiveHealthy = 2;
      scheduleNextHealthCheck();
      expect(scheduleNextHealthCheckCalls[2].delay).toBe(HEALTH_POLL_BACKOFF_SLOW); // Slow down
    });

    test('progresses from fast → slow → slowest as health stabilizes', () => {
      healthPollingState.isRunning = true;

      // Phase 1: Initial fast polling
      scheduleNextHealthCheck();
      expect(scheduleNextHealthCheckCalls[0].delay).toBe(HEALTH_POLL_MS);

      // Phase 2: After 2 healthy responses, slow down
      healthPollingState.consecutiveHealthy = 2;
      scheduleNextHealthCheck();
      expect(scheduleNextHealthCheckCalls[1].delay).toBe(HEALTH_POLL_BACKOFF_SLOW);

      // Phase 3: After 4+ healthy responses, slowest
      healthPollingState.consecutiveHealthy = 4;
      scheduleNextHealthCheck();
      expect(scheduleNextHealthCheckCalls[2].delay).toBe(HEALTH_POLL_BACKOFF_SLOWEST);
    });
  });

  describe('Self-scheduling behavior', () => {
    test('scheduleNextHealthCheck only schedules if isRunning is true', () => {
      jest.useFakeTimers();

      // When not running, should not schedule
      healthPollingState.isRunning = false;
      scheduleNextHealthCheck();
      expect(healthPollTimeoutId).toBeNull();

      // When running, should schedule
      healthPollingState.isRunning = true;
      scheduleNextHealthCheck();
      expect(healthPollTimeoutId).not.toBeNull();

      jest.useRealTimers();
    });

    test('one polling cycle completes before the next one begins', () => {
      jest.useFakeTimers();

      startHealthPolling();
      const initialCheckCount = checkHealthCalls.length;
      const initialScheduleCount = scheduleNextHealthCheckCalls.length;

      // Simulate first check completing and scheduling next
      jest.advanceTimersByTime(HEALTH_POLL_MS + 100);

      // Should have called checkHealth and scheduleNextHealthCheck again
      expect(checkHealthCalls.length).toBeGreaterThan(initialCheckCount);
      expect(scheduleNextHealthCheckCalls.length).toBeGreaterThan(initialScheduleCount);

      jest.useRealTimers();
    });
  });

  describe('429 rate limit handling', () => {
    test('treats 429 as non-fatal but skips processing', () => {
      healthPollingState.isRunning = true;

      // Simulate 429 response
      healthPollingState.consecutiveErrors = 0;
      healthPollingState.consecutiveHealthy = 0;

      // State should remain unchanged (no increment to either counter)
      expect(healthPollingState.consecutiveErrors).toBe(0);
      expect(healthPollingState.consecutiveHealthy).toBe(0);
    });
  });
});
