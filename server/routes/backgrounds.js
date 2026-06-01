// Custom backgrounds route: serves user-imported background images as base64 dataUrls.

const fs   = require('fs');
const path = require('path');

// assetId for custom images must match this pattern (same as ASSET_ID_RE in validation.js)
const CUSTOM_ASSET_ID_RE = /^custom-[a-z0-9-]{1,63}$/;

function registerBackgroundRoutes(app, cfg, limiters, { requireSessionToken, log }) {
  const { loadDesignLimiter } = limiters;

  const logWarn = (event, meta) => log.warn({ event, ...meta });

  // ── GET /api/backgrounds/custom/:assetId – Serve a user-imported background ──
  // Returns { success: true, dataUrl: 'data:image/png;base64,...' }
  // Authenticated and rate-limited — custom images are in the private userData dir.
  app.get('/api/backgrounds/custom/:assetId', requireSessionToken, loadDesignLimiter, (req, res) => {
    const { assetId } = req.params;

    // Validate assetId before using it in a file path
    if (!CUSTOM_ASSET_ID_RE.test(assetId)) {
      return res.status(400).json({ success: false, error: 'Invalid background assetId' });
    }

    if (!cfg.backgroundsDir) {
      return res.status(500).json({ success: false, error: 'backgrounds directory not configured' });
    }

    const bgDir  = path.resolve(cfg.backgroundsDir);
    const imgPath = path.resolve(bgDir, `${assetId}.png`);

    // Path safety check: resolved path must be inside backgroundsDir
    if (!imgPath.startsWith(bgDir + path.sep) && imgPath !== bgDir) {
      logWarn('backgrounds:path-traversal', { assetId });
      return res.status(400).json({ success: false, error: 'Invalid background assetId' });
    }

    let fileBuffer;
    try {
      fileBuffer = fs.readFileSync(imgPath);
    } catch (err) {
      if (err.code === 'ENOENT') {
        return res.status(404).json({ success: false, error: `Background not found: ${assetId}` });
      }
      logWarn('backgrounds:read-failed', { assetId, reason: err.message });
      return res.status(500).json({ success: false, error: 'Failed to read background' });
    }

    const dataUrl = `data:image/png;base64,${fileBuffer.toString('base64')}`;
    res.json({ success: true, dataUrl });
  });
}

module.exports = { registerBackgroundRoutes };
