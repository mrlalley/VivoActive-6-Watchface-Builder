#!/usr/bin/env node
// scripts/generate-constants.js
//
// Generates builder/constants.js from src/constants/device.js.
// Run via: npm run generate-constants
// Runs automatically before npm start / npm run server / npm run build.
//
// Device constants are read directly from the Node.js source-of-truth module
// so algebraic relationships (e.g. SAFE_AREA_RADIUS = CANVAS_SIZE * 0.9...)
// are always re-evaluated rather than copy-pasted as stale literals.
//
// UI and timing constants that have no server-side equivalent are defined
// statically in this script and written verbatim to the output.

'use strict';

const path = require('path');
const fs   = require('fs');

const DEVICE_SRC = path.resolve(__dirname, '../src/constants/device.js');
const OUTPUT     = path.resolve(__dirname, '../builder/constants.js');

// ── Load device constants from source of truth ────────────────────────────────
const device = require(DEVICE_SRC);

function fmt(v) {
  return typeof v === 'string' ? `'${v}'` : String(v);
}

// Build the device-constants block from the live module values.
// Each value is re-evaluated from src/constants/device.js at generation time,
// so changing CANVAS_SIZE there propagates automatically via npm run generate-constants.
const deviceBlock = [
  `export const CANVAS_SIZE          = ${fmt(device.CANVAS_SIZE)};`,
  `export const CANVAS_CENTER        = ${fmt(device.CANVAS_CENTER)};`,
  `export const SAFE_AREA_INSET      = ${fmt(device.SAFE_AREA_INSET)};`,
  `export const SAFE_AREA_DIAMETER   = ${fmt(device.SAFE_AREA_DIAMETER)};`,
  `export const SAFE_AREA_RADIUS     = ${fmt(device.SAFE_AREA_RADIUS)};`,
  `export const EDGE_WARN_DISTANCE   = ${fmt(device.EDGE_WARN_DISTANCE)};`,
  `export const MIN_ELEMENT_SIZE     = ${fmt(device.MIN_ELEMENT_SIZE)};`,
  `export const MAX_DESIGN_ELEMENTS  = ${fmt(device.MAX_DESIGN_ELEMENTS)};`,
  `export const LAUNCHER_ICON_SIZE   = ${fmt(device.LAUNCHER_ICON_SIZE)};`,
  `export const TARGET_API_LEVEL     = ${fmt(device.TARGET_API_LEVEL)};`,
  `export const MIN_API_LEVEL        = ${fmt(device.MIN_API_LEVEL)};`,
  `export const DEVICE_ID            = ${fmt(device.DEVICE_ID)};`,
].join('\n');

// ── UI and timing constants (browser-only, no server-side equivalent) ─────────
// These are maintained here rather than in src/constants/device.js because they
// are purely presentation/timing values with no bearing on server-side validation.
const staticBlock = `\
// Grid display options
export const GRID_SPACING_OPTIONS              = [20, 10, 5];
export const GRID_LEVEL_1_MINOR               = 20;
export const GRID_LEVEL_1_MAJOR               = 100;
export const GRID_LEVEL_2_MINOR               = 10;
export const GRID_LEVEL_2_MAJOR               = 50;
export const GRID_LEVEL_3_MINOR               = 5;
export const GRID_LEVEL_3_MAJOR               = 25;
export const GRID_MINOR_ALPHA                 = 0.18;
export const GRID_MAJOR_ALPHA                 = 0.40;
export const DEFAULT_ELEMENT_X                = ${fmt(device.CANVAS_CENTER)};
export const DEFAULT_ELEMENT_Y                = ${fmt(device.CANVAS_CENTER)};

// Timing (ms)
export const ANALOG_RENDER_INTERVAL           = 1000;
export const SAVE_INDICATOR_HIDE_DELAY        = 2000;
export const BUILD_TIMEOUT_MS                 = 60000;
export const PREVIEW_TIMEOUT_MS               = 30000;
export const KEYGEN_TIMEOUT_MS                = 60000;
export const APP_RESTART_DELAY_MS             = 100;
export const HEALTH_CHECK_DELAY_MS            = 8000;
export const SIMULATOR_POLL_INITIAL_DELAY_MS  = 500;
export const SIMULATOR_POLL_MAX_DELAY_MS      = 3000;
export const SIMULATOR_STARTUP_DEADLINE_MS    = 20000;`;

// ── Write output ──────────────────────────────────────────────────────────────
const header = `\
// !! GENERATED FILE — DO NOT EDIT MANUALLY !!
// Source: src/constants/device.js
// Regenerate: npm run generate-constants
// Generated: ${new Date().toISOString()}
//
// Browser-compatible ES module mirror of src/constants/device.js.
// Device constants are evaluated from the source file at generation time,
// so algebraic relationships are preserved and stale literals are impossible.

`;

const output = header + '// Device constants (from src/constants/device.js)\n' + deviceBlock
  + '\n\n' + staticBlock + '\n';

fs.writeFileSync(OUTPUT, output, 'utf8');
console.log(`✓ builder/constants.js generated from src/constants/device.js`);
console.log(`  CANVAS_SIZE=${device.CANVAS_SIZE}  SAFE_AREA_RADIUS=${device.SAFE_AREA_RADIUS}  DEVICE_ID=${device.DEVICE_ID}`);
