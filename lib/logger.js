// Structured JSON logging for audit trails and debugging.
// Redacts sensitive fields (paths, keys) to prevent information disclosure.

function redactSensitiveFields(context) {
  const redacted = { ...context };
  const sensitiveKeys = ['path', 'devKey', 'projectPath', 'exportDir', 'tempDir', 'keyPath', 'filePath', 'prgPath', 'designPath'];

  sensitiveKeys.forEach(key => {
    if (redacted[key]) {
      redacted[key] = '***redacted***';
    }
  });

  return redacted;
}

function log(level, message, context = {}) {
  const timestamp = new Date().toISOString();
  const safeContext = redactSensitiveFields(context);
  console.log(JSON.stringify({ timestamp, level, message, ...safeContext }));
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
