// Build orchestration for Monkey C watch face projects.
// Handles validation, file generation, and compilation.

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { DEVICE_ID } = require('../src/constants/device');
const { spawn } = require('child_process');

const { BUILD_TIMEOUT_MS } = require('../src/constants/timing.js');
const { createLogger, logInfo, logError, logWarn } = require('./logger');

// Module-level logger for monkeyc invocation tracing.
const buildLog = createLogger('build');
const { validateProjectName, validateElements } = require('./validation');
const { ValidationError } = require('./errors');
const { safePrgName } = require('./naming');
const { generateProjectFiles } = require('./generators');

/**
 * Update the export manifest to record a successful build.
 * The manifest maps safe project names to their requestId directories,
 * allowing /api/export/check to use direct lookup instead of tree scanning.
 *
 * @param {string} exportDir - Root export directory
 * @param {string} projectName - User-provided project name
 * @param {string} requestId - Request ID directory
 */
function updateExportManifest(exportDir, projectName, requestId) {
  const manifestPath = path.join(exportDir, '.exports.json');
  const safeProjectName = safePrgName(projectName);

  try {
    let manifest = {};
    if (fs.existsSync(manifestPath)) {
      const content = fs.readFileSync(manifestPath, 'utf8');
      manifest = JSON.parse(content);
    }

    // Record the requestId for this project
    manifest[safeProjectName] = requestId;

    // Write atomically: write to temp file, then rename
    const tmpPath = manifestPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(manifest, null, 2));
    fs.renameSync(tmpPath, manifestPath);

    logInfo('build:manifest-updated', { safeProjectName, requestId });
  } catch (err) {
    // Manifest update failure is non-fatal — the recursive fallback will still work
    logWarn('build:manifest-update-failed', { reason: err.message });
  }
}

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
    requestId = crypto.randomBytes(6).toString('hex'); // 12 hex chars, 48 bits of entropy
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
    // Re-throw ValidationError so route handlers can classify it with instanceof
    if (validationErr instanceof ValidationError) {
      throw validationErr;
    }
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
    '-d', DEVICE_ID,
    '--warn'
  ];

  const monkeycLog  = buildLog.child({ requestId, component: 'monkeyc' });
  const monkeycArgv = [cfg.monkeyc, ...buildArgs]; // logged before shell-quoting so it's readable
  monkeycLog.info({ event: 'monkeyc.start', argv: monkeycArgv });
  const monkeycStartMs = Date.now();

  return new Promise((resolve) => {
    // On Windows: .bat files require shell: true; on Unix: native binaries
    const spawnOpts = process.platform === 'win32' ? { shell: true } : {};
    const monkeycExe = process.platform === 'win32' ? `"${cfg.monkeyc}"` : cfg.monkeyc;
    const child = spawn(monkeycExe, buildArgs, spawnOpts);

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
      monkeycLog.fatal({
        event:      'monkeyc.spawn_error',
        code:       err.code,
        message:    err.message,
        durationMs: Date.now() - monkeycStartMs,
      });
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
        const monkeycDurationMs = Date.now() - monkeycStartMs;
        monkeycLog.error({
          event:      'monkeyc.failure',
          exitCode:   code,
          signal,
          durationMs: monkeycDurationMs,
          stderr:     stderr || '(no stderr)',
        });

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

      monkeycLog.info({
        event:      'monkeyc.success',
        exitCode:   0,
        durationMs: Date.now() - monkeycStartMs,
      });

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

      // Record the successful build in the export manifest for faster future lookups
      updateExportManifest(cfg.exportDir, projectName, requestId);

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

/**
 * Rebuild the export manifest by scanning the exportDir for .prg files.
 * Reconstructs the .exports.json mapping from scratch when the manifest
 * is missing or stale.
 *
 * Non-fatal on failure — logs warning but does not throw.
 *
 * @param {string} exportDir - Root export directory
 * @returns {Promise<number>} - Number of .prg files found
 */
async function rebuildExportManifest(exportDir) {
  let manifest = {};
  let prgCount = 0;

  try {
    const entries = await fs.promises.readdir(exportDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue; // skip files and symlinks

      const requestId = entry.name;
      const binDir = path.join(exportDir, requestId, 'bin');

      try {
        const binEntries = await fs.promises.readdir(binDir, { withFileTypes: true });
        for (const binEntry of binEntries) {
          if (binEntry.isFile() && binEntry.name.endsWith('.prg')) {
            const prgName = path.basename(binEntry.name, '.prg');
            manifest[prgName] = requestId;
            prgCount++;
          }
        }
      } catch (binErr) {
        if (binErr.code !== 'ENOENT') {
          logWarn('build:manifest-rebuild-scan-failed', { requestId, reason: binErr.message });
        }
      }
    }

    // Write manifest atomically
    const manifestPath = path.join(exportDir, '.exports.json');
    const tmpPath = manifestPath + '.tmp';
    await fs.promises.writeFile(tmpPath, JSON.stringify(manifest, null, 2));
    await fs.promises.rename(tmpPath, manifestPath);

    logInfo('build:manifest-rebuilt', { prgCount, exportDir: path.basename(exportDir) });
    return prgCount;
  } catch (err) {
    logWarn('build:manifest-rebuild-failed', { reason: err.message });
    return 0;
  }
}

/**
 * Delete request-scoped export subdirectories older than maxAgeDays.
 * Called once at server startup to prevent unbounded disk growth.
 * Never throws — all errors are caught and logged; the sweep continues on failure.
 *
 * Only immediate children of exportDir are ever deleted; exportDir itself is never touched.
 * Symlinks are skipped because fs.Dirent.isDirectory() uses lstat semantics.
 *
 * @param {string} exportDir - Root export directory containing requestId subdirectories
 * @param {number} maxAgeDays - Delete subdirectories not modified in this many days
 */
async function sweepExportDir(exportDir, maxAgeDays = 7) {
  const maxAgeMs = maxAgeDays * 86_400_000;
  let found = 0, deleted = 0, skipped = 0;

  let entries;
  try {
    entries = await fs.promises.readdir(exportDir, { withFileTypes: true });
  } catch (err) {
    // ENOENT is normal on first run — exportDir hasn't been created yet.
    if (err.code !== 'ENOENT') {
      logWarn('sweep:readdir-failed', { exportDir, reason: err.message });
    }
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue; // skip files and symlinks (lstat semantics)
    found++;
    const fullPath = path.join(exportDir, entry.name);

    // Belt-and-suspenders: only delete paths whose direct parent is exportDir.
    if (path.resolve(path.dirname(fullPath)) !== path.resolve(exportDir)) {
      logWarn('sweep:unsafe-path-skipped', { fullPath });
      skipped++;
      continue;
    }

    try {
      const stat = await fs.promises.stat(fullPath);
      if (Date.now() - stat.mtimeMs > maxAgeMs) {
        await fs.promises.rm(fullPath, { recursive: true, force: true });
        logInfo('sweep:deleted', { dir: entry.name, ageDays: Math.floor((Date.now() - stat.mtimeMs) / 86_400_000) });
        deleted++;
      }
    } catch (err) {
      logWarn('sweep:entry-skipped', { name: entry.name, reason: err.message });
      skipped++;
    }
  }

  logInfo('sweep:complete', { exportDir: path.basename(exportDir), found, deleted, skipped });
}

module.exports = { buildProject, rebuildExportManifest, sweepExportDir };
