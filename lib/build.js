// Build orchestration for Monkey C watch face projects.
// Handles validation, file generation, and compilation.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const { BUILD_TIMEOUT_MS } = require('../src/constants/timing.js');
const { logInfo, logError, logWarn } = require('./logger');
const { validateProjectName, validateElements } = require('./validation');
const { safePrgName } = require('./naming');
const { generateProjectFiles } = require('./generators');

/**
 * Build a Monkey C watch face project and generate a .prg binary.
 *
 * @param {Object} cfg - Configuration object { monkeyc, devKey, exportDir, ... }
 * @param {string} projectName - Name of the watch face project
 * @param {Array} elements - Canvas elements array to render
 * @param {string} requestId - Optional unique request ID (generates one if not provided)
 * @returns {Promise<{ success: boolean, error?: string, log: string, prgPath?: string, designPath?: string, requestId: string }>}
 */
async function buildProject(cfg, projectName, elements, requestId = null) {
  // Generate unique request ID if not provided (for isolation)
  if (!requestId) {
    requestId = Math.random().toString(36).slice(2, 10);
  }
  // ─── Request-scoped export directory (prevents file contention) ────────
  const requestExportDir = path.join(cfg.exportDir, requestId);
  logInfo('build:request-isolated', { requestId, exportDir: requestExportDir });

  // ─── Validation ────────────────────────────────────────────────────────
  logInfo('build:start', { elementCount: elements.length, projectName, requestId });

  try {
    validateProjectName(projectName);
    validateElements(elements);
  } catch (validationErr) {
    logError('build:validation-failed', { reason: validationErr.message });
    return { success: false, error: `Validation failed: ${validationErr.message}`, log: '', requestId };
  }

  // ─── Generate project files (to request-scoped directory) ──────────────
  try {
    // Create request-scoped directory
    fs.mkdirSync(requestExportDir, { recursive: true });

    // Pass request-scoped config to generators
    const requestCfg = { ...cfg, exportDir: requestExportDir };
    generateProjectFiles(elements, projectName, requestCfg);
    logInfo('build:files-generated', { projectName, requestId });
  } catch (fileErr) {
    logError('build:file-generation-failed', { reason: fileErr.message });
    return { success: false, error: `File generation failed: ${fileErr.message}`, log: '', requestId };
  }

  // ─── Verify dependencies ──────────────────────────────────────────────
  if (!fs.existsSync(cfg.monkeyc)) {
    logError('build:monkeyc-not-found', { path: cfg.monkeyc });
    return {
      success: false,
      error: `monkeyc not found at: ${cfg.monkeyc}\nAdd the SDK bin directory to PATH or set GARMIN_SDK_BIN environment variable.`,
      log: '',
      projectPath: requestExportDir,
      requestId,
    };
  }

  if (!fs.existsSync(cfg.devKey)) {
    logError('build:devkey-not-found', { path: cfg.devKey });
    return {
      success: false,
      error: `Developer key not found at: ${cfg.devKey}\nGenerate one via Settings → Generate New Key.`,
      log: '',
      projectPath: requestExportDir,
      requestId,
    };
  }

  // ─── Build with monkeyc (using request-scoped paths) ──────────────────
  const prgName = safePrgName(projectName);
  const outPrg = path.join(requestExportDir, 'bin', `${prgName}.prg`);
  const jungle = path.join(requestExportDir, 'monkey.jungle');

  logInfo('build:compiling', { prgName, outPrg, requestId });

  // Platform-aware command construction
  const isWindows = process.platform === 'win32';
  const cmd = isWindows ? 'cmd.exe' : cfg.monkeyc;
  const args = isWindows
    ? ['/c', cfg.monkeyc, '-o', outPrg, '-f', jungle, '-y', cfg.devKey, '-d', 'vivoactive6', '--warn']
    : ['-o', outPrg, '-f', jungle, '-y', cfg.devKey, '-d', 'vivoactive6', '--warn'];

  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: BUILD_TIMEOUT_MS }, (err, stdout, stderr) => {
      const log = [stdout, stderr].filter(Boolean).join('\n').trim();

      if (err) {
        // Distinguish error types and provide specific, actionable messages
        let userMessage;

        if (err.code === 'ENOENT') {
          // monkeyc executable not found
          userMessage = `monkeyc not found at: ${cfg.monkeyc}\nAdd the Garmin SDK bin directory to PATH or set GARMIN_SDK_BIN environment variable.`;
          logError('build:monkeyc-not-found', { path: cfg.monkeyc, requestId });
        } else if (err.code === 'EACCES') {
          // Permission denied
          userMessage = `Permission denied executing monkeyc at: ${cfg.monkeyc}\nCheck file permissions and try again.`;
          logError('build:permission-denied', { path: cfg.monkeyc, requestId });
        } else if (err.code === 'ENOEXEC') {
          // Not an executable file
          userMessage = `monkeyc is not an executable: ${cfg.monkeyc}\nVerify the Garmin SDK installation is complete and correct.`;
          logError('build:not-executable', { path: cfg.monkeyc, requestId });
        } else if (err.signal === 'SIGTERM' || err.signal === 'SIGKILL') {
          // Build timed out or was killed
          userMessage = `Build timed out after 60 seconds. Try simplifying the design or check system resources.`;
          logError('build:timeout', { signal: err.signal, requestId });
        } else if (err.code === 'ETIMEDOUT') {
          // Timeout from timeout option
          userMessage = `Build timed out after 60 seconds. Try simplifying the design or check system resources.`;
          logError('build:timeout', { code: err.code, requestId });
        } else if (err.killed) {
          // Process was explicitly killed
          userMessage = `Build was interrupted.`;
          logError('build:killed', { signal: err.signal, requestId });
        } else {
          // Unexpected error (exit code or other system error)
          userMessage = `Build failed — see log for details.`;
          logError('build:compilation-failed', { code: err.code, signal: err.signal, message: err.message, requestId });
        }

        return resolve({ success: false, error: userMessage, log, projectPath: requestExportDir, requestId });
      }

      // ─── Save design for later editing (atomic write-then-rename) ────────
      const designJson = path.join(requestExportDir, 'design.json');
      const designTmp = path.join(requestExportDir, '.design.json.tmp');
      try {
        fs.writeFileSync(designTmp, JSON.stringify({ projectName, elements }, null, 2));
        fs.renameSync(designTmp, designJson);
        logInfo('build:design-saved', { designPath: designJson, requestId });
      } catch (saveErr) {
        try { fs.unlinkSync(designTmp); } catch {}
        logWarn('build:design-save-failed', { reason: saveErr.message, requestId });
      }

      logInfo('build:success', { prgPath: outPrg, designPath: designJson, requestId });
      resolve({
        success: true,
        log,
        prgPath: outPrg,
        designPath: designJson,
        projectPath: requestExportDir,
        requestId,
      });
    });
  });
}

module.exports = { buildProject };
