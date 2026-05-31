// Client-side safe-area validation for the canvas editor.
// Source of truth for geometry constants: builder/constants.js (generated from src/constants/device.js).
// (x, y) is always the element CENTER, matching the canvas.js rendering convention.

import { CANVAS_CENTER, SAFE_AREA_RADIUS } from '../constants.js';

/**
 * @typedef {Object} ValidationResult
 * @property {boolean}   valid      - true when all elements are within the safe circle
 * @property {Set<number>} invalidIds - IDs of elements that extend outside the boundary
 * @property {string[]}  errors     - human-readable description per violation
 */

/**
 * Check whether one element's bounding box fits inside the safe circular display area.
 * All four corners of the axis-aligned bounding box must be within SAFE_AREA_RADIUS of
 * the canvas centre.
 *
 * @param {number} cx     - element centre X
 * @param {number} cy     - element centre Y
 * @param {number} width  - element width  (default 0 → treat as a point)
 * @param {number} height - element height (default 0 → treat as a point)
 * @returns {boolean}
 */
export function isWithinSafeCircle(cx, cy, width = 0, height = 0) {
  const halfW = (width  || 0) / 2;
  const halfH = (height || 0) / 2;
  // Four corners of the axis-aligned bounding box
  const corners = [
    [cx - halfW, cy - halfH],
    [cx + halfW, cy - halfH],
    [cx - halfW, cy + halfH],
    [cx + halfW, cy + halfH],
  ];
  return corners.every(([x, y]) => {
    const dx = x - CANVAS_CENTER;
    const dy = y - CANVAS_CENTER;
    return Math.sqrt(dx * dx + dy * dy) <= SAFE_AREA_RADIUS;
  });
}

/**
 * Validate every element in the design against the safe circular area.
 * Tick rings and analog hands are excluded — they are centred at the canvas
 * centre by design and their "width" is a radius, not a bounding-box half-width.
 *
 * @param {import('./elements.js').Element[]} elements
 * @returns {ValidationResult}
 */
export function validateElements(elements) {
  const SKIP_SHAPE_TYPES = new Set([
    'tickHour', 'tickMinute', 'tickMixed', 'tickDots',
    'analogHour', 'analogMinute', 'analogSecond', 'analogCenter',
  ]);

  const invalidIds = new Set();
  const errors     = [];

  for (const el of elements) {
    // Skip shape types whose width/height don't describe a rectangular bounding box
    if (el.shapeType && SKIP_SHAPE_TYPES.has(el.shapeType)) continue;

    if (!isWithinSafeCircle(el.x, el.y, el.width, el.height)) {
      invalidIds.add(el.id);
      errors.push(
        `"${el.label || el.fieldId}" at (${Math.round(el.x)}, ${Math.round(el.y)}) extends outside the safe display area.`
      );
    }
  }

  return { valid: invalidIds.size === 0, invalidIds, errors };
}
