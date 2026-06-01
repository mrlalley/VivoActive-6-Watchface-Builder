// Key generation route: generate a developer key

const fs = require('fs');

function registerKeygenRoutes(app, cfg, limiters, { requireSessionToken, generateKey, getDefaultKeyPath, log }) {
  const { buildLimiter } = limiters;

  const logError = (event, meta) => log.error({ event, ...meta });
  const logInfo = (event, meta) => log.info({ event, ...meta });

  // ── POST /api/generate-key – Generate a developer key (web mode; Electron uses IPC) ──
  app.post('/api/generate-key', requireSessionToken, buildLimiter, async (req, res) => {
    const outputPath = cfg.devKey || getDefaultKeyPath();
    const force = req.body?.force === true;

    if (!force) {
      let keyExists = false;
      try {
        await fs.promises.access(outputPath);
        keyExists = true;
      } catch { /* ENOENT — key not yet generated */ }
      if (keyExists) {
        return res.json({ success: false, exists: true, path: outputPath });
      }
    }

    try {
      const result = await generateKey(outputPath);
      logInfo('Developer key generated', { path: result.path });
      res.json({ success: true, path: result.path });
    } catch (err) {
      logError('Key generation failed', { error: err.message });
      res.status(500).json({ success: false, error: err.message });
    }
  });
}

module.exports = { registerKeygenRoutes };
