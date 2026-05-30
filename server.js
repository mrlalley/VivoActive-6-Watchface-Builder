// Watch Face Builder Express server
// Exports Monkey C projects for Garmin Vivoactive 6 watch faces

const express = require('express');
const path = require('path');
const fs = require('fs');
const { execFile, spawn } = require('child_process');

const { getConfig } = require('./lib/config');
const { logInfo, logError, logWarn } = require('./lib/logger');
const { validateProjectName, validateElements } = require('./lib/validation');
const { safePrgName } = require('./lib/naming');
const { waitForSimulator } = require('./lib/simulator');
const { generateProjectFiles } = require('./lib/generators');

// ─── Server factory ────────────────────────────────────────────────────────────
// Creates and returns an Express app with all routes configured

function createServer(config = {}) {
  const cfg = getConfig(config);
  const app = express();

  app.use(express.json({ limit: '10mb' }));
  app.use(express.static(path.join(__dirname, 'builder')));

  // ── POST /api/export – Export and build .prg file ──
  app.post('/api/export', (req, res) => {
    const { elements = [], projectName = 'MyWatchFace' } = req.body;

    logInfo('export:start', { elementCount: elements.length, projectName });

    // Validate input
    try {
      validateProjectName(projectName);
      validateElements(elements);
    } catch (validationErr) {
      logError('export:validation-failed', { reason: validationErr.message });
      return res.json({ success: false, error: `Validation failed: ${validationErr.message}`, log: '' });
    }

    // Generate project files
    try {
      generateProjectFiles(elements, projectName, cfg);
      logInfo('export:files-generated', { projectName });
    } catch (fileErr) {
      logError('export:file-generation-failed', { reason: fileErr.message });
      return res.json({ success: false, error: `File generation failed: ${fileErr.message}`, log: '' });
    }

    // Check dependencies
    if (!fs.existsSync(cfg.monkeyc)) {
      logError('export:monkeyc-not-found', { path: cfg.monkeyc });
      return res.json({
        success: false,
        error: `monkeyc not found. Add the SDK bin directory to PATH:\n  ${cfg.sdkBin}\nThen restart this server, or open exported-garmin-project/ in VS Code and run "Monkey C: Build for Device".`,
        log: '',
        projectPath: cfg.exportDir,
      });
    }

    if (!fs.existsSync(cfg.devKey)) {
      logError('export:devkey-not-found', { path: cfg.devKey });
      return res.json({
        success: false,
        error: `Developer key not found at: ${cfg.devKey}\nGenerate one via VS Code Command Palette → "Monkey C: Generate a Developer Key".`,
        log: '',
        projectPath: cfg.exportDir,
      });
    }

    const prgName = safePrgName(projectName);
    const outPrg = path.join(cfg.exportDir, 'bin', `${prgName}.prg`);
    const jungle = path.join(cfg.exportDir, 'monkey.jungle');

    logInfo('export:building', { prgName, outPrg });

    execFile(cfg.monkeyc, ['-o', outPrg, '-f', jungle, '-y', cfg.devKey, '-d', 'vivoactive6', '--warn'], { timeout: 60000 }, (err, stdout, stderr) => {
      const log = [stdout, stderr].filter(Boolean).join('\n').trim();
      if (err) {
        logError('export:build-failed', { code: err.code, signal: err.signal, message: err.message });
        return res.json({ success: false, error: 'Build failed — see log for details.', log, projectPath: cfg.exportDir });
      }

      // Save design as JSON for future editing
      const designJson = path.join(cfg.exportDir, 'design.json');
      try {
        fs.writeFileSync(designJson, JSON.stringify({ projectName, elements }, null, 2));
        logInfo('export:design-saved', { designPath: designJson });
      } catch (saveErr) {
        logWarn('export:design-save-failed', { reason: saveErr.message });
      }

      logInfo('export:build-success', { prgPath: outPrg, designPath: designJson });
      res.json({ success: true, log, prgPath: outPrg, designPath: designJson, projectPath: cfg.exportDir });
    });
  });

  // ── POST /api/save-design – Save design to local JSON file ──
  app.post('/api/save-design', (req, res) => {
    const { projectName = 'MyWatchFace', elements = [] } = req.body;

    logInfo('save-design:start', { projectName, elementCount: elements.length });

    try {
      validateProjectName(projectName);
      validateElements(elements);
    } catch (validationErr) {
      logError('save-design:validation-failed', { reason: validationErr.message });
      return res.json({ success: false, error: validationErr.message });
    }

    try {
      const designsDir = path.join(__dirname, 'designs');
      if (!fs.existsSync(designsDir)) {
        fs.mkdirSync(designsDir, { recursive: true });
      }

      const fileName = `${safePrgName(projectName)}.json`;
      const filePath = path.join(designsDir, fileName);
      const designData = { projectName, elements, savedAt: new Date().toISOString() };

      fs.writeFileSync(filePath, JSON.stringify(designData, null, 2));
      logInfo('save-design:success', { filePath });

      res.json({
        success: true,
        filePath: filePath.replace(__dirname, '.'),
        projectName,
        elementCount: elements.length,
      });
    } catch (err) {
      logError('save-design:failed', { reason: err.message });
      res.json({ success: false, error: `Failed to save: ${err.message}` });
    }
  });

  // ── POST /api/preview – Build and launch in simulator ──
  app.post('/api/preview', (req, res) => {
    const { elements = [], projectName = 'WatchFacePreview' } = req.body;

    logInfo('preview:start', { elementCount: elements.length, projectName });

    // Validate input
    try {
      validateProjectName(projectName);
      validateElements(elements);
    } catch (validationErr) {
      logError('preview:validation-failed', { reason: validationErr.message });
      return res.json({ success: false, error: `Validation failed: ${validationErr.message}`, log: '' });
    }

    // Generate project files
    try {
      generateProjectFiles(elements, projectName, cfg);
      logInfo('preview:files-generated', { projectName });
    } catch (fileErr) {
      logError('preview:file-generation-failed', { reason: fileErr.message });
      return res.json({ success: false, error: `File generation failed: ${fileErr.message}`, log: '' });
    }

    if (!fs.existsSync(cfg.monkeyc)) {
      logError('preview:monkeyc-not-found', { path: cfg.monkeyc });
      return res.json({ success: false, error: 'monkeyc not found.', log: '' });
    }
    if (!fs.existsSync(cfg.devKey)) {
      logError('preview:devkey-not-found', { path: cfg.devKey });
      return res.json({ success: false, error: 'Developer key not found.', log: '' });
    }

    const outPrg = path.join(cfg.exportDir, 'bin', 'WatchFace.prg');
    const jungle = path.join(cfg.exportDir, 'monkey.jungle');

    logInfo('preview:building', { outPrg });

    execFile(cfg.monkeyc, ['-o', outPrg, '-f', jungle, '-y', cfg.devKey, '-d', 'vivoactive6', '--warn'], { timeout: 60000 }, (buildErr, stdout, stderr) => {
      const log = [stdout, stderr].filter(Boolean).join('\n').trim();
      if (buildErr) {
        logError('preview:build-failed', { code: buildErr.code, signal: buildErr.signal });
        return res.json({ success: false, error: 'Build failed — see log.', log });
      }

      logInfo('preview:build-success', {});

      // Save design as JSON for future editing
      const designJson = path.join(cfg.exportDir, 'design.json');
      try {
        fs.writeFileSync(designJson, JSON.stringify({ projectName, elements }, null, 2));
        logInfo('preview:design-saved', { designPath: designJson });
      } catch (saveErr) {
        logWarn('preview:design-save-failed', { reason: saveErr.message });
      }

      execFile('tasklist.exe', ['/FI', 'IMAGENAME eq simulator.exe', '/NH'], (taskErr, taskOut) => {
        const simRunning = taskOut && taskOut.toLowerCase().includes('simulator.exe');

        if (!simRunning) {
          logInfo('preview:launching-simulator', {});
          spawn(cfg.simExe, [], { detached: true, stdio: 'ignore' }).unref();
        } else {
          logInfo('preview:simulator-already-running', {});
        }

        res.json({ success: true, log, message: simRunning ? 'Reloading in simulator…' : 'Starting simulator…' });

        waitForSimulator(() => {
          const tmpDir = cfg.tempDir;
          const tmpPrg = path.join(tmpDir, 'WatchFace.prg');
          try {
            fs.mkdirSync(tmpDir, { recursive: true });
            fs.copyFileSync(outPrg, tmpPrg);
            logInfo('preview:prg-copied', { from: outPrg, to: tmpPrg });
          } catch (copyErr) {
            logWarn('preview:prg-copy-failed', { reason: copyErr.message });
          }

          const prgArg = fs.existsSync(tmpPrg) ? tmpPrg : outPrg;
          logInfo('preview:loading-prg', { prgPath: prgArg });
          execFile(cfg.monkeydo, [prgArg, 'vivoactive6'], (mdErr, mdOut, mdErr2) => {
            const mdLog = [mdOut, mdErr2].filter(Boolean).join('\n').trim();
            if (mdErr) {
              logError('preview:monkeydo-failed', { code: mdErr.code, message: mdErr.message });
            } else {
              logInfo('preview:monkeydo-success', {});
            }
          });
        });
      });
    });
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
