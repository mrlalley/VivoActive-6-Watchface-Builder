'use strict';

// Structured JSON logging backed by pino.
// All server and main-process code must use createLogger() or the compat shims below.
// Never use console.log/error/warn in server.js or electron/main.js.

const pino = require('pino');
const path = require('path');
const fs   = require('fs');

const IS_TEST = process.env.NODE_ENV === 'test';

// WFB_LOG_FILE is injected by electron/main.js into the server child process env.
// In standalone mode it is not set; logs go to stdout only.
const LOG_FILE_PATH = process.env.WFB_LOG_FILE || null;

// WFB_LOG_LEVEL overrides the default log level.
// Default: 'debug' in dev/test, 'info' in production.
const IS_DEV  = process.env.ELECTRON_IS_DEV === '1';
const DEFAULT_LEVEL = (IS_TEST || IS_DEV) ? 'debug' : 'info';
const LOG_LEVEL = process.env.WFB_LOG_LEVEL || DEFAULT_LEVEL;

/**
 * Build a pino base instance appropriate for the current environment.
 * Called once at module load — not per createLogger() call.
 */
function _buildBase() {
  // In test mode suppress all output: no worker threads, no I/O.
  if (IS_TEST && !process.env.LOG_VERBOSE) {
    return pino({ level: 'silent' });
  }

  const pinoOpts = {
    level: LOG_LEVEL,
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      // Never log the session token, auth header value, or passwords.
      // Pino redacts these fields to '[REDACTED]' before serialization.
      paths:  [
        'req.headers["x-wfb-token"]',
        '*.token',
        '*.password',
        '*.sessionToken',
        '*.WFB_SESSION_TOKEN',
      ],
      censor: '[REDACTED]',
    },
  };

  if (LOG_FILE_PATH) {
    // Production Electron mode: write JSON to log file AND stdout simultaneously.
    // pino.transport() spawns a worker thread for each target — safe in Node 22.
    try {
      fs.mkdirSync(path.dirname(LOG_FILE_PATH), { recursive: true });
    } catch {
      // If directory creation fails, fall back to stdout-only below.
      return pino(pinoOpts);
    }

    const transport = pino.transport({
      targets: [
        { target: 'pino/file', options: { destination: LOG_FILE_PATH, append: true } },
        { target: 'pino/file', options: { destination: 1 } }, // stdout fd
      ],
    });
    return pino(pinoOpts, transport);
  }

  // Standalone mode or dev: write JSON to stdout only (pino default).
  // Dev tip: pipe through pino-pretty for human-readable output:
  //   npm start | npx pino-pretty          (Electron dev mode)
  //   npm run server | npx pino-pretty     (standalone server mode)
  // pino-pretty is in devDependencies for local convenience.
  return pino(pinoOpts);
}

const _base = _buildBase();

/**
 * createLogger(module)
 * Returns a pino child logger bound to the given module name.
 * Every log line emitted by this logger includes { module } automatically.
 *
 * @param {string} module - Short module identifier, e.g. 'server', 'build', 'main'
 * @returns {import('pino').Logger}
 */
function createLogger(module) {
  return _base.child({ module });
}

// ── Backward-compatible shims ────────────────────────────────────────────────
// lib/build.js, lib/preview.js, lib/design-store.js etc. use logInfo/logError/logWarn
// with the signature: logInfo(message, contextObject).
// These shims adapt that call to pino's (mergingObject, message) signature.
const _compat = createLogger('app');

function logInfo(message, context = {}) {
  _compat.info(context, message);
}

function logError(message, context = {}) {
  _compat.error(context, message);
}

function logWarn(message, context = {}) {
  _compat.warn(context, message);
}

// Legacy: lib code that imported { log } used log('INFO', msg, ctx)
function log(level, message, context = {}) {
  const lvl = level.toLowerCase();
  if (typeof _compat[lvl] === 'function') {
    _compat[lvl](context, message);
  }
}

module.exports = { createLogger, log, logInfo, logError, logWarn };
