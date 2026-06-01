// Preview route: build and launch in simulator

const { ValidationError, QueueFullError } = require('../../lib/errors');

function registerPreviewRoutes(app, cfg, limiters, { requireSessionToken, buildQueue, buildProject, previewInSimulator, log }) {
  const { buildLimiter } = limiters;

  const logError = (event, meta) => log.error({ event, ...meta });

  // ── POST /api/preview – Build and launch in simulator ──
  app.post('/api/preview', requireSessionToken, buildLimiter, async (req, res) => {
    const { elements = [], projectName = 'WatchFacePreview', background = null } = req.body;
    try {
      // Serialize builds: only one at a time (prevents file contention)
      const buildResult = await buildQueue.add(
        () => buildProject(cfg, projectName, elements, null, background),
        `preview:${projectName}`
      );
      if (!buildResult.success) {
        // Build failures (invalid elements, validation errors) return 400.
        return res.status(400).json(buildResult);
      }
      // Fire off preview work asynchronously (simulator launch, .prg loading)
      // Pass requestId to ensure temp files don't collide if multiple previews run
      previewInSimulator(cfg, buildResult.prgPath, buildResult.requestId);
      res.json({ success: true, message: 'Starting simulator…', log: buildResult.log, requestId: buildResult.requestId });
    } catch (err) {
      if (err instanceof QueueFullError) {
        res.set('Retry-After', '60');
        return res.status(503).json({ success: false, error: err.message, log: '', requestId: 'unknown' });
      }
      if (err instanceof ValidationError) {
        return res.status(400).json({ success: false, error: err.message, log: '', requestId: 'unknown' });
      }
      logError('preview:error', { reason: err.message });
      res.status(500).json({ success: false, error: err.message, log: '', requestId: 'unknown' });
    }
  });
}

module.exports = { registerPreviewRoutes };
