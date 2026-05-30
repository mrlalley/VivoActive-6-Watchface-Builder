// Watch Face Builder Express server
// HTTP routing layer for the watch face builder backend.
// Complex business logic extracted to lib/build.js, lib/preview.js, and lib/design-store.js

const express = require('express');
const path = require('path');
const fs = require('fs');

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

  app.use(express.json({ limit: '10mb' }));
  app.use(express.static(path.join(__dirname, 'builder')));

  // ─── Content Security Policy: restrict fetch/script/style origins ───────────────
  app.use((req, res, next) => {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;"
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
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
      logError('export:error', { reason: err.message });
      res.json({ success: false, error: err.message, log: '' });
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
      logError('save-design:error', { reason: err.message });
      res.json({ success: false, error: err.message });
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

  // ── GET /api/designs/:filename – Load a specific design ──
  app.get('/api/designs/:filename', (req, res) => {
    try {
      const designsDir = path.join(__dirname, 'designs');
      const design = loadDesign(designsDir, req.params.filename);
      res.json({ success: true, design });
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
      logError('preview:error', { reason: err.message });
      res.json({ success: false, error: err.message, log: '' });
    }
  });

  // ── GET /api/health – Health check for Electron startup validation ──
  app.get('/api/health', (req, res) => {
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
