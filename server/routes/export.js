// Export routes: build project and check export status

const fs = require('fs');
const path = require('path');

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
      if (fs.existsSync(manifestPath)) {
        try {
          const manifestContent = fs.readFileSync(manifestPath, 'utf8');
          const manifest = JSON.parse(manifestContent);
          const requestId = manifest[prgName];

          if (requestId) {
            // Construct the expected .prg path and verify it exists
            const expectedPath = path.join(cfg.exportDir, requestId, 'bin', `${prgName}.prg`);

            // Verify path is rooted in exportDir (safety check)
            const resolvedPath = path.resolve(expectedPath);
            const resolvedExportDir = path.resolve(cfg.exportDir);
            if (resolvedPath.startsWith(resolvedExportDir) && fs.existsSync(expectedPath)) {
              foundInDir = path.dirname(expectedPath); // Return the 'bin' directory
              logInfo('export-check:manifest-hit', { prgName, requestId });
            } else if (requestId) {
              // Manifest entry exists but file not found — stale entry, will be cleaned via fallback
              logWarn('export-check:stale-manifest', { prgName, requestId });
            }
          }
        } catch (manifestErr) {
          logWarn('export-check:manifest-read-failed', { reason: manifestErr.message });
          // Fall through to recursive scan
        }
      }

      // ─── Phase 2: Fallback to recursive scan (for missing/stale manifest) ──
      if (!foundInDir && fs.existsSync(cfg.exportDir)) {
        try {
          const MAX_DEPTH = 10;
          const MAX_FILES_CHECKED = 10000;
          let filesChecked = 0;

          const findFileAsync = async (dir, currentDepth = 0) => {
            if (currentDepth > MAX_DEPTH) {
              throw new Error(`Export directory too deeply nested (max depth: ${MAX_DEPTH})`);
            }
            if (filesChecked++ > MAX_FILES_CHECKED) {
              throw new Error(`Too many files in export directory (searched ${MAX_FILES_CHECKED}+ files)`);
            }

            try {
              const files = await fs.promises.readdir(dir);
              for (const file of files) {
                const filePath = path.join(dir, file);
                let stat;
                try {
                  stat = await fs.promises.lstat(filePath);
                } catch (err) {
                  // Entry disappeared between readdir and lstat — skip it
                  if (err.code === 'ENOENT') continue;
                  throw err;
                }
                if (stat.isSymbolicLink()) {
                  continue;
                } else if (stat.isDirectory()) {
                  const found = await findFileAsync(filePath, currentDepth + 1);
                  if (found) return found;
                } else if (file === expectedFileName) {
                  return dir; // return the directory that directly contains the .prg
                }
              }
            } catch (readErr) {
              logWarn('export-check:read-failed', { dir, reason: readErr.message });
            }
            return null;
          };

          foundInDir = await findFileAsync(cfg.exportDir, 0);
          if (foundInDir) {
            logInfo('export-check:fallback-scan', { prgName });
          }
        } catch (searchErr) {
          res.status(400).json({ success: false, error: searchErr.message });
          return;
        }
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
              if (fs.existsSync(manifestPath)) {
                const manifestContent = fs.readFileSync(manifestPath, 'utf8');
                const manifest = JSON.parse(manifestContent);
                if (manifest[prgName]) {
                  delete manifest[prgName];
                  const tmpPath = manifestPath + '.tmp';
                  fs.writeFileSync(tmpPath, JSON.stringify(manifest, null, 2));
                  fs.renameSync(tmpPath, manifestPath);
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
    const { elements = [], projectName = 'MyWatchFace' } = req.body;
    try {
      // Serialize builds: only one at a time (prevents file contention)
      const result = await buildQueue.add(
        () => buildProject(cfg, projectName, elements),
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
      if (err.message === 'Queue full — try again later') {
        res.set('Retry-After', '60');
        return res.status(503).json({ success: false, error: err.message, log: '', requestId: 'unknown' });
      }
      // Validation errors (from validateProjectName, validateElements) return 400.
      // Other errors (filesystem, etc.) return 500.
      if (err.message && (err.message.includes('Validation failed') || err.message.includes('Invalid') || err.message.includes('must be'))) {
        return res.status(400).json({ success: false, error: err.message, log: '', requestId: 'unknown' });
      }
      logError('export:error', { reason: err.message });
      res.status(500).json({ success: false, error: err.message, log: '', requestId: 'unknown' });
    }
  });
}

module.exports = { registerExportRoutes };
