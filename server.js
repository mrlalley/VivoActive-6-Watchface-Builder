// Watch Face Builder Express server
// HTTP routing layer for the watch face builder backend.
// Complex business logic extracted to lib/build.js, lib/preview.js, and lib/design-store.js

// Load environment variables from .env file (if present)
require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { getConfig } = require('./lib/config');
const { createLogger, logInfo, logError, logWarn } = require('./lib/logger');
const { buildProject, sweepExportDir } = require('./lib/build');
const { previewInSimulator } = require('./lib/preview');
const { saveDesign, listDesigns, loadDesign } = require('./lib/design-store');
const { buildQueue, designSaveQueue } = require('./lib/queue');
const { generateKey, getDefaultKeyPath } = require('./lib/keygen');
const { safePrgName } = require('./lib/naming');

// Middleware factories and route registration extracted to server/ directory
const { createSecurityMiddleware } = require('./server/middleware/security');
const { createCspMiddleware } = require('./server/middleware/csp');
const { createRateLimiters } = require('./server/middleware/rateLimiters');
const { registerHealthRoutes } = require('./server/routes/health');
const { registerDesignRoutes } = require('./server/routes/designs');
const { registerExportRoutes } = require('./server/routes/export');
const { registerPreviewRoutes } = require('./server/routes/preview');
const { registerKeygenRoutes } = require('./server/routes/keygen');

// Module-level pino logger — shared across all requests for this process lifetime.
const log = createLogger('server');

// ─── Server factory ────────────────────────────────────────────────────────────
// Creates and returns an Express app with all routes configured.
// config: user config object with overrides (from electron-store or params)
// detectors: optional detector functions { detectSdkPath, getDefaultKeyPath } for auto-detection

function createServer(config = {}, detectors = {}) {
  const cfg = getConfig(config, detectors);
  const app = express();

  // Resolve designs directory once — cfg.designsDir is safe in both dev and packaged builds
  // because electron/main.js supplies app.getPath('userData'), never an ASAR path.
  const designsDir = cfg.designsDir;

  // Read once at startup — content is static; only the CSP nonce changes per request.
  const indexTemplate = fs.readFileSync(
    path.join(__dirname, 'builder', 'index.html'),
    'utf8'
  );

  // Startup sweep: delete export subdirectories older than 7 days.
  // Fire-and-forget — never blocks startup, never throws to caller.
  // Runs in both Electron and web-server modes since createServer() is the shared entry point.
  (async () => { await sweepExportDir(cfg.exportDir); })();

  // Enable proxy trust if running behind a reverse proxy
  app.set('trust proxy', 1);

  app.use(express.json({ limit: '10mb' }));

  // ── Request ID — attach before all routes so every log line is correlatable ──
  app.use((req, res, next) => {
    req.requestId = crypto.randomUUID();
    res.setHeader('x-request-id', req.requestId);
    next();
  });

  // ── Request lifecycle logging — start event + finish event with duration ──────
  app.use((req, res, next) => {
    const startMs = Date.now();
    const reqLog  = log.child({ requestId: req.requestId });

    reqLog.info({ event: 'request.start', method: req.method, path: req.path });

    res.on('finish', () => {
      const level = res.statusCode >= 500 ? 'error'
                  : res.statusCode >= 400 ? 'warn'
                  : 'info';
      reqLog[level]({
        event:      'request.end',
        method:     req.method,
        path:       req.path,
        status:     res.statusCode,
        durationMs: Date.now() - startMs,
      });
    });

    next();
  });

  // ════════════════════════════════════════════════════════════════════════════════
  // HEALTH ENDPOINT SECURITY CONTRACT
  // ════════════════════════════════════════════════════════════════════════════════
  //
  // Two distinct endpoints, two distinct purposes:
  //
  // 1. GET /internal/healthz (unauthenticated, liveness-only)
  //    - For: Electron startup, infrastructure monitoring, load balancers, probes.
  //    - Contains: minimal process info only (status, pid, timestamp).
  //    - NO authentication required; NO rate limiter (server binds to 127.0.0.1).
  //    - RULE: Never add SDK/key/config/build state here. Use /api/health.
  //    - Registered before all other routes and before CSP middleware.
  //
  // 2. GET /api/health (authenticated, application health)
  //    - For: Renderer health checks, operational queries, build state monitoring.
  //    - Contains: SDK/key detection status, build queue, config completeness.
  //    - REQUIRES: x-wfb-token header; rate-limited.
  //    - RULE: This is the source of truth for application health and config.
  //
  // DO NOT:
  // - Add new health-like endpoints outside /api/* without explicit security review.
  // - Include any SDK/key/config info in /internal/healthz.
  // - Treat /internal/healthz as an API surface or extend its payload.
  //
  // ════════════════════════════════════════════════════════════════════════════════

  // ── GET /internal/healthz – Liveness probe for the Electron startup health gate ──
  app.get('/internal/healthz', (req, res) => {
    res.json({ status: 'ok', pid: process.pid, ts: Date.now() });
  });

  // ─── Session token authentication ────────────────────────────────────────────
  // TOKEN is generated by electron/main.js at startup (crypto.randomBytes(32)) and
  // injected via WFB_SESSION_TOKEN env var. In standalone mode the caller must set
  // it manually. If not set, the middleware returns 401 — it never passes through.
  // NEVER log the token value. Compare with timingSafeEqual to prevent timing attacks.
  const SESSION_TOKEN = process.env.WFB_SESSION_TOKEN || null;
  const expectedTokenBuf = SESSION_TOKEN ? Buffer.from(SESSION_TOKEN, 'hex') : null;

  if (!SESSION_TOKEN) {
    log.warn({
      event: 'auth.token_missing',
      message: 'WFB_SESSION_TOKEN is not set — API routes are UNPROTECTED. ' +
        'In Electron mode this is injected automatically. ' +
        'For standalone mode, set WFB_SESSION_TOKEN manually before starting.',
    });
  }

  function requireSessionToken(req, res, next) {
    // WFB_SESSION_TOKEN must be set. It is generated by electron/main.js and
    // injected into this process's environment before the server starts. If the
    // token is absent, the server started without Electron — a misconfiguration.
    if (!expectedTokenBuf) {
      log.error(
        { path: req.path, method: req.method },
        'Request rejected: WFB_SESSION_TOKEN not set. ' +
        'Server must be started via Electron, not directly via "npm run server".'
      );
      return res.status(401).json({
        error: 'Server misconfigured: session token not set.',
        hint: 'Start the application via "npm start" (Electron), not "npm run server".'
      });
    }

    const provided = req.headers['x-wfb-token'];

    if (!provided) {
      log.warn({ event: 'auth.rejected', reason: 'missing_token', route: req.path });
      return res.status(401).json({ error: 'Unauthorized', reason: 'Missing x-wfb-token header' });
    }

    let providedBuf;
    try {
      providedBuf = Buffer.from(provided, 'hex');
    } catch {
      return res.status(401).json({ error: 'Unauthorized', reason: 'Malformed token' });
    }

    if (
      providedBuf.length !== expectedTokenBuf.length ||
      !crypto.timingSafeEqual(providedBuf, expectedTokenBuf)
    ) {
      log.warn({ event: 'auth.rejected', reason: 'invalid_token', route: req.path });
      return res.status(401).json({ error: 'Unauthorized', reason: 'Invalid token' });
    }

    next();
  }


  // ─── Content Security Policy: nonce-based for stronger XSS protection ─────────
  app.use((req, res, next) => {
    // Generate a random nonce for this request
    const nonce = crypto.randomBytes(16).toString('base64');
    res.locals.nonce = nonce;

    // Content-Security-Policy header — authoritative CSP enforcement.
    // SYNC CONTRACT: builder/index.html contains a meta tag fallback (lines 4-32) that
    // must mirror this header on every update. The meta tag intentionally omits
    // 'strict-dynamic' and nonce because static HTML cannot embed a per-request nonce.
    // See CLAUDE.md §Content Security Policy for the CSP design rationale.
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'self'; script-src 'self' 'strict-dynamic' 'nonce-${nonce}'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none';`
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    next();
  });

  // ── Create rate limiters ──────────────────────────────────────────────────
  const limiters = createRateLimiters();

  // ─── Serve index.html with nonce-injected script tags ─────────────────────────
  app.get('/', limiters.loadDesignLimiter, (req, res) => {
    // Inject per-request nonce into the cached template — do not cache the result
    const html = indexTemplate.replace(
      /<script type="module" src="app\.js"><\/script>/g,
      `<script type="module" src="app.js" nonce="${res.locals.nonce}"></script>`
    );
    res.set('Content-Type', 'text/html').send(html);
  });

  // ─── Serve static files (but not index.html, which is handled above) ──────────
  app.use(express.static(path.join(__dirname, 'builder'), {
    index: false // Disable default index.html serving
  }));

  // ── Register extracted route modules ────────────────────────────────────────

  // Register all routes with extracted modules
  registerHealthRoutes(app, cfg, limiters, {
    requireSessionToken,
    buildQueue,
    log,
  });

  registerDesignRoutes(app, cfg, limiters, {
    requireSessionToken,
    designSaveQueue,
    safePrgName,
    saveDesign,
    listDesigns,
    loadDesign,
    log,
  });

  registerExportRoutes(app, cfg, limiters, {
    requireSessionToken,
    buildQueue,
    safePrgName,
    buildProject,
    log,
  });

  registerPreviewRoutes(app, cfg, limiters, {
    requireSessionToken,
    buildQueue,
    buildProject,
    previewInSimulator,
    log,
  });

  registerKeygenRoutes(app, cfg, limiters, {
    requireSessionToken,
    generateKey,
    getDefaultKeyPath,
    log,
  });

  return app;
}

// ─── Exports and direct invocation ────────────────────────────────────────────

module.exports = { createServer, getConfig };

// Allow direct execution: node server.js (standalone mode — npm run server)
if (require.main === module) {
  // Standalone execution guard.
  // The production path is: Electron main process generates WFB_SESSION_TOKEN,
  // injects it into this process's env, then spawns this file. Running
  // "npm run server" directly is only valid for CI/integration testing where
  // the token is explicitly set in the environment before startup.
  //
  // Per CLAUDE.md §Server security contract: "The server exits with code 1
  // if started standalone without the token."
  if (!process.env.WFB_SESSION_TOKEN) {
    process.stderr.write(
      '\n' +
      '[server] FATAL: WFB_SESSION_TOKEN is not set.\n' +
      '[server] The server requires a session token to prevent unauthenticated\n' +
      '[server] access to the Monkey C build pipeline.\n' +
      '[server]\n' +
      '[server] NORMAL PATH: Start the application via "npm start" (Electron mode).\n' +
      '[server] Electron generates the token and injects it automatically.\n' +
      '[server]\n' +
      '[server] CI/TESTING PATH: Set WFB_SESSION_TOKEN before "npm run server".\n' +
      '[server] Example:\n' +
      '[server]   PowerShell:\n' +
      '[server]     $env:WFB_SESSION_TOKEN = ' +
      'node -e "process.stdout.write(require(\'crypto\').randomBytes(32).toString(\'hex\'))"\n' +
      '[server]     npm run server\n' +
      '[server]   bash:\n' +
      '[server]     export WFB_SESSION_TOKEN=$(node -e ' +
      '"process.stdout.write(require(\'crypto\').randomBytes(32).toString(\'hex\'))")\n' +
      '[server]     npm run server\n' +
      '\n'
    );
    process.exit(1);
  }

  // WFB_SERVER_PORT is set by the Electron main process when spawning this script.
  // In standalone mode it falls back to 3000. See docs/architecture.md §Port Configuration.
  const PORT = parseInt(process.env.WFB_SERVER_PORT, 10) || 3000;
  const expressApp = createServer();
  const server = expressApp.listen(PORT, '127.0.0.1', () => {
    // Emit the structured startup log. The Electron health gate polls GET /health via HTTP —
    // it does NOT parse this log line, so format changes here are safe.
    const cfg = getConfig();
    log.info({
      event:   'server.ready',
      host:    '127.0.0.1',
      port:    PORT,
      sdkBin:  path.basename(path.dirname(cfg.sdkBin)),
      devKey:  path.basename(cfg.devKey),
      exports: path.basename(cfg.exportDir),
    });
  });

  // Clean shutdown on SIGTERM (sent by Electron main process via before-quit handler).
  // TODO(win32): serverProcess.kill() sends SIGKILL on Windows, not SIGTERM — this
  // handler will not fire on Windows. Graceful Win32 shutdown via named pipe or IPC
  // message is tracked in docs/architecture.md §Known Limitations.
  process.on('SIGTERM', () => {
    log.info({ event: 'server.sigterm', message: 'received SIGTERM — closing' });
    server.close(() => {
      process.exit(0);
    });
  });
}
