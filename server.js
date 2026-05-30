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

// ─── Server factory ────────────────────────────────────────────────────────────
// Creates and returns an Express app with all routes configured.
// config: user config object with overrides (from electron-store or params)
// detectors: optional detector functions { detectSdkPath, getDefaultKeyPath } for auto-detection

function createServer(config = {}, detectors = {}) {
  const cfg = getConfig(config, detectors);
  const app = express();

  app.use(express.json({ limit: '10mb' }));
  app.use(express.static(path.join(__dirname, 'builder')));

  // ── POST /api/export – Export and build .prg file ──
  app.post('/api/export', async (req, res) => {
    const { elements = [], projectName = 'MyWatchFace' } = req.body;
    try {
      const result = await buildProject(cfg, projectName, elements);
      res.json(result);
    } catch (err) {
      logError('export:error', { reason: err.message });
      res.json({ success: false, error: err.message, log: '' });
    }
  });

  // ── POST /api/save-design – Save design to disk ──
  app.post('/api/save-design', (req, res) => {
    const { projectName = 'MyWatchFace', elements = [] } = req.body;
    try {
      const designsDir = path.join(__dirname, 'designs');
      const result = saveDesign(designsDir, projectName, elements);
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
      const buildResult = await buildProject(cfg, projectName, elements);
      if (!buildResult.success) {
        return res.json(buildResult);
      }
      // Fire off preview work asynchronously (simulator launch, .prg loading)
      previewInSimulator(cfg, buildResult.prgPath);
      res.json({ success: true, message: 'Starting simulator…', log: buildResult.log });
    } catch (err) {
      logError('preview:error', { reason: err.message });
      res.json({ success: false, error: err.message, log: '' });
    }
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
    console.log(`SDK bin:            ${cfg.sdkBin}`);
    console.log(`Developer key:      ${cfg.devKey}`);
    console.log(`Export dir:         ${cfg.exportDir}`);
  });
}
