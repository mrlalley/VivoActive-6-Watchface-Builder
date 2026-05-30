/**
 * @fileoverview UI, grid, and layout-related constants for the builder interface.
 */

/** Grid spacing options (in pixels) for alignment guides. Level 0 = off, 1 = 20px, 2 = 10px, 3 = 5px. */
const GRID_SPACING_OPTIONS = [20, 10, 5];

/** Minor grid line spacing (pixels) for grid level 1. */
const GRID_LEVEL_1_MINOR = 20;

/** Major grid line spacing (pixels) for grid level 1 (minor × 5). */
const GRID_LEVEL_1_MAJOR = 100;

/** Minor grid line spacing (pixels) for grid level 2. */
const GRID_LEVEL_2_MINOR = 10;

/** Major grid line spacing (pixels) for grid level 2 (minor × 5). */
const GRID_LEVEL_2_MAJOR = 50;

/** Minor grid line spacing (pixels) for grid level 3. */
const GRID_LEVEL_3_MINOR = 5;

/** Major grid line spacing (pixels) for grid level 3 (minor × 5). */
const GRID_LEVEL_3_MAJOR = 25;

/** Alpha (opacity) value for minor grid lines (0.0–1.0). */
const GRID_MINOR_ALPHA = 0.18;

/** Alpha (opacity) value for major grid lines (0.0–1.0). */
const GRID_MAJOR_ALPHA = 0.40;

/** Default X coordinate (in pixels) for newly added elements (canvas center). */
const DEFAULT_ELEMENT_X = 195;

/** Default Y coordinate (in pixels) for newly added elements (canvas center). */
const DEFAULT_ELEMENT_Y = 195;

module.exports = {
  GRID_SPACING_OPTIONS,
  GRID_LEVEL_1_MINOR,
  GRID_LEVEL_1_MAJOR,
  GRID_LEVEL_2_MINOR,
  GRID_LEVEL_2_MAJOR,
  GRID_LEVEL_3_MINOR,
  GRID_LEVEL_3_MAJOR,
  GRID_MINOR_ALPHA,
  GRID_MAJOR_ALPHA,
  DEFAULT_ELEMENT_X,
  DEFAULT_ELEMENT_Y,
};
