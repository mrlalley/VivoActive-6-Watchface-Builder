import { DATA_FIELDS } from './data-fields.js';

// Allowlists used by importState to validate optional element fields.
// Must stay in sync with lib/validation.js (server-side) and properties.js (UI).
const IMPORT_VALID_FONTS = new Set([
  'FONT_XTINY', 'FONT_TINY', 'FONT_SMALL', 'FONT_MEDIUM', 'FONT_LARGE',
  'FONT_NUMBER_MILD', 'FONT_NUMBER_MEDIUM', 'FONT_NUMBER_HOT', 'FONT_NUMBER_THAI_HOT',
]);
const IMPORT_VALID_ALIGNS      = new Set(['left', 'center', 'right']);
const IMPORT_VALID_VISIBILITY  = new Set(['always', 'awake', 'sleep']);
const IMPORT_VALID_SHAPE_TYPES = new Set([
  'circle', 'line', 'arc',
  'tickHour', 'tickMinute', 'tickMixed', 'tickDots',
  'analogHour', 'analogMinute', 'analogSecond', 'analogCenter',
  'btIcon', 'moonPhase', 'hrGraph',
]);
const IMPORT_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

/**
 * @typedef {Object} Element
 * @property {number} id - Unique element identifier (auto-incremented)
 * @property {string} fieldId - Data field binding: 'time', 'date', 'steps', 'heartRate', 'battery', 'customLabel', 'analogHour', etc.
 * @property {string} label - Human-readable element name (e.g., "Heart Rate", "Time")
 * @property {number} x - Center X coordinate on canvas (0-390, constrained to safe area)
 * @property {number} y - Center Y coordinate on canvas (0-390, constrained to safe area)
 * @property {number} width - Element width in pixels (1-390)
 * @property {number} height - Element height in pixels (1-390)
 * @property {string} font - Garmin system font: 'FONT_XTINY'|'FONT_TINY'|'FONT_SMALL'|'FONT_MEDIUM'|'FONT_LARGE'|'FONT_NUMBER_MILD'|'FONT_NUMBER_MEDIUM'|'FONT_NUMBER_HOT'|'FONT_NUMBER_THAI_HOT'
 * @property {string} color - Hex color string in format '#RRGGBB' (e.g., '#FFFFFF')
 * @property {'left'|'center'|'right'} align - Text horizontal alignment
 * @property {'always'|'awake'|'sleep'} visibility - When element is visible on watch
 * @property {string} format - Format string or empty string (e.g., '%02d:%02d' for time)
 * @property {number} zIndex - Layer ordering (higher values drawn on top)
 * @property {string|null} shapeType - Shape type if element is a shape: 'hourHand'|'minuteHand'|'secondHand'|'analogCenter'|'tickHour'|'tickMinute'|'tickMixed'|'tickDots'|'circle'|'rectangle'|'ring'|'hrGraph' or null for text elements
 * @property {string} preview - Preview text shown on canvas during edit (e.g., "12:34", "BPM")
 */

// Total line-height in device pixels for each Garmin font (vivoactive6 simulator.json).
// Used for: (a) default element height at creation, (b) canvas font sizing, (c) auto-update on font change.
export const FONT_HEIGHTS = {
  FONT_XTINY:            17,
  FONT_TINY:             20,
  FONT_SMALL:            45,
  FONT_MEDIUM:           53,
  FONT_LARGE:            61,
  FONT_NUMBER_MILD:      97,
  FONT_NUMBER_MEDIUM:   130,
  FONT_NUMBER_HOT:      148,
  FONT_NUMBER_THAI_HOT: 179,
};

let elements = [];
let nextId = 1;
let history = [];
let historyIndex = -1;

/**
 * Create a new Element with default properties based on the field definition.
 * @param {string} fieldId - Data field identifier from DATA_FIELDS
 * @param {number} x - Initial X coordinate (0-390)
 * @param {number} y - Initial Y coordinate (0-390)
 * @returns {Element|null} New element with defaults applied, or null if fieldId not found
 */
export function createElement(fieldId, x, y) {
  const field = DATA_FIELDS.find(f => f.id === fieldId);
  if (!field) return null;

  const font = field.defaultFont || 'FONT_MEDIUM';
  const defaultH = field.shapeType
    ? (field.defaultHeight !== undefined ? field.defaultHeight : 60)
    : (FONT_HEIGHTS[font] || 36);
  const defaultW = field.defaultWidth !== undefined
    ? field.defaultWidth
    : (field.shapeType ? 60 : estimateTextWidth(font, field.preview ?? field.label));

  return {
    id: nextId++,
    fieldId,
    label: field.label,
    x,
    y,
    width:  defaultW,
    height: defaultH,
    font,
    color: field.defaultColor || '#FFFFFF',
    align: 'center',
    visibility: 'always',
    format: '',
    zIndex: elements.length,
    shapeType: field.shapeType || null,
    preview: field.preview !== undefined ? field.preview : field.label,
  };
}

// Rough character-width estimate for the initial selection box width.
function estimateTextWidth(font, text) {
  const charWidths = {
    FONT_XTINY: 7, FONT_TINY: 9, FONT_SMALL: 17, FONT_MEDIUM: 21, FONT_LARGE: 26,
    FONT_NUMBER_MILD: 32, FONT_NUMBER_MEDIUM: 48, FONT_NUMBER_HOT: 58, FONT_NUMBER_THAI_HOT: 70,
  };
  const cw = charWidths[font] || 21;
  return Math.min(380, Math.max(60, String(text || '').length * cw));
}

/**
 * Add an element to the canvas and optionally save to history.
 * @param {Element} el - Element to add
 * @param {boolean} [saveHistory=true] - Whether to save this action to undo/redo history
 */
export function addElement(el, saveHistory = true) {
  elements.push(el);
  if (saveHistory) pushHistory();
}

/**
 * Remove an element by ID and save to history.
 * @param {number} id - Element ID to remove
 */
export function removeElement(id) {
  elements = elements.filter(e => e.id !== id);
  pushHistory();
}

/**
 * Update an element's properties by ID.
 * @param {number} id - Element ID to update
 * @param {Partial<Element>} props - Properties to merge into the element
 */
export function updateElement(id, props) {
  const el = elements.find(e => e.id === id);
  if (el) Object.assign(el, props);
}

/**
 * Get all elements currently on the canvas.
 * @returns {Element[]} Array of all elements
 */
export function getElements() {
  return elements;
}

export function setElements(els) {
  elements = els;
  nextId = els.length > 0 ? Math.max(...els.map(e => e.id)) + 1 : 1;
}

export function exportState() {
  return JSON.stringify({ elements, nextId });
}

export function importState(json) {
  // Validate and parse JSON safely
  let state;
  try {
    state = JSON.parse(json);
  } catch (parseErr) {
    throw new Error(`Invalid JSON: ${parseErr.message}`);
  }

  // Validate state structure
  if (!state || typeof state !== 'object') {
    throw new Error('Design data is not an object');
  }

  // Validate elements array
  const elementsToLoad = state.elements || [];
  if (!Array.isArray(elementsToLoad)) {
    throw new Error('Design elements must be an array');
  }

  // Validate elements array structure
  if (elementsToLoad.length > 200) {
    throw new Error('Design has too many elements (max 200)');
  }

  // Validate each element has required fields
  elementsToLoad.forEach((el, idx) => {
    if (!el || typeof el !== 'object') {
      throw new Error(`Element ${idx} is not an object`);
    }
    if (!Number.isInteger(el.id) || el.id < 0) {
      throw new Error(`Element ${idx}: id must be a non-negative integer`);
    }
    if (typeof el.fieldId !== 'string' || !el.fieldId) {
      throw new Error(`Element ${idx}: fieldId must be a non-empty string`);
    }
    if (typeof el.x !== 'number' || typeof el.y !== 'number') {
      throw new Error(`Element ${idx}: x and y must be numbers`);
    }
    if (typeof el.width !== 'number' || typeof el.height !== 'number') {
      throw new Error(`Element ${idx}: width and height must be numbers`);
    }
    if (!Number.isInteger(el.zIndex) || el.zIndex < 0) {
      throw new Error(`Element ${idx}: zIndex must be a non-negative integer`);
    }
    // Optional field validation — only checked when the field is present
    if (el.color !== undefined && !IMPORT_COLOR_RE.test(el.color)) {
      throw new Error(`Element ${idx}: color "${el.color}" is not a valid hex color (expected #RRGGBB)`);
    }
    if (el.font !== undefined && !IMPORT_VALID_FONTS.has(el.font)) {
      throw new Error(`Element ${idx}: font "${el.font}" is not a recognised Garmin font. Valid fonts: ${[...IMPORT_VALID_FONTS].join(', ')}`);
    }
    if (el.align !== undefined && !IMPORT_VALID_ALIGNS.has(el.align)) {
      throw new Error(`Element ${idx}: align "${el.align}" must be one of: ${[...IMPORT_VALID_ALIGNS].join(', ')}`);
    }
    if (el.visibility !== undefined && !IMPORT_VALID_VISIBILITY.has(el.visibility)) {
      throw new Error(`Element ${idx}: visibility "${el.visibility}" must be one of: ${[...IMPORT_VALID_VISIBILITY].join(', ')}`);
    }
    // shapeType: null is valid (text element); a non-null string must be in the allowlist
    if (el.shapeType !== undefined && el.shapeType !== null && !IMPORT_VALID_SHAPE_TYPES.has(el.shapeType)) {
      throw new Error(`Element ${idx}: shapeType "${el.shapeType}" is not a recognised shape. Valid types: ${[...IMPORT_VALID_SHAPE_TYPES].join(', ')}`);
    }
  });

  // Validate nextId if present
  if (state.nextId !== undefined) {
    if (!Number.isInteger(state.nextId) || state.nextId < 0) {
      throw new Error('nextId must be a non-negative integer');
    }
  }

  // Load validated state
  elements = elementsToLoad;
  nextId = state.nextId !== undefined
    ? state.nextId
    : (elements.length > 0 ? Math.max(...elements.map(e => e.id)) + 1 : 1);
  history = [JSON.parse(JSON.stringify(elements))];
  historyIndex = 0;
}

export function commitHistory() {
  pushHistory();
}

export function undo() {
  if (historyIndex > 0) {
    historyIndex--;
    elements = JSON.parse(JSON.stringify(history[historyIndex]));
    return true;
  }
  return false;
}

export function redo() {
  if (historyIndex < history.length - 1) {
    historyIndex++;
    elements = JSON.parse(JSON.stringify(history[historyIndex]));
    return true;
  }
  return false;
}

function pushHistory() {
  history = history.slice(0, historyIndex + 1);
  history.push(JSON.parse(JSON.stringify(elements)));
  if (history.length > 10) {
    // Cap at 10 entries. After shift the array has 10 items and
    // historyIndex must point at the last one — without this decrement
    // it would freeze at 9 and the effective undo depth drops to 9.
    history.shift();
    historyIndex = history.length - 1;
  } else {
    historyIndex++;
  }
}

// Seed the empty initial state into history
pushHistory();
