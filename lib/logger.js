// Structured JSON logging for audit trails and debugging.
// Redacts sensitive fields (paths, keys) to prevent information disclosure.

// Explicit credential/secret key names — always redacted regardless of value
const SENSITIVE_KEYS = new Set([
  'password', 'token', 'secret', 'apikey', 'privatekey', 'devkey',
  'developerkey', 'sessiontoken', 'jwt',
]);

// Key names that always hold file-system paths in this codebase.
// Defense-in-depth: redact by key name so short relative paths (e.g.
// "exports/myface") don't slip through the value-pattern heuristic.
const PATH_KEYS = new Set([
  'dir', 'exportdir', 'path', 'filepath', 'outprg',
  'prgpath', 'designpath', 'tmpdir', 'from', 'to',
  'sdkbin', 'sdkpath', 'keypath', 'monkeyc', 'monkeydo', 'simexe',
]);

/**
 * Detects if a string is path-like (likely contains file system paths or sensitive data).
 * Uses heuristics to identify paths without requiring a fixed list of key names.
 * Excludes URLs (http://, https://, etc.) to preserve API endpoints.
 *
 * @param {string} str - String to check
 * @returns {boolean} True if the string appears to be a path or sensitive data
 */
function isPathLike(str) {
  if (typeof str !== 'string') return false;

  // Exclude URLs (they're not sensitive by themselves)
  if (/^(https?:\/\/|ftp:\/\/)/.test(str)) return false;

  // Very long strings are likely paths, base64, or other sensitive data
  if (str.length > 50) return true;

  // Common path prefixes (Windows, Unix, relative paths)
  const pathPrefixPattern = /^([A-Za-z]:[\\/]|~\/|\/home\/|\/Users\/|\/tmp\/|\/var\/|\.[\\/])/;
  if (pathPrefixPattern.test(str)) return true;

  // Contains backslashes (Windows paths — catches single-segment relative paths too)
  if (str.includes('\\')) return true;

  // Normalize backslashes to forward slashes before counting so that mixed-separator
  // paths (e.g. "exports\project/file") count correctly on both Windows and Unix
  const normalized = str.replace(/\\/g, '/');
  const slashCount = (normalized.match(/\//g) || []).length;
  if (slashCount >= 2) return true;

  return false;
}

/**
 * Recursively redacts sensitive fields in a context object.
 * Three-layer strategy (most-specific to least):
 *   1. Explicit path key names (PATH_KEYS) — always paths in this codebase
 *   2. Explicit credential key names (SENSITIVE_KEYS) — password, token, etc.
 *   3. Value-pattern heuristic — long strings, path prefixes, slashes
 *
 * @param {object} context - Context object to redact
 * @returns {object} Redacted clone of context
 */
function redactSensitiveFields(context) {
  if (!context || typeof context !== 'object') return context;

  // Deep clone to avoid mutating original
  const redacted = Array.isArray(context) ? [...context] : { ...context };

  const walk = (obj) => {
    if (!obj || typeof obj !== 'object') return obj;

    for (const key of Object.keys(obj)) {
      const value = obj[key];
      const lowerKey = key.toLowerCase();

      // Redact by known path key name (dir, path, prgPath, tmpDir, from, to, etc.)
      if (PATH_KEYS.has(lowerKey)) {
        obj[key] = '***redacted***';
      }
      // Redact by explicit credential key name (password, token, secret, etc.)
      else if (SENSITIVE_KEYS.has(lowerKey)) {
        obj[key] = '***redacted***';
      }
      // Redact by value pattern (paths, long strings)
      else if (typeof value === 'string' && isPathLike(value)) {
        obj[key] = '***redacted***';
      }
      // Recurse into nested objects and arrays
      else if (value && typeof value === 'object') {
        walk(value);
      }
      // Primitives (numbers, booleans, null) are preserved as-is
    }

    return obj;
  };

  return walk(redacted);
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
