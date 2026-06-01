// IPC infrastructure: logging and rate limiting helpers

function createLoggedHandle(ipcMain, log) {
  return function loggedHandle(channel, handler) {
    ipcMain.handle(channel, async (event, payload) => {
      const ipcLog = log.child({ channel });
      const startMs = Date.now();
      ipcLog.debug({ event: 'ipc.invoke.start' });
      try {
        const result = await handler(event, payload);
        ipcLog.debug({ event: 'ipc.invoke.success', durationMs: Date.now() - startMs });
        return result;
      } catch (err) {
        ipcLog.error({ event: 'ipc.invoke.failure', message: err.message, durationMs: Date.now() - startMs });
        throw err;
      }
    });
  };
}

function createRateLimitHandler(ipcMain) {
  return function withRateLimit(handlerName, handler, delayMs = 1000) {
    let lastCall = 0;
    ipcMain.handle(handlerName, async (event, ...args) => {
      const now = Date.now();
      if (now - lastCall < delayMs) {
        throw new Error(`Rate limited: please wait ${Math.ceil((delayMs - (now - lastCall)) / 1000)}s before retrying`);
      }
      lastCall = now;
      return handler(event, ...args);
    });
  };
}

module.exports = {
  createLoggedHandle,
  createRateLimitHandler,
};
