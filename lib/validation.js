// Input validation for project exports and elements.

// Device geometry constants for Vivoactive 6 (390×390 round display)
const CANVAS_SIZE = 390;
const CANVAS_CENTER = 195;
const SAFE_AREA_INSET = 10;
const SAFE_AREA_RADIUS = 185; // (390 - 2*10) / 2

const VALID_FONTS = [
  'FONT_XTINY', 'FONT_TINY', 'FONT_SMALL', 'FONT_MEDIUM', 'FONT_LARGE',
  'FONT_NUMBER_MILD', 'FONT_NUMBER_MEDIUM', 'FONT_NUMBER_HOT', 'FONT_NUMBER_THAI_HOT',
];

const VALID_FIELD_IDS = new Set([
  'hours', 'minutes', 'seconds', 'amPm', 'dateFullDate', 'dateMonthDay', 'dateDay',
  'altTimeZone', 'alarm', 'sunrise', 'sunset', 'timeTillSunEvent', 'moonPhase',
  'moonPhasePercent', 'calendarEvent', 'analogHour', 'analogMinute', 'analogSecond',
  'analogCenter', 'hrGraph', 'heartRate', 'restingHeartRate', 'heartRateZone', 'spo2',
  'respirationRate', 'hrvStatus', 'bodyBattery', 'stressLevel', 'recoveryTime',
  'sleepScore', 'sleepCoach', 'trainingReadiness', 'steps', 'stepGoal', 'calories',
  'activeCalories', 'intensityMins', 'floorsClimbed', 'distance', 'vo2Max',
  'fitnessAge', 'acuteLoad', 'lastActivity', 'weeklyRunning', 'weeklyCycling',
  'weather', 'weatherHiLo', 'battery', 'bluetooth', 'notifications', 'eventCountdown',
  'timer', 'utcTime', 'customLabel', 'shapeCircle', 'shapeLine', 'shapeArc',
  'tickHour', 'tickMinute', 'tickMixed', 'tickDots',
]);

function validateProjectName(name) {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new Error('projectName must be a non-empty string');
  }
  if (name.length > 100) {
    throw new Error('projectName must be 100 characters or less');
  }
  return true;
}

function validateColor(color) {
  if (typeof color !== 'string') {
    throw new Error('color must be a string');
  }
  if (!/^#[0-9A-Fa-f]{6}$/.test(color)) {
    throw new Error(`invalid color format: ${color}. Expected #RRGGBB`);
  }
  return true;
}

/**
 * Check if an element's bounding box fits within the circular safe area.
 * The element is assumed to be positioned with (x, y) at its top-left corner.
 * All four corners of the bounding box must be within the safe circular boundary.
 *
 * @param {number} x - Element left edge (top-left x)
 * @param {number} y - Element top edge (top-left y)
 * @param {number} width - Element width
 * @param {number} height - Element height
 * @returns {boolean} True if element fits within safe circle, false otherwise
 */
function isWithinSafeCircle(x, y, width, height) {
  // Check all four corners of the bounding box
  const corners = [
    { px: x, py: y },                    // top-left
    { px: x + width, py: y },            // top-right
    { px: x, py: y + height },           // bottom-left
    { px: x + width, py: y + height },   // bottom-right
  ];

  for (const corner of corners) {
    const dx = corner.px - CANVAS_CENTER;
    const dy = corner.py - CANVAS_CENTER;
    const distFromCenter = Math.sqrt(dx * dx + dy * dy);

    if (distFromCenter > SAFE_AREA_RADIUS) {
      return false;
    }
  }

  return true;
}

function validateElement(el, index) {
  if (!el || typeof el !== 'object') {
    throw new Error(`element[${index}]: must be an object`);
  }

  // Required fields
  if (typeof el.id !== 'number' || el.id < 0) {
    throw new Error(`element[${index}].id: must be a non-negative number, got ${el.id}`);
  }
  if (!VALID_FIELD_IDS.has(el.fieldId)) {
    throw new Error(`element[${index}].fieldId: unknown field ID "${el.fieldId}"`);
  }
  if (typeof el.label !== 'string') {
    throw new Error(`element[${index}].label: must be a string`);
  }

  // Position and size: sanity checks (canvas bounds)
  if (typeof el.x !== 'number' || el.x < 0 || el.x > CANVAS_SIZE) {
    throw new Error(`element[${index}].x: must be between 0 and ${CANVAS_SIZE}, got ${el.x}`);
  }
  if (typeof el.y !== 'number' || el.y < 0 || el.y > CANVAS_SIZE) {
    throw new Error(`element[${index}].y: must be between 0 and ${CANVAS_SIZE}, got ${el.y}`);
  }
  if (typeof el.width !== 'number' || el.width <= 0 || el.width > CANVAS_SIZE) {
    throw new Error(`element[${index}].width: must be a positive number ≤ ${CANVAS_SIZE}, got ${el.width}`);
  }
  if (typeof el.height !== 'number' || el.height <= 0 || el.height > CANVAS_SIZE) {
    throw new Error(`element[${index}].height: must be a positive number ≤ ${CANVAS_SIZE}, got ${el.height}`);
  }

  // Circular boundary check: element bounding box must fit within the safe circular area
  if (!isWithinSafeCircle(el.x, el.y, el.width, el.height)) {
    throw new Error(`element[${index}]: extends outside the safe display area (circular boundary: radius ${SAFE_AREA_RADIUS}px from center)`);
  }

  // Font and color
  if (el.font && !VALID_FONTS.includes(el.font)) {
    throw new Error(`element[${index}].font: invalid font "${el.font}". Valid fonts: ${VALID_FONTS.join(', ')}`);
  }
  if (el.color) {
    validateColor(el.color);
  }

  // Visibility
  const validVisibility = ['always', 'awake', 'sleep'];
  if (el.visibility && !validVisibility.includes(el.visibility)) {
    throw new Error(`element[${index}].visibility: must be one of ${validVisibility.join(', ')}, got "${el.visibility}"`);
  }

  // zIndex
  if (typeof el.zIndex !== 'number' || el.zIndex < 0) {
    throw new Error(`element[${index}].zIndex: must be a non-negative number, got ${el.zIndex}`);
  }

  return true;
}

function validateElements(elements) {
  if (!Array.isArray(elements)) {
    throw new Error('elements must be an array');
  }
  if (elements.length > 200) {
    throw new Error('too many elements: max 200 allowed');
  }
  elements.forEach((el, i) => validateElement(el, i));
  return true;
}

module.exports = {
  VALID_FONTS,
  VALID_FIELD_IDS,
  CANVAS_SIZE,
  CANVAS_CENTER,
  SAFE_AREA_INSET,
  SAFE_AREA_RADIUS,
  validateProjectName,
  validateColor,
  validateElement,
  validateElements,
  isWithinSafeCircle,
};
