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

  // Create designs directory if needed
  try {
    if (!fs.existsSync(designsDir)) {
      fs.mkdirSync(designsDir, { recursive: true });
    }
  } catch (err) {
    logError('design-store:mkdir-failed', { reason: err.message });
    throw new Error(`Cannot create designs directory: ${err.message}`);
  }

  // Generate safe filename and write file
  try {
    const fileName = `${safePrgName(projectName)}.json`;
    const filePath = path.join(designsDir, fileName);
    const designData = {
      projectName,
      elements,
      savedAt: new Date().toISOString(),
    };

    fs.writeFileSync(filePath, JSON.stringify(designData, null, 2));
    logInfo('design-store:saved', { filePath });

    return {
      success: true,
      filePath: filePath.replace(process.cwd(), '.'),
      projectName,
      elementCount: elements.length,
    };
  } catch (err) {
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

    // Validate elements using existing validator
    if (elementsToLoad.length > 0) {
      try {
        validateElements(elementsToLoad);
      } catch (validationErr) {
        throw new Error(`Invalid design elements: ${validationErr.message}`);
      }
    }

    // Validate nextId if present in design (optional field, but validate if present)
    if (data.nextId !== undefined) {
      if (!Number.isInteger(data.nextId) || data.nextId < 0) {
        throw new Error('Invalid nextId in design file');
      }
    }

    logInfo('design-store:loaded', { file: sanitized });

    return {
      projectName: data.projectName,
      elements: elementsToLoad,
      savedAt: data.savedAt,
    };
  } catch (err) {
    logError('design-store:load-failed', { reason: err.message });
    throw new Error(`Failed to load design: ${err.message}`);
  }
}

module.exports = { saveDesign, listDesigns, loadDesign };
