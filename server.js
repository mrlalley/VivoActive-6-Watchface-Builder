// Watch Face Builder Express server
// HTTP routing layer for the watch face builder backend.
// Complex business logic extracted to lib/build.js, lib/preview.js, and lib/design-store.js

// Load environment variables from .env file (if present)
require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

const { getConfig } = require('./lib/config');
const { logInfo, logError } = require('./lib/logger');
const { buildProject } = require('./lib/build');
const { previewInSimulator } = require('./lib/preview');
const { saveDesign, listDesigns, loadDesign } = require('./lib/design-store');
const { buildQueue, designSaveQueue } = require('./lib/queue');

// ─── Server factory ────────────────────────────────────────────────────────────
// Creates and returns an Express app with all routes configured.
// config: user config object with overrides (from electron-store or params)
// detectors: optional detector functions { detectSdkPath, getDefaultKeyPath } for auto-detection

function createServer(config = {}, detectors = {}) {
  const cfg = getConfig(config, detectors);
  const app = express();

  // Enable proxy trust if running behind a reverse proxy
  app.set('trust proxy', 1);

  app.use(express.json({ limit: '10mb' }));

  // ─── Rate limiters ────────────────────────────────────────────────────────────
  const loadDesignLimiter = rateLimit({
    windowMs: 60000, // 60 seconds
    max: 30, // 30 requests max per IP
    standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
    legacyHeaders: false, // Disable `X-RateLimit-*` headers
    handler: (req, res) => {
      res.status(429).json({ success: false, error: 'Too many design load requests' });
    }
  });

  const healthLimiter = rateLimit({
    windowMs: 60000, // 60 seconds
    max: 30, // 30 requests per IP — 12 polls/min + headroom for browser refreshes
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({ success: false, error: 'Too many health checks' });
    }
  });

  // ─── Content Security Policy: nonce-based for stronger XSS protection ─────────
  app.use((req, res, next) => {
    // Generate a random nonce for this request
    const nonce = crypto.randomBytes(16).toString('base64');
    res.locals.nonce = nonce;

    // CSP header with nonce for scripts and 'unsafe-hashes' for inline styles
    // Note: 'strict-dynamic' only allows scripts with valid nonce, ignoring 'unsafe-inline'
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'self'; script-src 'self' 'strict-dynamic' 'nonce-${nonce}'; style-src 'self' 'unsafe-hashes'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none';`
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    next();
  });

  // ─── Serve index.html with nonce-injected script tags ─────────────────────────
  app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, 'builder', 'index.html');
    let html = fs.readFileSync(indexPath, 'utf8');
    // Inject nonce into external script tags
    html = html.replace(/<script type="module" src="app\.js"><\/script>/g, `<script type="module" src="app.js" nonce="${res.locals.nonce}"></script>`);
    res.set('Content-Type', 'text/html').send(html);
  });

  // ─── Serve static files (but not index.html, which is handled above) ──────────
  app.use(express.static(path.join(__dirname, 'builder'), {
    index: false // Disable default index.html serving
  }));

  // ── GET /api/export/check/:projectName – Check if project exists ──
  app.get('/api/export/check/:projectName', (req, res) => {
    try {
      const { safePrgName } = require('./lib/naming');
      const projectName = req.params.projectName;
      const prgName = safePrgName(projectName);
      const expectedFileName = `${prgName}.prg`;

      // Search for the .prg file in the export directory (recursively with depth limit)
      // Files are saved in request-scoped subdirectories, so we need to search
      // But limit recursion depth to prevent DoS on misconfigured or corrupt export dirs
      let exists = false;
      try {
        const MAX_DEPTH = 10;
        const MAX_FILES_CHECKED = 10000;
        let filesChecked = 0;

        const findFile = (dir, currentDepth = 0) => {
          // Depth limit: prevent infinite recursion on symlink loops or deep trees
          if (currentDepth > MAX_DEPTH) {
            throw new Error(`Export directory too deeply nested (max depth: ${MAX_DEPTH})`);
          }

          // File count limit: prevent runaway traversal on large filesystems
          if (filesChecked++ > MAX_FILES_CHECKED) {
            throw new Error(`Too many files in export directory (searched ${MAX_FILES_CHECKED}+ files)`);
          }

          try {
            const files = fs.readdirSync(dir);
            for (const file of files) {
              const filePath = path.join(dir, file);
              // Use lstat instead of stat to detect symlinks (symlinks return isSymbolicLink = true)
              const stat = fs.lstatSync(filePath);
              // Skip symlinks to prevent traversal outside exportDir
              if (stat.isSymbolicLink()) {
                continue;
              } else if (stat.isDirectory()) {
                if (findFile(filePath, currentDepth + 1)) return true;
              } else if (file === expectedFileName) {
                return true;
              }
            }
          } catch (readErr) {
            // Permission denied, I/O error, etc. — skip this directory
            logWarn('export-check:read-failed', { dir, reason: readErr.message });
          }
          return false;
        };

        if (fs.existsSync(cfg.exportDir)) {
          exists = findFile(cfg.exportDir, 0);
        }
      } catch (searchErr) {
        // If search fails (depth limit, file count, permission denied), return error
        res.status(400).json({ success: false, error: searchErr.message });
        return;
      }

      res.json({ success: true, exists, projectName });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // ── POST /api/export – Export and build .prg file ──
  app.post('/api/export', async (req, res) => {
    const { elements = [], projectName = 'MyWatchFace' } = req.body;
    try {
      // Serialize builds: only one at a time (prevents file contention)
      const result = await buildQueue.add(
        () => buildProject(cfg, projectName, elements),
        `export:${projectName}`
      );
      res.json(result);
    } catch (err) {
      logError('export:queue-error', { reason: err.message });
      // Standardize error response to match success response structure
      res.json({
        success: false,
        error: err.message,
        log: '',
        requestId: 'unknown',
        projectPath: cfg.exportDir,
        projectExists: false,
      });
    }
  });

  // ── POST /api/save-design – Save design to disk ──
  app.post('/api/save-design', async (req, res) => {
    const { projectName = 'MyWatchFace', elements = [] } = req.body;
    try {
      const designsDir = path.join(__dirname, 'designs');
      // Serialize design saves: only one at a time (prevents overwrite loss)
      const result = await designSaveQueue.add(
        () => saveDesign(designsDir, projectName, elements),
        `save-design:${projectName}`
      );
      res.json(result);
    } catch (err) {
      logError('save-design:queue-error', { reason: err.message });
      // Standardize error response to match success response structure
      res.json({ success: false, error: err.message, log: '' });
    }
  });

  // ── GET /api/designs – List all saved designs ──
  app.get('/api/designs', (req, res) => {
    try {
      const designsDir = path.join(__dirname, 'designs');
      const designs = listDesigns(designsDir);
      res.json({ success: true, designs });
    } catch (err) {
      logError('designs:list-error', { reason: err.message });
      res.json({ success: false, error: err.message });
    }
  });

  // ── GET /api/designs/check/:projectName – Check if design exists ──
  app.get('/api/designs/check/:projectName', (req, res) => {
    try {
      const { safePrgName } = require('./lib/naming');
      const projectName = req.params.projectName;
      const fileName = `${safePrgName(projectName)}.json`;
      const designsDir = path.join(__dirname, 'designs');
      const filePath = path.join(designsDir, fileName);

      // Sanitize filename to prevent path traversal
      const sanitized = fileName.replace(/[^a-zA-Z0-9._-]/g, '');
      const safeFilePath = path.join(designsDir, sanitized);
      const exists = fs.existsSync(safeFilePath);

      res.json({ success: true, exists, projectName });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // ── GET /api/designs/:filename – Load a specific design ──
  // Rate-limited: 30 requests per 60 seconds per IP (prevents DOS attacks)
  app.get('/api/designs/:filename', loadDesignLimiter, (req, res) => {
    try {
      const designsDir = path.join(__dirname, 'designs');
      const design = loadDesign(designsDir, req.params.filename);
      res.json({
        success: true,
        design,
        validationWarning: design.validationWarning || null,
        requiresConfirmation: design.requiresConfirmation || false,
      });
    } catch (err) {
      logError('designs:load-error', { reason: err.message });
      res.json({ success: false, error: err.message });
    }
  });

  // ── POST /api/preview – Build and launch in simulator ──
  app.post('/api/preview', async (req, res) => {
    const { elements = [], projectName = 'WatchFacePreview' } = req.body;
    try {
      // Serialize builds: only one at a time (prevents file contention)
      const buildResult = await buildQueue.add(
        () => buildProject(cfg, projectName, elements),
        `preview:${projectName}`
      );
      if (!buildResult.success) {
        return res.json(buildResult);
      }
      // Fire off preview work asynchronously (simulator launch, .prg loading)
      // Pass requestId to ensure temp files don't collide if multiple previews run
      previewInSimulator(cfg, buildResult.prgPath, buildResult.requestId);
      res.json({ success: true, message: 'Starting simulator…', log: buildResult.log, requestId: buildResult.requestId });
    } catch (err) {
      logError('preview:queue-error', { reason: err.message });
      // Standardize error response to match success response structure
      res.json({
        success: false,
        error: err.message,
        log: '',
        requestId: 'unknown',
        projectPath: cfg.exportDir,
        projectExists: false,
      });
    }
  });

  // ── GET /api/health – Health check for Electron startup validation ──
  app.get('/api/health', healthLimiter, (req, res) => {
    const health = {
      ok: fs.existsSync(cfg.monkeyc) && fs.existsSync(cfg.devKey),
      sdkFound: fs.existsSync(cfg.monkeyc),
      keyFound: fs.existsSync(cfg.devKey),
      sdkPath: cfg.monkeyc,
      keyPath: cfg.devKey,
      timestamp: new Date().toISOString(),
    };
    res.status(health.ok ? 200 : 503).json(health);
  });

  return app;
}

// ─── Exports and direct invocation ────────────────────────────────────────────

module.exports = { createServer, getConfig };

// Allow direct execution: node server.js (backward compatible with fallback hardcoded paths)
if (require.main === module) {
  const app = createServer();
  const PORT = 0; // Let OS choose an available port
  const server = app.listen(PORT, '127.0.0.1', () => {
    const addr = server.address();
    const actualPort = addr.port;
    const cfg = getConfig();
    console.log(`Watch Face Builder  →  http://127.0.0.1:${actualPort}`);
    console.log(`SDK bin:            ${path.basename(path.dirname(cfg.sdkBin))}`);
    console.log(`Developer key:      ${path.basename(cfg.devKey)}`);
    console.log(`Export dir:         ${path.basename(cfg.exportDir)}`);
  });
}
