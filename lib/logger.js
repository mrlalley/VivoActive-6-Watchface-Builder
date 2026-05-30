// Structured JSON logging for audit trails and debugging.

function log(level, message, context = {}) {
  const timestamp = new Date().toISOString();
  console.log(JSON.stringify({ timestamp, level, message, ...context }));
}

function logInfo(message, context = {}) {
  log('INFO', message, context);
}

function logError(message, context = {}) {
  log('ERROR', message, context);
}

function logWarn(message, context = {}) {
  log('WARN', message, context);
}

module.exports = { log, logInfo, logError, logWarn };
