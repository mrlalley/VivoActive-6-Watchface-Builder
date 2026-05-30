/**
 * @fileoverview Timing-related constants for delays, intervals, and timeouts.
 */

/** Interval (milliseconds) for updating analog hand elements on the canvas. */
const ANALOG_RENDER_INTERVAL = 1000;

/** Delay (milliseconds) before hiding the save indicator in the toolbar. */
const SAVE_INDICATOR_HIDE_DELAY = 2000;

/** Timeout (milliseconds) for monkeyc compilation. Allows for complex projects and slow systems. */
const BUILD_TIMEOUT_MS = 60000; // 60 seconds

/** Timeout (milliseconds) for developer key generation via crypto. RSA-4096 is computationally expensive. */
const KEYGEN_TIMEOUT_MS = 60000; // 60 seconds

/** Delay (milliseconds) before restarting the app after config changes. */
const APP_RESTART_DELAY_MS = 100;

/** Delay (milliseconds) for health check polling after simulator startup. */
const HEALTH_CHECK_DELAY_MS = 8000; // 8 seconds

/** Polling interval (milliseconds) for checking if the Garmin Connect IQ simulator is ready. */
const SIMULATOR_POLL_INITIAL_DELAY_MS = 500; // 500ms initial

/** Maximum polling interval (milliseconds) for simulator readiness check. */
const SIMULATOR_POLL_MAX_DELAY_MS = 3000; // 3 seconds

/** Total deadline (milliseconds) for waiting for simulator to become ready before giving up. */
const SIMULATOR_STARTUP_DEADLINE_MS = 20000; // 20 seconds

module.exports = {
  ANALOG_RENDER_INTERVAL,
  SAVE_INDICATOR_HIDE_DELAY,
  BUILD_TIMEOUT_MS,
  KEYGEN_TIMEOUT_MS,
  APP_RESTART_DELAY_MS,
  HEALTH_CHECK_DELAY_MS,
  SIMULATOR_POLL_INITIAL_DELAY_MS,
  SIMULATOR_POLL_MAX_DELAY_MS,
  SIMULATOR_STARTUP_DEADLINE_MS,
};
