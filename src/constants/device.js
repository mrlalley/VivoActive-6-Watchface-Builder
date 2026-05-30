/**
 * @fileoverview Hardware and device-specific constants for the Garmin Vivoactive 6.
 * These values define the target watch face dimensions, safe drawing areas, and icon sizes.
 */

/** Vivoactive 6 AMOLED round display resolution (width and height in pixels). */
const CANVAS_SIZE = 390;

/** Center X coordinate of the canvas (CANVAS_SIZE / 2). */
const CANVAS_CENTER = CANVAS_SIZE / 2;

/** Pixel inset from the physical display edge to the safe drawing boundary. */
const SAFE_AREA_INSET = 10;

/** Diameter of the safe circular drawing area (CANVAS_SIZE - 2 * SAFE_AREA_INSET = 370 px). */
const SAFE_AREA_DIAMETER = CANVAS_SIZE - 2 * SAFE_AREA_INSET;

/** Radius of the safe circular drawing area (SAFE_AREA_DIAMETER / 2 = 185 px). */
const SAFE_AREA_RADIUS = SAFE_AREA_DIAMETER / 2;

/** Distance in pixels from the safe boundary edge at which a proximity warning highlight appears. */
const EDGE_WARN_DISTANCE = 20;

/** Minimum size (width or height) for any draggable element on the canvas in pixels. */
const MIN_ELEMENT_SIZE = 20;

/** Maximum number of elements allowed in a single watch face design. */
const MAX_DESIGN_ELEMENTS = 200;

/** Launcher icon size required by the Garmin Connect IQ manifest (54×54 pixels). */
const LAUNCHER_ICON_SIZE = 54;

/** Target Connect IQ API level for Vivoactive 6 compatibility. */
const TARGET_API_LEVEL = '6.0';

/** Minimum Connect IQ API level (SDK requirement). */
const MIN_API_LEVEL = '4.2.0';

/** Device ID string used in monkeyc build commands for Vivoactive 6. */
const DEVICE_ID = 'vivoactive6';

module.exports = {
  CANVAS_SIZE,
  CANVAS_CENTER,
  SAFE_AREA_INSET,
  SAFE_AREA_DIAMETER,
  SAFE_AREA_RADIUS,
  EDGE_WARN_DISTANCE,
  MIN_ELEMENT_SIZE,
  MAX_DESIGN_ELEMENTS,
  LAUNCHER_ICON_SIZE,
  TARGET_API_LEVEL,
  MIN_API_LEVEL,
  DEVICE_ID,
};
