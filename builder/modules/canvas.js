import { getElements, updateElement, commitHistory, FONT_HEIGHTS } from './elements.js';
import { CANVAS_SIZE, CANVAS_CENTER, SAFE_AREA_RADIUS as SAFE_RADIUS, EDGE_WARN_DISTANCE as EDGE_WARN_DIST, MIN_ELEMENT_SIZE, ANALOG_RENDER_INTERVAL } from '../constants.js';
import { validateElements } from './validation.js';

/**
 * @typedef {Object} Element
 * @property {number} id - Unique element identifier
 * @property {string} fieldId - Data field binding (e.g., 'time', 'heartRate', 'battery')
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
 * @property {number} zIndex - Layer order (higher = on top)
 * @property {string|null} shapeType - Shape type for shape elements: 'analogHour'|'analogMinute'|'analogSecond'|'analogCenter'|'tickHour'|'tickMinute'|'tickMixed'|'tickDots'|'circle'|'rectangle'|'ring'|'hrGraph' or null for text
 * @property {string} preview - Preview text for editing
 */

export { CANVAS_SIZE }; // Re-export for backward compatibility

// CSS font-size in pixels for each Garmin font, calibrated to the exact TTF metrics.
// Number fonts use Yantramanav-Regular; system fonts use Roboto-Regular.
// Values derived from simulator.json: digitHeight / cap-height-ratio for each typeface.
//   Yantramanav cap-height ratio ≈ 0.72  →  CSS = digitHeight / 0.72
//   Roboto cap-height ratio      ≈ 0.74  →  CSS = ascent      / 0.74
const FONT_CSS = {
  FONT_XTINY:             14,   // Roboto  ascent≈10  / 0.74
  FONT_TINY:              17,   // Roboto  ascent≈13  / 0.74
  FONT_SMALL:             49,   // Roboto  ascent=36  / 0.74
  FONT_MEDIUM:            57,   // Roboto  ascent=42  / 0.74
  FONT_LARGE:             65,   // Roboto  ascent=48  / 0.74
  FONT_NUMBER_MILD:       68,   // Yantra  digitHeight=49 / 0.72
  FONT_NUMBER_MEDIUM:     91,   // Yantra  digitHeight≈65 / 0.72
  FONT_NUMBER_HOT:       104,   // Yantra  digitHeight=75 / 0.72
  FONT_NUMBER_THAI_HOT:  126,   // Yantra  digitHeight=91 / 0.72
};

// Which CSS font-family to use per font type
const FONT_FACE = {
  FONT_XTINY: 'GarminSystem', FONT_TINY: 'GarminSystem', FONT_SMALL: 'GarminSystem',
  FONT_MEDIUM: 'GarminSystem', FONT_LARGE: 'GarminSystem',
  FONT_NUMBER_MILD: 'GarminNumber', FONT_NUMBER_MEDIUM: 'GarminNumber',
  FONT_NUMBER_HOT: 'GarminNumber', FONT_NUMBER_THAI_HOT: 'GarminNumber',
};

let canvas, ctx;
let selectedId = null;
let showSafeArea = true;
let gridLevel = 0; // 0 = off, 1 = 20px, 2 = 10px, 3 = 5px
let dragState = null;
let onSelectCb = null;
let onChangeCb = null;
let analogRenderTimer = null; // Adaptive analog rendering timer

// ─── Reactive safe-area validation ───────────────────────────────────────────
// Updated after every element commit (drag, resize, add, property change, undo).
// Drives the red outline overlay and the export/preview button state.
let lastValidationResult = { valid: true, invalidIds: new Set(), errors: [] };

/**
 * Run safe-area validation over all current elements and update button state.
 * Call this after every commit that may change element positions or sizes.
 * Do NOT call during drag mousemove — call only on mouseup (commit).
 */
/** @returns {import('./validation.js').ValidationResult} */
export function runValidation() {
  lastValidationResult = validateElements(getElements());
  emitValidationState(lastValidationResult);
  scheduleRedraw(); // repaint so invalid outlines appear / disappear immediately
  return lastValidationResult;
}

/**
 * Update the Export and Preview toolbar buttons based on validation state.
 * Buttons are disabled (with an explanatory tooltip) when any element is out of bounds.
 * @param {import('./validation.js').ValidationResult} result
 */
function emitValidationState(result) {
  const exportBtn  = document.getElementById('btn-export');
  const previewBtn = document.getElementById('btn-preview');
  if (!exportBtn || !previewBtn) return;

  if (result.valid) {
    exportBtn.disabled  = false;
    previewBtn.disabled = false;
    exportBtn.title  = '';
    previewBtn.title = '';
  } else {
    const n = result.invalidIds.size;
    const summary = `${n} element${n === 1 ? '' : 's'} outside the safe display area — move ${n === 1 ? 'it' : 'them'} in to enable`;
    exportBtn.disabled  = true;
    previewBtn.disabled = true;
    exportBtn.title  = summary;
    previewBtn.title = summary;
  }
}

// ─── RAF-based render batching ────────────────────────────────────────────────
// Deduplicates rapid render() calls (drag, color picker, etc.) so at most one
// full canvas repaint happens per animation frame (~16 ms).
let redrawScheduled = false;

function scheduleRedraw() {
  if (redrawScheduled) return;
  redrawScheduled = true;
  requestAnimationFrame(() => {
    render();
    redrawScheduled = false;
  });
}

export const ANALOG_SHAPES = new Set(['analogHour', 'analogMinute', 'analogSecond', 'analogCenter']);
function isAnalogShape(el) { return el.shapeType && ANALOG_SHAPES.has(el.shapeType); }

function hasAnalogElements() {
  return getElements().some(e => ANALOG_SHAPES.has(e.shapeType));
}

function scheduleAnalogRender() {
  // Clear any existing timer to prevent duplicates
  if (analogRenderTimer) {
    clearTimeout(analogRenderTimer);
    analogRenderTimer = null;
  }

  // Only render if analog elements exist
  if (hasAnalogElements()) {
    render();
    analogRenderTimer = setTimeout(scheduleAnalogRender, ANALOG_RENDER_INTERVAL);
  }
}

export function initCanvas(canvasEl, onSelect, onChange) {
  canvas = canvasEl;
  ctx = canvas.getContext('2d');
  onSelectCb = onSelect;

  // Wrap onChange to detect when analog elements are added/removed
  onChangeCb = (elements) => {
    if (onChange) onChange(elements);
    scheduleAnalogRender(); // Restart render loop based on current elements
  };

  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseup',   onMouseUp);
  canvas.addEventListener('mouseleave', onMouseUp);

  // Start adaptive analog rendering (only if analog elements exist)
  scheduleAnalogRender();
}

export function render() {
  if (!ctx) return;
  ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  // Circular clip for all element drawing
  ctx.save();
  ctx.beginPath();
  ctx.arc(CANVAS_CENTER, CANVAS_CENTER, CANVAS_CENTER, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  if (gridLevel > 0) drawGrid(gridLevel);

  const sorted = getElements().slice().sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
  sorted.forEach(drawElement);
  ctx.restore();

  // Safe-area guide (drawn outside clip so it overlays the round edge)
  if (showSafeArea) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(CANVAS_CENTER, CANVAS_CENTER, SAFE_RADIUS, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,80,80,0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // Selection handles drawn last, always on top
  if (selectedId) {
    const el = getElements().find(e => e.id === selectedId);
    if (el) drawHandles(el);
  }
}

export const TICK_TYPES = new Set(['tickHour', 'tickMinute', 'tickMixed', 'tickDots']);
function isTickShape(el) { return el.shapeType && TICK_TYPES.has(el.shapeType); }

// ─── Element drawing ──────────────────────────────────────────────────────────

function drawElement(el) {
  ctx.save();
  const color = el.color || '#FFFFFF';

  if (el.shapeType === 'circle') {
    ctx.beginPath();
    ctx.arc(el.x, el.y, Math.max(4, Math.min(el.width, el.height) / 2), 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
  } else if (el.shapeType === 'line') {
    ctx.beginPath();
    ctx.moveTo(el.x - el.width / 2, el.y);
    ctx.lineTo(el.x + el.width / 2, el.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
  } else if (el.shapeType === 'arc') {
    ctx.beginPath();
    ctx.arc(el.x, el.y, Math.max(4, Math.min(el.width, el.height) / 2), 0, Math.PI);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
  } else if (el.shapeType === 'tickHour') {
    drawTickLines(el, 12, 0, el.height, el.height, 2.5);
  } else if (el.shapeType === 'tickMinute') {
    drawTickLines(el, 60, 0, el.height, el.height, 1);
  } else if (el.shapeType === 'tickMixed') {
    drawTickLines(el, 60, 5, el.height, Math.max(2, Math.round(el.height * 0.45)), 1.5);
  } else if (el.shapeType === 'tickDots') {
    drawTickDots(el, 12, el.height);
  } else if (el.shapeType === 'analogHour' || el.shapeType === 'analogMinute' || el.shapeType === 'analogSecond') {
    drawAnalogHand(el);
  } else if (el.shapeType === 'analogCenter') {
    ctx.fillStyle = el.color || '#FFFFFF';
    ctx.beginPath();
    ctx.arc(el.x, el.y, Math.max(2, el.width), 0, Math.PI * 2);
    ctx.fill();
  } else if (el.shapeType === 'btIcon') {
    const r = Math.max(4, Math.min(el.width, el.height) / 2);
    // Always lit in canvas preview (BT state unknown in builder)
    ctx.fillStyle = el.color || '#0077FF';
    ctx.beginPath();
    ctx.arc(el.x, el.y, r, 0, Math.PI * 2);
    ctx.fill();
    // Bluetooth ᛒ glyph centred on the dot
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `bold ${Math.round(r * 1.3)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ᛒ', el.x, el.y);   // ᛒ (RUNIC LETTER BERKANAN BEORC BJARKAN B)
  } else if (el.shapeType === 'moonPhase') {
    // Draw moon phase graphic: full circle + shadow showing phase
    const r = Math.max(8, Math.min(el.width, el.height) / 2);
    // Calculate phase fraction (0=new, 0.5=full, 1=new) — use Jan 6, 2000 as reference
    const now = new Date();
    const jd = 2440587.5 + now.getTime() / 86400000;
    let phs = ((jd - 2451549.5) / 29.530589) % 1.0;
    phs = 1.0 - phs;  // Invert phase (reference date fix)

    // Draw lit (bright) part of moon
    ctx.fillStyle = el.color || '#DDDDFF';
    ctx.beginPath();
    ctx.arc(el.x, el.y, r, 0, Math.PI * 2);
    ctx.fill();

    // Draw shadow (dark part) based on phase
    // phs < 0.5 = waning (shadow on right); phs >= 0.5 = waxing (shadow on left)
    ctx.fillStyle = '#1a1a1a'; // match canvas background
    if (phs < 0.5) {
      // Waning: shadow slides from left to right as phase decreases from 0.5 to 0
      const shadowX = el.x + r * (1.0 - 2.0 * phs);
      ctx.beginPath();
      ctx.arc(shadowX, el.y, r, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Waxing: shadow slides from right to left as phase increases from 0.5 to 1
      const shadowX = el.x - r * (2.0 * phs - 1.0);
      ctx.beginPath();
      ctx.arc(shadowX, el.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (el.shapeType === 'hrGraph') {
    drawHRGraph(el);
  } else {
    const fontSize  = FONT_CSS[el.font]  || 57;
    const fontFace  = FONT_FACE[el.font] || 'GarminSystem';
    ctx.font = `${fontSize}px '${fontFace}', sans-serif`;
    ctx.fillStyle = color;
    ctx.textAlign    = el.align === 'right' ? 'right' : el.align === 'left' ? 'left' : 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(el.preview !== undefined ? el.preview : el.label, el.x, el.y);
  }

  // Safe-area proximity warning (skip for tick rings, analog hands, and small icons)
  if (!isTickShape(el) && !isAnalogShape(el) && el.shapeType !== 'hrGraph' && el.shapeType !== 'btIcon' && el.shapeType !== 'moonPhase') {
    const dist = Math.hypot(el.x - CANVAS_CENTER, el.y - CANVAS_CENTER);
    if (dist > SAFE_RADIUS - EDGE_WARN_DIST) {
      ctx.beginPath();
      ctx.arc(el.x, el.y, Math.max(el.width, el.height) / 2 + 5, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,50,50,0.6)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // Out-of-bounds indicator: solid red dashed rectangle when element is fully outside safe area.
  // Only drawn for elements whose width/height represent a rectangular bounding box.
  if (lastValidationResult.invalidIds.has(el.id)) {
    const hw = el.width  / 2;
    const hh = el.height / 2;
    ctx.strokeStyle = '#FF3333';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(el.x - hw, el.y - hh, el.width, el.height);
    ctx.setLineDash([]);
  }

  ctx.restore();
}

// ─── Grid ─────────────────────────────────────────────────────────────────────
//  Level 1 — 20 px minor / 100 px major
//  Level 2 — 10 px minor /  50 px major  (2× denser)
//  Level 3 —  5 px minor /  25 px major  (4× denser)

function drawGrid(level) {
  const configs = [
    null,
    { minor: 20, major: 100, minorAlpha: 0.18, majorAlpha: 0.40 },
    { minor: 10, major:  50, minorAlpha: 0.13, majorAlpha: 0.32 },
    { minor:  5, major:  25, minorAlpha: 0.10, majorAlpha: 0.26 },
  ];
  const { minor, major, minorAlpha, majorAlpha } = configs[level];

  function lines(step, alpha) {
    ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= CANVAS_SIZE; x += step) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CANVAS_SIZE); ctx.stroke();
    }
    for (let y = 0; y <= CANVAS_SIZE; y += step) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CANVAS_SIZE, y); ctx.stroke();
    }
  }

  lines(minor, minorAlpha);
  lines(major, majorAlpha);

  // Center crosshair — same at all levels
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 5]);
  ctx.beginPath();
  ctx.moveTo(CANVAS_CENTER, 0); ctx.lineTo(CANVAS_CENTER, CANVAS_SIZE);
  ctx.moveTo(0, CANVAS_CENTER); ctx.lineTo(CANVAS_SIZE, CANVAS_CENTER);
  ctx.stroke();
  ctx.setLineDash([]);

  // Center dot
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.beginPath();
  ctx.arc(CANVAS_CENTER, CANVAS_CENTER, 2.5, 0, Math.PI * 2);
  ctx.fill();
}

// ─── Tick mark renderers ──────────────────────────────────────────────────────

// outerRadius = el.width, majorLen = el.height
// majorEvery: every Nth tick is a major tick (0 = all same size)
function drawTickLines(el, count, majorEvery, majorLen, minorLen, baseWidth) {
  const outerR = el.width;
  ctx.strokeStyle = el.color || '#FFFFFF';
  ctx.lineCap = 'butt';
  for (let i = 0; i < count; i++) {
    const isMajor = majorEvery > 0 && (i % majorEvery === 0);
    const len = isMajor ? majorLen : minorLen;
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    ctx.lineWidth = isMajor ? baseWidth * 1.8 : baseWidth;
    ctx.beginPath();
    ctx.moveTo(el.x + (outerR - len) * cos, el.y + (outerR - len) * sin);
    ctx.lineTo(el.x + outerR * cos,          el.y + outerR * sin);
    ctx.stroke();
  }
}

function drawTickDots(el, count, dotR) {
  const outerR = el.width;
  ctx.fillStyle = el.color || '#FFFFFF';
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
    ctx.beginPath();
    ctx.arc(
      el.x + outerR * Math.cos(angle),
      el.y + outerR * Math.sin(angle),
      Math.max(1, dotR), 0, Math.PI * 2,
    );
    ctx.fill();
  }
}

// ─── Analog hand renderer ─────────────────────────────────────────────────────

function handAngle(type) {
  const now = new Date();
  const h = now.getHours() % 12, m = now.getMinutes(), s = now.getSeconds();
  if (type === 'analogHour')   return (h / 12  + m / 720)  * Math.PI * 2 - Math.PI / 2;
  if (type === 'analogMinute') return (m / 60  + s / 3600) * Math.PI * 2 - Math.PI / 2;
                               return (s / 60)              * Math.PI * 2 - Math.PI / 2;
}

function drawAnalogHand(el) {
  const angle = handAngle(el.shapeType);
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const sw = el.shapeType === 'analogHour' ? 5 : el.shapeType === 'analogMinute' ? 3.5 : 1.5;

  ctx.strokeStyle = el.color || '#FFFFFF';
  ctx.lineWidth = sw;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(el.x - el.height * cos, el.y - el.height * sin);
  ctx.lineTo(el.x + el.width  * cos, el.y + el.width  * sin);
  ctx.stroke();
}

// ─── Heart rate graph renderer ────────────────────────────────────────────────

// Stable sample data so the graph doesn't flicker on re-render
const HR_SAMPLE = (() => {
  const pts = 32; const data = []; let v = 70;
  for (let i = 0; i < pts; i++) {
    v += Math.sin(i * 0.9) * 6 + Math.cos(i * 1.7) * 4;
    v = Math.max(52, Math.min(98, v));
    data.push(v);
  }
  return data;
})();

function drawHRGraph(el) {
  const gx = el.x - el.width / 2, gy = el.y - el.height / 2;
  const gw = el.width,             gh = el.height;
  const minV = 50, maxV = 100;

  // Subtle background
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(gx, gy, gw, gh);

  // Mid-line guide
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 0.5;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(gx, gy + gh / 2); ctx.lineTo(gx + gw, gy + gh / 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // HR line
  ctx.strokeStyle = el.color || '#FF4444';
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  HR_SAMPLE.forEach((v, i) => {
    const px = gx + (i / (HR_SAMPLE.length - 1)) * gw;
    const py = gy + gh - ((v - minV) / (maxV - minV)) * gh;
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  });
  ctx.stroke();
}

// ─── Selection handles ────────────────────────────────────────────────────────

function drawHandles(el) {
  ctx.save();

  if (isTickShape(el)) {
    // For tick rings: show a dashed circle at outerRadius + a small center crosshair
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.arc(el.x, el.y, el.width, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    // Center crosshair
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1;
    const s = 6;
    ctx.beginPath();
    ctx.moveTo(el.x - s, el.y); ctx.lineTo(el.x + s, el.y);
    ctx.moveTo(el.x, el.y - s); ctx.lineTo(el.x, el.y + s);
    ctx.stroke();
    // Radius handle at top (drag to resize outer radius)
    const hy = el.y - el.width;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(el.x - 4, hy - 4, 8, 8);
  } else if (isAnalogShape(el)) {
    // Small dashed circle at pivot point
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(el.x, el.y, 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    const hw = el.width / 2, hh = el.height / 2;
    const l = el.x - hw, r = el.x + hw, t = el.y - hh, b = el.y + hh;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(l, t, el.width, el.height);
    ctx.setLineDash([]);
    ctx.fillStyle = '#FFFFFF';
    [[l, t], [r, t], [l, b], [r, b]].forEach(([hx, hy]) => {
      ctx.fillRect(hx - 4, hy - 4, 8, 8);
    });
  }

  ctx.restore();
}

// ─── Hit testing ──────────────────────────────────────────────────────────────

function elementAt(mx, my) {
  // Top z-index first
  const sorted = getElements().slice().sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0));
  for (const el of sorted) {
    if (isAnalogShape(el)) {
      // Analog hands: click within 14px of pivot to select
      if (Math.hypot(mx - el.x, my - el.y) <= 14) return el;
    } else if (isTickShape(el)) {
      const distCenter = Math.hypot(mx - el.x, my - el.y);
      const distRing   = Math.abs(distCenter - el.width);
      if (distCenter <= 14 || distRing <= Math.max(el.height, 6)) return el;
    } else {
      if (mx >= el.x - el.width / 2 && mx <= el.x + el.width / 2 &&
          my >= el.y - el.height / 2 && my <= el.y + el.height / 2) {
        return el;
      }
    }
  }
  return null;
}

function handleAt(mx, my, el) {
  if (!el) return null;
  if (isAnalogShape(el)) return null; // analog hands resized via property panel only
  if (isTickShape(el)) {
    // Only one resize handle: the square at top of the ring
    const hy = el.y - el.width;
    if (Math.abs(mx - el.x) <= 7 && Math.abs(my - hy) <= 7) return { pos: 'tick-radius' };
    return null;
  }
  const hw = el.width / 2, hh = el.height / 2;
  const corners = [
    { pos: 'tl', hx: el.x - hw, hy: el.y - hh },
    { pos: 'tr', hx: el.x + hw, hy: el.y - hh },
    { pos: 'bl', hx: el.x - hw, hy: el.y + hh },
    { pos: 'br', hx: el.x + hw, hy: el.y + hh },
  ];
  return corners.find(c => Math.abs(mx - c.hx) <= 7 && Math.abs(my - c.hy) <= 7) || null;
}

// ─── Mouse handlers ───────────────────────────────────────────────────────────

function onMouseDown(e) {
  const { mx, my } = mousePos(e);
  const selEl = selectedId ? getElements().find(el => el.id === selectedId) : null;
  const corner = handleAt(mx, my, selEl);

  if (corner) {
    dragState = { type: 'resize', corner: corner.pos, startX: mx, startY: my, orig: { ...selEl } };
    return;
  }

  const hit = elementAt(mx, my);
  if (hit) {
    selectedId = hit.id;
    onSelectCb && onSelectCb(hit);
    dragState = { type: 'move', startX: mx, startY: my, orig: { ...hit } };
  } else {
    selectedId = null;
    onSelectCb && onSelectCb(null);
    dragState = null;
  }
  scheduleRedraw();
}

function onMouseMove(e) {
  if (!dragState) return;
  const { mx, my } = mousePos(e);
  const el = getElements().find(el => el.id === selectedId);
  if (!el) return;

  const dx = mx - dragState.startX;
  const dy = my - dragState.startY;
  const orig = dragState.orig;

  if (dragState.type === 'move') {
    const clamped = isTickShape(el)
      ? { x: orig.x + dx, y: orig.y + dy }  // tick center moves freely
      : clamp(orig.x + dx, orig.y + dy, el.width, el.height);
    updateElement(el.id, clamped);
  } else if (dragState.corner === 'tick-radius') {
    // Dragging the top handle changes outer radius
    const newRadius = Math.max(MIN_ELEMENT_SIZE, Math.min(CANVAS_CENTER, orig.width - dy));
    updateElement(el.id, { width: Math.round(newRadius) });
  } else {
    let { x, y, width, height } = orig;
    const c = dragState.corner;
    if (c === 'br') { width  = Math.max(20, orig.width  + dx); height = Math.max(20, orig.height + dy); }
    if (c === 'bl') { width  = Math.max(20, orig.width  - dx); x = orig.x + (orig.width - width); height = Math.max(20, orig.height + dy); }
    if (c === 'tr') { width  = Math.max(20, orig.width  + dx); height = Math.max(20, orig.height - dy); y = orig.y + (orig.height - height); }
    if (c === 'tl') { width  = Math.max(20, orig.width  - dx); x = orig.x + (orig.width - width); height = Math.max(20, orig.height - dy); y = orig.y + (orig.height - height); }
    updateElement(el.id, { x, y, width, height });
  }

  dragState.moved = true;
  scheduleRedraw();
  onChangeCb && onChangeCb(getElements().find(e => e.id === selectedId));
}

function onMouseUp() {
  if (dragState?.moved) {
    commitHistory();
    runValidation(); // recheck safe-area after position/size commit
  }
  dragState = null;
}

// ─── Safe-area clamping ───────────────────────────────────────────────────────

function clamp(x, y, width, height) {
  const margin = Math.max(width, height) / 2;
  const dist = Math.hypot(x - CANVAS_CENTER, y - CANVAS_CENTER);
  const limit = SAFE_RADIUS - margin;
  if (dist <= limit || limit <= 0) return { x, y };
  const angle = Math.atan2(y - CANVAS_CENTER, x - CANVAS_CENTER);
  return {
    x: CANVAS_CENTER + Math.cos(angle) * limit,
    y: CANVAS_CENTER + Math.sin(angle) * limit,
  };
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function mousePos(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    mx: (e.clientX - rect.left) * (CANVAS_SIZE / rect.width),
    my: (e.clientY - rect.top)  * (CANVAS_SIZE / rect.height),
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function setSelectedId(id) { selectedId = id; scheduleRedraw(); }
export function getSelectedId() { return selectedId; }
export { scheduleRedraw };

export function cleanupCanvas() {
  // Stop the adaptive render loop when canvas is destroyed or re-initialized
  if (analogRenderTimer) {
    clearTimeout(analogRenderTimer);
    analogRenderTimer = null;
  }
}

export function toggleSafeArea() {
  showSafeArea = !showSafeArea;
  const btn = document.getElementById('btn-safe-area');
  btn && btn.classList.toggle('active', showSafeArea);
  scheduleRedraw();
}

export function toggleGrid() {
  gridLevel = (gridLevel + 1) % 4;   // 0 → 1 → 2 → 3 → 0
  const btn = document.getElementById('btn-grid');
  if (btn) {
    btn.textContent = gridLevel === 0 ? 'Grid' : `Grid ${gridLevel}`;
    btn.classList.toggle('active', gridLevel > 0);
  }
  scheduleRedraw();
}

export function bringForward() {
  if (!selectedId) return;
  const els = getElements();
  const el  = els.find(e => e.id === selectedId);
  if (!el) return;
  const above = els.filter(e => e.zIndex > el.zIndex).sort((a, b) => a.zIndex - b.zIndex);
  if (!above.length) return;
  const swp = above[0];
  updateElement(el.id,  { zIndex: swp.zIndex });
  updateElement(swp.id, { zIndex: el.zIndex });
  scheduleRedraw();
}

export function sendBackward() {
  if (!selectedId) return;
  const els = getElements();
  const el  = els.find(e => e.id === selectedId);
  if (!el) return;
  const below = els.filter(e => e.zIndex < el.zIndex).sort((a, b) => b.zIndex - a.zIndex);
  if (!below.length) return;
  const swp = below[0];
  updateElement(el.id,  { zIndex: swp.zIndex });
  updateElement(swp.id, { zIndex: el.zIndex });
  scheduleRedraw();
}
