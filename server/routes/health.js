// Health endpoints: liveness probe and application health status

const fs = require('fs');

function registerHealthRoutes(app, cfg, limiters, { requireSessionToken, buildQueue, log }) {
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

  // ── GET /api/health – Authenticated health check for application and build state ──
  // Requires session token to prevent information disclosure about SDK/key presence and build activity.
  app.get('/api/health', requireSessionToken, limiters.healthLimiter, async (req, res) => {
    try {
      const [sdkFound, keyFound] = await Promise.all([
        fs.promises.access(cfg.monkeyc).then(() => true).catch(() => false),
        fs.promises.access(cfg.devKey).then(() => true).catch(() => false),
      ]);
      const health = {
        ok: sdkFound && keyFound,
        sdkFound,
        keyFound,
        timestamp: new Date().toISOString(),
      };
      res.status(health.ok ? 200 : 503).json({ ...health, buildQueue: buildQueue.stats() });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
}

module.exports = { registerHealthRoutes };
