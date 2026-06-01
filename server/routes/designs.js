// Design routes: save, list, check, and load designs

const fs = require('fs');
const path = require('path');

function registerDesignRoutes(app, cfg, limiters, { requireSessionToken, designSaveQueue, safePrgName, saveDesign, listDesigns, loadDesign, log }) {
  const designsDir = cfg.designsDir;
  const { buildLimiter, loadDesignLimiter } = limiters;

  const logError = (event, meta) => log.error({ event, ...meta });
  const logWarn = (event, meta) => log.warn({ event, ...meta });

  // ── POST /api/save-design – Save design to disk ──
  app.post('/api/save-design', requireSessionToken, buildLimiter, async (req, res) => {
    const { projectName = 'MyWatchFace', elements = [] } = req.body;
    try {
      // Serialize design saves: only one at a time (prevents overwrite loss)
      const result = await designSaveQueue.add(
        () => saveDesign(designsDir, projectName, elements),
        `save-design:${projectName}`
      );
      // Explicit allowlist — filePath excluded even as a basename; client needs only
      // success, projectName, and elementCount to confirm the save succeeded.
      const { success, projectName: savedName, elementCount, error } = result;
      // Save failures (validation errors) return 400. Save successes return 200.
      if (!success) {
        return res.status(400).json({ success, projectName: savedName, elementCount, error });
      }
      res.json({ success, projectName: savedName, elementCount, error });
    } catch (err) {
      if (err.message === 'Queue full — try again later') {
        res.set('Retry-After', '60');
        return res.status(503).json({ success: false, error: err.message, log: '' });
      }
      // Validation errors (from validateProjectName, validateElements) return 400.
      // Other errors (filesystem, etc.) return 500.
      if (err.message && (err.message.includes('Validation failed') || err.message.includes('Invalid') || err.message.includes('must be'))) {
        return res.status(400).json({ success: false, error: err.message, log: '' });
      }
      logError('save-design:error', { reason: err.message });
      res.status(500).json({ success: false, error: err.message, log: '' });
    }
  });

  // ── GET /api/designs – List all saved designs ──
  app.get('/api/designs', requireSessionToken, loadDesignLimiter, async (req, res) => {
    try {
      const designs = await listDesigns(designsDir);
      res.json({ success: true, designs });
    } catch (err) {
      logError('designs:list-error', { reason: err.message });
      // Filesystem errors are server-side failures.
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── GET /api/designs/check/:projectName – Check if design exists ──
  app.get('/api/designs/check/:projectName', requireSessionToken, loadDesignLimiter, (req, res) => {
    try {
      const projectName = req.params.projectName;
      const fileName = `${safePrgName(projectName)}.json`;
      const exists = fs.existsSync(path.join(designsDir, fileName));

      res.json({ success: true, exists, projectName });
    } catch (err) {
      // Filesystem errors are server-side failures.
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── GET /api/designs/:filename – Load a specific design ──
  app.get('/api/designs/:filename', requireSessionToken, loadDesignLimiter, (req, res) => {
    try {
      const design = loadDesign(designsDir, req.params.filename);
      res.json({
        success: true,
        design,
        validationWarning: design.validationWarning || null,
        requiresConfirmation: design.requiresConfirmation || false,
      });
    } catch (err) {
      logError('designs:load-error', { reason: err.message });
      // Design not found returns 404. Other errors (validation, filesystem) return 400/500.
      if (err.message && err.message.includes('not found')) {
        return res.status(404).json({ success: false, error: err.message });
      }
      if (err.message && err.message.includes('corrupted')) {
        return res.status(400).json({ success: false, error: err.message });
      }
      res.status(500).json({ success: false, error: err.message });
    }
  });
}

module.exports = { registerDesignRoutes };
