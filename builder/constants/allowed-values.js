// Renderer-side validation allowlist (mirrors lib/allowed-values.js)
// KEEP IN SYNC with lib/allowed-values.js
// These are used for client-side validation only.
// Server-side validation is authoritative (lib/validation.js).

export const VALID_FONTS = Object.freeze([
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

export const VALID_SHAPE_TYPES = Object.freeze([
  'circle',
  'line',
  'arc',
  'tickHour',
  'tickMinute',
  'tickMixed',
  'tickDots',
  'analogHour',
  'analogMinute',
  'analogSecond',
  'analogCenter',
  'btIcon',
  'moonPhase',
  'hrGraph',
]);

export const VALID_ALIGNS = Object.freeze([
  'left',
  'center',
  'right',
]);

export const VALID_VISIBILITY = Object.freeze([
  'always',
  'awake',
  'sleep',
]);
