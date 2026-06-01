// Export routes: build project and check export status

const fs = require('fs');
const path = require('path');
const { ValidationError, QueueFullError } = require('../../lib/errors');
const { validateBackground } = require('../../lib/validation');
const { rebuildExportManifest } = require('../../lib/build');

function registerExportRoutes(app, cfg, limiters, { requireSessionToken, buildQueue, safePrgName, buildProject, log }) {
  const { buildLimiter } = limiters;

  const logError = (event, meta) => log.error({ event, ...meta });
  const logInfo = (event, meta) => log.info({ event, ...meta });
  const logWarn = (event, meta) => log.warn({ event, ...meta });

  // ── GET /api/export/check/:projectName – Check if .prg file exists ──
  app.get('/api/export/check/:projectName', requireSessionToken, buildLimiter, async (req, res) => {
    try {
      const projectName = req.params.projectName;
      const prgName = safePrgName(projectName);
      const expectedFileName = `${prgName}.prg`;

      let foundInDir = null;

      // ─── Phase 1: Try direct lookup via manifest ──────────────────────────
      const manifestPath = path.join(cfg.exportDir, '.exports.json');
      try {
        const manifestContent = await fs.promises.readFile(manifestPath, 'utf8');
        const manifest = JSON.parse(manifestContent);
        const requestId = manifest[prgName];

        if (requestId) {
          // Construct the expected .prg path and verify it exists
          const expectedPath = path.join(cfg.exportDir, requestId, 'bin', `${prgName}.prg`);

          // Verify path is rooted in exportDir (safety check)
          const resolvedPath = path.resolve(expectedPath);
          const resolvedExportDir = path.resolve(cfg.exportDir);

          let prgExists = false;
          try {
            await fs.promises.access(expectedPath);
            prgExists = true;
          } catch { /* ENOENT — file not found */ }

          if (resolvedPath.startsWith(resolvedExportDir) && prgExists) {
            foundInDir = path.dirname(expectedPath); // Return the 'bin' directory
            logInfo('export-check:manifest-hit', { prgName, requestId });
          } else if (requestId) {
            // Manifest entry exists but file not found — stale entry, will be cleaned via fallback
            logWarn('export-check:stale-manifest', { prgName, requestId });
          }
        }
      } catch (manifestErr) {
        if (manifestErr.code !== 'ENOENT') {
          logWarn('export-check:manifest-read-failed', { reason: manifestErr.message });
        }
        // ENOENT: manifest doesn't exist — fall through to recursive scan
      }

      // ─── Phase 2: No recursive scan — trigger async rebuild instead ────────
      if (!foundInDir) {
        // Trigger manifest rebuild asynchronously, return immediately
        setImmediate(async () => {
          try {
            await rebuildExportManifest(cfg.exportDir);
            logInfo('export-check:rebuild-triggered', { prgName });
          } catch (err) {
            logWarn('export-check:rebuild-failed', { prgName, reason: err.message });
          }
        });

        res.json({ success: true, exists: false, rebuildQueued: true, projectName });
        return;
      }

      const exists = foundInDir !== null;
      res.json({ success: true, exists, projectName });

      // Post-retrieval cleanup: delete the requestId directory after response is queued
      if (exists) {
        const rel = path.relative(cfg.exportDir, foundInDir);
        const requestDir = path.join(cfg.exportDir, rel.split(path.sep)[0]);

        setImmediate(async () => {
          try {
            // Remove the requestId directory
            await fs.promises.rm(requestDir, { recursive: true, force: true });
            logInfo('export-check:cleanup', { requestDir: path.basename(requestDir) });

            // Clean up manifest entry if present
            try {
              const manifestPath = path.join(cfg.exportDir, '.exports.json');
              let manifestContent;
              try {
                manifestContent = await fs.promises.readFile(manifestPath, 'utf8');
              } catch (readErr) {
                if (readErr.code !== 'ENOENT') throw readErr;
                // ENOENT — no manifest to clean up; skip silently
                manifestContent = null;
              }
              if (manifestContent !== null) {
                const manifest = JSON.parse(manifestContent);
                if (manifest[prgName]) {
                  delete manifest[prgName];
                  const tmpPath = manifestPath + '.tmp';
                  await fs.promises.writeFile(tmpPath, JSON.stringify(manifest, null, 2));
                  await fs.promises.rename(tmpPath, manifestPath);
                  logInfo('export-check:manifest-cleaned', { prgName });
                }
              }
            } catch (cleanupErr) {
              logWarn('export-check:manifest-cleanup-failed', { reason: cleanupErr.message });
            }
          } catch (err) {
            logWarn('export-check:cleanup-failed', { requestDir: path.basename(requestDir), reason: err.message });
          }
        });
      }
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

  // ── POST /api/export – Export and build .prg file ──
  app.post('/api/export', requireSessionToken, buildLimiter, async (req, res) => {
    const { elements = [], projectName = 'MyWatchFace', background = null } = req.body;
    try {
      validateBackground(background);
    } catch (validationErr) {
      return res.status(400).json({ success: false, error: validationErr.message, log: '', requestId: 'unknown' });
    }
    try {
      // Serialize builds: only one at a time (prevents file contention)
      const result = await buildQueue.add(
        () => buildProject(cfg, projectName, elements, null, background),
        `export:${projectName}`
      );
      // Strip server-side paths before sending to the client — prgPath, designPath,
      // and projectPath are internal and must not be disclosed over the wire.
      const { success, error, log, requestId } = result;
      // Build failures (invalid elements, validation errors) return 400.
      // Build successes return 200.
      if (!success) {
        return res.status(400).json({ success, error, log, requestId });
      }
      res.json({ success, error, log, requestId });
    } catch (err) {
      if (err instanceof QueueFullError) {
        res.set('Retry-After', '60');
        return res.status(503).json({ success: false, error: err.message, log: '', requestId: 'unknown' });
      }
      if (err instanceof ValidationError) {
        return res.status(400).json({ success: false, error: err.message, log: '', requestId: 'unknown' });
      }
      logError('export:error', { reason: err.message });
      res.status(500).json({ success: false, error: err.message, log: '', requestId: 'unknown' });
    }
  });

  // ── POST /api/export/repair-manifest – Rebuild manifest by scanning exportDir ──
  app.post('/api/export/repair-manifest', requireSessionToken, buildLimiter, async (req, res) => {
    try {
      const filesFound = await rebuildExportManifest(cfg.exportDir);
      res.json({
        success: true,
        message: 'Export manifest rebuilt',
        filesFound,
        manifestRebuilt: true,
      });
    } catch (err) {
      logError('export:repair-manifest-failed', { reason: err.message });
      res.status(500).json({
        success: false,
        error: err.message,
        manifestRebuilt: false,
      });
    }
  });
}

module.exports = { registerExportRoutes };
