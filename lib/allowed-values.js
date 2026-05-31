// Single source of truth for validation allowlists shared across three layers:
//   - lib/validation.js          (HTTP input validation)
//   - builder/modules/elements.js (canvas importState sanitization)
//   - lib/generators/monkeyc.js  (Monkey C generation guard)
//
// MAINTENANCE: When adding a new field type to builder/modules/data-fields.js,
// add its font, shape type, or align value here. The CI test in
// __tests__/allowed-values.test.js will catch any call site that uses a stale
// local copy instead of importing from this module.
//
// DO NOT add shape-type, font, align, or visibility constants anywhere else.
// The three files above must import from this module exclusively.

'use strict';

// Font identifiers — all Garmin font names valid for text elements.
// Source: union of defaultFont values from builder/modules/data-fields.js
const VALID_FONTS = Object.freeze([
  'FONT_XTINY',
  'FONT_TINY',
  'FONT_SMALL',
  'FONT_MEDIUM',
  'FONT_LARGE',
  'FONT_NUMBER_MILD',
  'FONT_NUMBER_MEDIUM',
  'FONT_NUMBER_HOT',
  'FONT_NUMBER_THAI_HOT',
]);

// Shape types — all valid element types that can appear on the canvas
// and be exported to Monkey C. Includes basic shapes, tick marks, analog hands,
// and special graphics.
// Source: union of shapeType values from builder/modules/data-fields.js
const VALID_SHAPE_TYPES = Object.freeze([
  // Basic shapes
  'circle',
  'line',
  'arc',
  // Tick marks
  'tickHour',
  'tickMinute',
  'tickMixed',
  'tickDots',
  // Analog hands
  'analogHour',
  'analogMinute',
  'analogSecond',
  'analogCenter',
  // Special graphics
  'btIcon',
  'moonPhase',
  'hrGraph',
]);

// Text alignment values — valid for text element rendering.
// Only present in browser-side validation (importState).
const VALID_ALIGNS = Object.freeze([
  'left',
  'center',
  'right',
]);

// Visibility modes — when element is visible on the watch.
// Used by both server-side and browser-side validation.
const VALID_VISIBILITY = Object.freeze([
  'always',
  'awake',
  'sleep',
]);

module.exports = {
  VALID_FONTS,
  VALID_SHAPE_TYPES,
  VALID_ALIGNS,
  VALID_VISIBILITY,
};
