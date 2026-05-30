// Build orchestration for Monkey C watch face projects.
// Handles validation, file generation, and compilation.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const { BUILD_TIMEOUT_MS } = require('../src/constants/timing.js');
const { logInfo, logError, logWarn } = require('./logger');
const { validateProjectName, validateElements } = require('./validation');
const { safePrgName } = require('./naming');
const { generateProjectFiles } = require('./generators');

/**
 * Clean up a request-scoped export directory.
 * Called on build failure, timeout, or when no longer needed.
 * Silently handles errors to prevent cleanup failures from masking build errors.
 *
 * @param {string} dir - Directory path to remove recursively
 */
function cleanupRequestDir(dir) {
  try {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      logInfo('build:cleanup-request-dir', { dir });
    }
  } catch (err) {
    logWarn('build:cleanup-failed', { dir, reason: err.message });
  }
}

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
    cleanupRequestDir(requestExportDir);
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
    cleanupRequestDir(requestExportDir);
    return { success: false, error: `File generation failed: ${fileErr.message}`, log: '', requestId };
  }

  // ─── Verify dependencies ──────────────────────────────────────────────
  if (!fs.existsSync(cfg.monkeyc)) {
    logError('build:monkeyc-not-found', { path: cfg.monkeyc });
    cleanupRequestDir(requestExportDir);
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
    cleanupRequestDir(requestExportDir);
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

  // Build arguments for monkeyc — paths with spaces are passed as single array elements
  const buildArgs = [
    '-o', outPrg,
    '-f', jungle,
    '-y', cfg.devKey,
    '-d', 'vivoactive6',
    '--warn'
  ];

  return new Promise((resolve) => {
    // On Windows: .bat files require shell: true; on Unix: native binaries
    const spawnOpts = process.platform === 'win32' ? { shell: true } : {};
    const child = spawn(cfg.monkeyc, buildArgs, spawnOpts);

    // Set up timeout: kill process if it exceeds BUILD_TIMEOUT_MS.
    // timedOut flag is used instead of checking signal==='SIGTERM' in the close
    // handler because Windows TerminateProcess sets signal=null, code=1 — the
    // signal string is never populated on Windows.
    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      logWarn('build:timeout-killing-process', { requestId, timeout: BUILD_TIMEOUT_MS });
      child.kill('SIGTERM');
    }, BUILD_TIMEOUT_MS);

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (err) => {
      // Clear timeout to prevent it from firing after error
      clearTimeout(timeoutHandle);
      cleanupRequestDir(requestExportDir);

      const log = [stdout, stderr].filter(Boolean).join('\n').trim();
      let userMessage;

      if (err.code === 'ENOENT') {
        userMessage = `monkeyc not found at: ${cfg.monkeyc}\nAdd the Garmin SDK bin directory to PATH or set GARMIN_SDK_BIN environment variable.`;
        logError('build:monkeyc-not-found', { path: cfg.monkeyc, requestId });
      } else if (err.code === 'EACCES') {
        userMessage = `Permission denied executing monkeyc at: ${cfg.monkeyc}\nCheck file permissions and try again.`;
        logError('build:permission-denied', { path: cfg.monkeyc, requestId });
      } else if (err.code === 'ENOEXEC') {
        userMessage = `monkeyc is not an executable: ${cfg.monkeyc}\nVerify the Garmin SDK installation is complete and correct.`;
        logError('build:not-executable', { path: cfg.monkeyc, requestId });
      } else {
        userMessage = `Failed to start compiler: ${err.message}`;
        logError('build:spawn-failed', { error: err.message, requestId });
      }

      return resolve({ success: false, error: userMessage, log, projectPath: requestExportDir, requestId });
    });

    child.on('close', (code, signal) => {
      // Clear timeout to prevent it from firing after process exit
      clearTimeout(timeoutHandle);

      const log = [stdout, stderr].filter(Boolean).join('\n').trim();

      // Handle non-zero exit code (including timeout)
      if (code !== 0) {
        cleanupRequestDir(requestExportDir);
        let userMessage;

        if (timedOut || signal === 'SIGTERM' || signal === 'SIGKILL') {
          userMessage = `Build timed out after ${BUILD_TIMEOUT_MS / 1000} seconds. Try simplifying the design or check system resources.`;
          logError('build:timeout', { signal, requestId, timeoutMs: BUILD_TIMEOUT_MS });
        } else {
          userMessage = `Build failed (exit code ${code}) — see log for details.`;
          logError('build:compilation-failed', { code, signal, stderr: stderr || '(no stderr)', requestId });
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
