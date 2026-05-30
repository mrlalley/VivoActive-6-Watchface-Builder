import { getElements } from './elements.js';

/**
 * @typedef {Object} Element
 * @property {number} id - Unique element identifier
 * @property {string} fieldId - Data field binding
 * @property {string} label - Human-readable element name
 * @property {number} x - Center X coordinate (0-390)
 * @property {number} y - Center Y coordinate (0-390)
 * @property {number} width - Element width in pixels
 * @property {number} height - Element height in pixels
 * @property {string} font - Garmin font name
 * @property {string} color - Hex color '#RRGGBB'
 * @property {'left'|'center'|'right'} align - Text alignment
 * @property {'always'|'awake'|'sleep'} visibility - Visibility state
 * @property {string} format - Format string for data display
 * @property {number} zIndex - Layer ordering
 * @property {string|null} shapeType - Shape type or null for text elements
 * @property {string} preview - Preview text for editing
 */

/**
 * Export the current canvas design as a Monkey C project and build .prg file.
 * Sends all elements to the server for code generation and compilation.
 * @param {string} [projectName='MyWatchFace'] - Name for the Monkey C project
 * @returns {Promise<Object>} Server response with build status, prgPath, and log
 */
export async function exportProject(projectName = 'MyWatchFace') {
  const elements = getElements();
  const res = await fetch('/api/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ elements, projectName }),
  });
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  return res.json();
}

/**
 * Preview the current design in the Garmin Connect IQ simulator.
 * Builds and loads the watch face into the simulator for interactive testing.
 * @returns {Promise<Object>} Server response with preview status and log
 */
export async function previewInSimulator() {
  const elements = getElements();
  const res = await fetch('/api/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ elements, projectName: 'WatchFacePreview' }),
  });
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  return res.json();
}
