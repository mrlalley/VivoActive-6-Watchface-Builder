// Input validation for project exports and elements.

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

const SAFE_AREA_MIN = 10;
const SAFE_AREA_MAX = 380;

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

  // Position and size
  if (typeof el.x !== 'number' || el.x < SAFE_AREA_MIN || el.x > SAFE_AREA_MAX) {
    throw new Error(`element[${index}].x: must be between ${SAFE_AREA_MIN} and ${SAFE_AREA_MAX}, got ${el.x}`);
  }
  if (typeof el.y !== 'number' || el.y < SAFE_AREA_MIN || el.y > SAFE_AREA_MAX) {
    throw new Error(`element[${index}].y: must be between ${SAFE_AREA_MIN} and ${SAFE_AREA_MAX}, got ${el.y}`);
  }
  if (typeof el.width !== 'number' || el.width <= 0 || el.width > 400) {
    throw new Error(`element[${index}].width: must be a positive number ≤ 400, got ${el.width}`);
  }
  if (typeof el.height !== 'number' || el.height <= 0 || el.height > 400) {
    throw new Error(`element[${index}].height: must be a positive number ≤ 400, got ${el.height}`);
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
  SAFE_AREA_MIN,
  SAFE_AREA_MAX,
  validateProjectName,
  validateColor,
  validateElement,
  validateElements,
};
