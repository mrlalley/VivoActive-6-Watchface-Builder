// Design persistence layer.
// Handles saving, loading, and listing watch face designs.

const fs = require('fs');
const path = require('path');

const { logInfo, logError } = require('./logger');
const { safePrgName } = require('./naming');
const { validateProjectName, validateElements } = require('./validation');

/**
 * Save a watch face design to disk as JSON.
 * Creates the designs directory if it doesn't exist.
 *
 * @param {string} designsDir - Directory to save designs
 * @param {string} projectName - Design name
 * @param {Array} elements - Canvas elements array
 * @returns {{ success: boolean, filePath: string, projectName: string, elementCount: number }}
 * @throws {Error} on validation failure or I/O error
 */
function saveDesign(designsDir, projectName, elements) {
  // Validate input
  validateProjectName(projectName);
  validateElements(elements);

  // Create designs directory (atomic, handles concurrent mkdir gracefully)
  try {
    fs.mkdirSync(designsDir, { recursive: true });
  } catch (err) {
    // EEXIST is OK (another process created it concurrently)
    if (err.code !== 'EEXIST') {
      logError('design-store:mkdir-failed', { reason: err.message });
      throw new Error(`Cannot create designs directory: ${err.message}`);
    }
  }

  // Generate safe filename and write file atomically (write-to-temp-then-rename)
  let tempPath;
  try {
    const fileName = `${safePrgName(projectName)}.json`;
    const filePath = path.join(designsDir, fileName);

    // Use per-call unique identifier to prevent concurrent save race conditions
    const uniqueId = Math.random().toString(36).slice(2, 10);
    tempPath = path.join(designsDir, `.${fileName}.${uniqueId}.tmp`);

    const designData = {
      projectName,
      elements,
      savedAt: new Date().toISOString(),
    };

    // Write to temp file first (atomic write)
    fs.writeFileSync(tempPath, JSON.stringify(designData, null, 2));

    // Atomic rename: either complete or fails (no partial file visible)
    fs.renameSync(tempPath, filePath);

    logInfo('design-store:saved', { filePath });

    return {
      success: true,
      filePath: filePath.replace(process.cwd(), '.'),
      projectName,
      elementCount: elements.length,
    };
  } catch (err) {
    // Clean up temp file if it exists (may have been partially written)
    if (tempPath) {
      try {
        fs.unlinkSync(tempPath);
      } catch {}
    }

    logError('design-store:save-failed', { reason: err.message });
    throw new Error(`Failed to save design: ${err.message}`);
  }
}

/**
 * Load all saved designs from disk.
 *
 * @param {string} designsDir - Directory containing designs
 * @returns {Array<{ name: string, file: string, savedAt: string, elementCount: number }>}
 */
function listDesigns(designsDir) {
  try {
    if (!fs.existsSync(designsDir)) {
      return [];
    }

    const files = fs.readdirSync(designsDir).filter(f => f.endsWith('.json'));
    const designs = files.map(file => {
      const filePath = path.join(designsDir, file);
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return {
          name: data.projectName || file.replace('.json', ''),
          file: file,
          savedAt: data.savedAt || 'unknown',
          elementCount: data.elements ? data.elements.length : 0,
        };
      } catch (parseErr) {
        logError('design-store:parse-failed', { file, reason: parseErr.message });
        return null;
      }
    }).filter(Boolean);

    logInfo('design-store:listed', { count: designs.length });
    return designs;
  } catch (err) {
    logError('design-store:list-failed', { reason: err.message });
    throw new Error(`Failed to list designs: ${err.message}`);
  }
}

/**
 * Load a specific design by filename.
 * Sanitizes filename to prevent path traversal attacks.
 *
 * @param {string} designsDir - Directory containing designs
 * @param {string} filename - Design filename (will be sanitized)
 * @returns {{ projectName: string, elements: Array, savedAt: string }}
 * @throws {Error} if file not found or parse fails
 */
function loadDesign(designsDir, filename) {
  try {
    // Sanitize filename: remove special characters
    const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, '');

    const filePath = path.join(designsDir, sanitized);

    // Path traversal safety: ensure path is within designsDir
    const resolved = path.resolve(filePath);
    const designsDirResolved = path.resolve(designsDir);
    if (!resolved.startsWith(designsDirResolved)) {
      throw new Error('Invalid filename');
    }

    if (!fs.existsSync(filePath)) {
      logError('design-store:not-found', { file: sanitized });
      throw new Error('Design not found');
    }

    // Parse JSON safely
    let data;
    try {
      data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (parseErr) {
      logError('design-store:parse-failed', { file: sanitized, reason: parseErr.message });
      throw new Error(`Design file is corrupted: ${parseErr.message}`);
    }

    // Validate state structure
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Design data is not an object');
    }

    // Validate elements array
    const elementsToLoad = data.elements || [];
    if (!Array.isArray(elementsToLoad)) {
      throw new Error('Design elements must be an array');
    }

    // Validate elements - collect warnings instead of failing hard
    let validationWarning = null;
    if (elementsToLoad.length > 0) {
      try {
        validateElements(elementsToLoad);
      } catch (validationErr) {
        // Load design anyway, but flag the warning
        validationWarning = validationErr.message;
        logInfo('design-store:validation-warning', { file: sanitized, warning: validationWarning });
      }
    }

    // Validate nextId if present in design (optional field, but validate if present)
    if (data.nextId !== undefined) {
      if (!Number.isInteger(data.nextId) || data.nextId < 0) {
        throw new Error('Invalid nextId in design file');
      }
    }

    logInfo('design-store:loaded', { file: sanitized });

    const result = {
      projectName: data.projectName,
      elements: elementsToLoad,
      savedAt: data.savedAt,
    };

    if (validationWarning) {
      result.validationWarning = validationWarning;
    }

    return result;
  } catch (err) {
    logError('design-store:load-failed', { reason: err.message });
    throw new Error(`Failed to load design: ${err.message}`);
  }
}

module.exports = { saveDesign, listDesigns, loadDesign };
