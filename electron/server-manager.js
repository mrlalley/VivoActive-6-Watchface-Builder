// Server management: spawn and monitor server.js process

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const { app } = require('electron');

const POLL_INTERVAL = 200;

function createServerManager(serverPort, serverUrl, sessionToken, logFilePath, store, log) {
  let serverProcess = null;

  function startServer() {
    const nodeBin = process.env.WFB_NODE_PATH || 'node';

    // Resolve platform-specific paths here (app.getPath() is unavailable in the child
    // process) and pass them as env vars. lib/config.js reads these at fallback level 2.
    const env = {
      ...process.env,
      WFB_SERVER_PORT: String(serverPort),
      WFB_SESSION_TOKEN: sessionToken, // auth token for all /api/ routes
      WFB_LOG_FILE: logFilePath || '', // log file path (empty = stdout only)
      GARMIN_EXPORT_DIR:      process.env.GARMIN_EXPORT_DIR      || path.join(app.getPath('documents'), 'WatchFaceBuilder', 'exported'),
      GARMIN_TEMP_DIR:        process.env.GARMIN_TEMP_DIR        || path.join(app.getPath('temp'), 'CIQPreview'),
      GARMIN_DESIGNS_DIR:     process.env.GARMIN_DESIGNS_DIR     || path.join(app.getPath('userData'), 'designs'),
      GARMIN_BACKGROUNDS_DIR: process.env.GARMIN_BACKGROUNDS_DIR || path.join(app.getPath('userData'), 'wfb-backgrounds'),
    };
    // Only override SDK/key paths when explicitly configured; allow auto-detect otherwise.
    if (store.get('sdkBin')) env.GARMIN_SDK_BIN = store.get('sdkBin');
    if (store.get('devKey')) env.GARMIN_DEV_KEY = store.get('devKey');

    log.debug({ event: 'server.spawn', nodeBin, tokenSet: !!env.WFB_SESSION_TOKEN, port: serverPort });

    serverProcess = spawn(nodeBin, [path.join(__dirname, '..', 'server.js')], { env, stdio: 'inherit' });

    serverProcess.on('exit', (code, signal) => {
      log.error({ event: 'server.exit', code, signal });
    });
  }

  // Poll GET /internal/healthz until the server responds 200 or the deadline expires.
  // The /internal/healthz route is always 200 when the process is alive.
  function waitForServer(timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;
      const healthUrl = `${serverUrl}/internal/healthz`;

      function poll() {
        http.get(healthUrl, (res) => {
          res.resume(); // consume response body to release the socket
          if (res.statusCode === 200) return resolve();
          retry();
        }).on('error', retry);
      }

      function retry() {
        if (Date.now() >= deadline) {
          return reject(new Error(`server.js did not become ready within ${timeoutMs}ms`));
        }
        setTimeout(poll, POLL_INTERVAL);
      }

      poll();
    });
  }

  function killServer() {
    if (serverProcess) {
      serverProcess.kill();
      serverProcess = null;
    }
  }

  function getServerProcess() {
    return serverProcess;
  }

  return {
    startServer,
    waitForServer,
    killServer,
    getServerProcess,
  };
}

module.exports = {
  createServerManager,
};
