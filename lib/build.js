// Build orchestration for Monkey C watch face projects.
// Handles validation, file generation, and compilation.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

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
 * @returns {Promise<{ success: boolean, error?: string, log: string, prgPath?: string, designPath?: string }>}
 */
async function buildProject(cfg, projectName, elements) {
  // ─── Validation ────────────────────────────────────────────────────────
  logInfo('build:start', { elementCount: elements.length, projectName });

  try {
    validateProjectName(projectName);
    validateElements(elements);
  } catch (validationErr) {
    logError('build:validation-failed', { reason: validationErr.message });
    return { success: false, error: `Validation failed: ${validationErr.message}`, log: '' };
  }

  // ─── Generate project files ────────────────────────────────────────────
  try {
    generateProjectFiles(elements, projectName, cfg);
    logInfo('build:files-generated', { projectName });
  } catch (fileErr) {
    logError('build:file-generation-failed', { reason: fileErr.message });
    return { success: false, error: `File generation failed: ${fileErr.message}`, log: '' };
  }

  // ─── Verify dependencies ──────────────────────────────────────────────
  if (!fs.existsSync(cfg.monkeyc)) {
    logError('build:monkeyc-not-found', { path: cfg.monkeyc });
    return {
      success: false,
      error: `monkeyc not found at: ${cfg.monkeyc}\nAdd the SDK bin directory to PATH or set GARMIN_SDK_BIN environment variable.`,
      log: '',
      projectPath: cfg.exportDir,
    };
  }

  if (!fs.existsSync(cfg.devKey)) {
    logError('build:devkey-not-found', { path: cfg.devKey });
    return {
      success: false,
      error: `Developer key not found at: ${cfg.devKey}\nGenerate one via Settings → Generate New Key.`,
      log: '',
      projectPath: cfg.exportDir,
    };
  }

  // ─── Build with monkeyc ───────────────────────────────────────────────
  const prgName = safePrgName(projectName);
  const outPrg = path.join(cfg.exportDir, 'bin', `${prgName}.prg`);
  const jungle = path.join(cfg.exportDir, 'monkey.jungle');

  logInfo('build:compiling', { prgName, outPrg });

  // Platform-aware command construction
  const isWindows = process.platform === 'win32';
  const cmd = isWindows ? 'cmd.exe' : cfg.monkeyc;
  const args = isWindows
    ? ['/c', cfg.monkeyc, '-o', outPrg, '-f', jungle, '-y', cfg.devKey, '-d', 'vivoactive6', '--warn']
    : ['-o', outPrg, '-f', jungle, '-y', cfg.devKey, '-d', 'vivoactive6', '--warn'];

  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 60000 }, (err, stdout, stderr) => {
      const log = [stdout, stderr].filter(Boolean).join('\n').trim();

      if (err) {
        // Distinguish error types and provide specific, actionable messages
        let userMessage;

        if (err.code === 'ENOENT') {
          // monkeyc executable not found
          userMessage = `monkeyc not found at: ${cfg.monkeyc}\nAdd the Garmin SDK bin directory to PATH or set GARMIN_SDK_BIN environment variable.`;
          logError('build:monkeyc-not-found', { path: cfg.monkeyc });
        } else if (err.code === 'EACCES') {
          // Permission denied
          userMessage = `Permission denied executing monkeyc at: ${cfg.monkeyc}\nCheck file permissions and try again.`;
          logError('build:permission-denied', { path: cfg.monkeyc });
        } else if (err.code === 'ENOEXEC') {
          // Not an executable file
          userMessage = `monkeyc is not an executable: ${cfg.monkeyc}\nVerify the Garmin SDK installation is complete and correct.`;
          logError('build:not-executable', { path: cfg.monkeyc });
        } else if (err.signal === 'SIGTERM' || err.signal === 'SIGKILL') {
          // Build timed out or was killed
          userMessage = `Build timed out after 60 seconds. Try simplifying the design or check system resources.`;
          logError('build:timeout', { signal: err.signal });
        } else if (err.code === 'ETIMEDOUT') {
          // Timeout from timeout option
          userMessage = `Build timed out after 60 seconds. Try simplifying the design or check system resources.`;
          logError('build:timeout', { code: err.code });
        } else if (err.killed) {
          // Process was explicitly killed
          userMessage = `Build was interrupted.`;
          logError('build:killed', { signal: err.signal });
        } else {
          // Unexpected error (exit code or other system error)
          userMessage = `Build failed — see log for details.`;
          logError('build:compilation-failed', { code: err.code, signal: err.signal, message: err.message });
        }

        return resolve({ success: false, error: userMessage, log, projectPath: cfg.exportDir });
      }

      // ─── Save design for later editing ─────────────────────────────────
      const designJson = path.join(cfg.exportDir, 'design.json');
      try {
        fs.writeFileSync(designJson, JSON.stringify({ projectName, elements }, null, 2));
        logInfo('build:design-saved', { designPath: designJson });
      } catch (saveErr) {
        logWarn('build:design-save-failed', { reason: saveErr.message });
      }

      logInfo('build:success', { prgPath: outPrg, designPath: designJson });
      resolve({
        success: true,
        log,
        prgPath: outPrg,
        designPath: designJson,
        projectPath: cfg.exportDir,
      });
    });
  });
}

module.exports = { buildProject };
