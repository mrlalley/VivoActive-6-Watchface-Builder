import { updateElement, removeElement, commitHistory, FONT_HEIGHTS } from './elements.js';
import { scheduleRedraw, setSelectedId, ANALOG_SHAPES, TICK_TYPES } from './canvas.js';
import { CANVAS_SIZE, CANVAS_CENTER } from '../constants.js';

/**
 * @typedef {Object} Element
 * @property {number} id - Unique element identifier
 * @property {string} fieldId - Data field binding (e.g., 'time', 'heartRate', 'customLabel')
 * @property {string} label - Human-readable element name
 * @property {number} x - Center X coordinate (0-390)
 * @property {number} y - Center Y coordinate (0-390)
 * @property {number} width - Element width in pixels
 * @property {number} height - Element height in pixels
 * @property {string} font - Garmin font: 'FONT_XTINY'|'FONT_TINY'|'FONT_SMALL'|'FONT_MEDIUM'|'FONT_LARGE'|'FONT_NUMBER_MILD'|'FONT_NUMBER_MEDIUM'|'FONT_NUMBER_HOT'|'FONT_NUMBER_THAI_HOT'
 * @property {string} color - Hex color '#RRGGBB'
 * @property {'left'|'center'|'right'} align - Text alignment
 * @property {'always'|'awake'|'sleep'} visibility - Visibility state
 * @property {string} format - Format string for custom labels
 * @property {number} zIndex - Layer ordering
 * @property {string|null} shapeType - Shape type: 'analogHour'|'analogMinute'|'analogSecond'|'analogCenter'|'tickHour'|'tickMinute'|'tickMixed'|'tickDots'|'circle'|'rectangle'|'ring'|'hrGraph' or null for text
 * @property {string} preview - Preview text displayed on canvas
 */

const GARMIN_FONTS = [
  'FONT_XTINY', 'FONT_TINY', 'FONT_SMALL', 'FONT_MEDIUM', 'FONT_LARGE',
  'FONT_NUMBER_MILD', 'FONT_NUMBER_MEDIUM', 'FONT_NUMBER_HOT', 'FONT_NUMBER_THAI_HOT',
];

/**
 * Render the properties panel for editing an element.
 * If el is null, shows "no selection" message.
 * Dynamically adapts UI based on element type (shape vs text, specific shape types).
 * @param {Element|null} el - Element to display properties for, or null to show empty state
 * @param {Function} onDelete - Callback when delete button is clicked
 * @param {Function} onAnyChange - Callback when any property changes
 */
export function showProperties(el, onDelete, onAnyChange) {
  const panel = document.getElementById('properties-panel');
  if (!el) {
    panel.innerHTML = '<p class="no-selection">Select an element to edit its properties.</p>';
    return;
  }

  // Use the canonical sets imported from canvas.js — no local redeclaration
  const isTickShape   = TICK_TYPES.has(el.shapeType);
  const isAnalogShape = ANALOG_SHAPES.has(el.shapeType);
  const isHRGraph     = el.shapeType === 'hrGraph';
  const isTextLabel   = el.fieldId === 'customLabel';
  const isShape       = !!el.shapeType;

  const widthLabel  = isTickShape   ? 'Outer Radius'
                    : isAnalogShape ? (el.shapeType === 'analogCenter' ? 'Dot Radius' : 'Hand Length')
                    : isHRGraph     ? 'Graph Width'
                    : 'Width';
  const heightLabel = isTickShape   ? (el.shapeType === 'tickDots' ? 'Dot Radius' : el.shapeType === 'tickMixed' ? 'Major Tick Len' : 'Tick Length')
                    : isAnalogShape ? (el.shapeType === 'analogCenter' ? 'Dot Radius' : 'Tail Length')
                    : isHRGraph     ? 'Graph Height'
                    : 'Height';

  panel.innerHTML = `
    <h3>${el.label}</h3>

    ${isTextLabel ? `
    <div class="prop-group">
      <label>Label text
        <input type="text" id="p-labeltext" value="${escHtml(el.format || el.preview || '')}"
               placeholder="e.g. BPM, STEPS, HR">
      </label>
    </div>
    ` : ''}

    <div class="prop-group">
      <label>X (px)<input type="number" id="p-x" value="${Math.round(el.x)}" min="0" max="${CANVAS_SIZE}"></label>
      <label>Y (px)<input type="number" id="p-y" value="${Math.round(el.y)}" min="0" max="${CANVAS_SIZE}"></label>
    </div>
    <div class="prop-group">
      <label>${widthLabel}<input type="number" id="p-w" value="${Math.round(el.width)}"  min="1" max="${CANVAS_SIZE}"></label>
      <label>${heightLabel}<input type="number" id="p-h" value="${Math.round(el.height)}" min="1" max="${CANVAS_CENTER}"></label>
    </div>
    <div class="prop-group">
      <label>Color<input type="color" id="p-color" value="${el.color || '#ffffff'}"></label>
    </div>

    ${!isShape ? `
    <div class="prop-group">
      <label>Font
        <select id="p-font">${GARMIN_FONTS.map(f =>
          `<option value="${f}"${el.font === f ? ' selected' : ''}>${f}</option>`).join('')}
        </select>
      </label>
    </div>
    <div class="prop-group">
      <label>Align
        <select id="p-align">
          <option value="left"${el.align === 'left' ? ' selected' : ''}>Left</option>
          <option value="center"${el.align === 'center' ? ' selected' : ''}>Center</option>
          <option value="right"${el.align === 'right' ? ' selected' : ''}>Right</option>
        </select>
      </label>
    </div>
    <div class="prop-group">
      <label>Visibility
        <select id="p-vis">
          <option value="always"${el.visibility === 'always' ? ' selected' : ''}>Always</option>
          <option value="awake"${el.visibility === 'awake'   ? ' selected' : ''}>Awake only</option>
          <option value="sleep"${el.visibility === 'sleep'   ? ' selected' : ''}>Sleep only</option>
        </select>
      </label>
    </div>
    ${!isTextLabel ? `
    <div class="prop-group">
      <label>Preview text<input type="text" id="p-preview" value="${escHtml(el.preview || '')}"></label>
    </div>
    ` : ''}
    ` : ''}

    <div class="prop-group">
      <label>Z-index<input type="number" id="p-z" value="${el.zIndex || 0}" min="0" max="99"></label>
    </div>

    <button id="p-delete" class="btn-danger">Delete Element</button>
  `;

  // ── Bind inputs ────────────────────────────────────────────────────────────

  // Text label: one field drives both preview (canvas) and format (Monkey C export)
  if (isTextLabel) {
    bindLive('p-labeltext', id => ({ preview: v(id), format: v(id) }));
  }

  bindLive('p-x',     id => ({ x:      Number(v(id)) }));
  bindLive('p-y',     id => ({ y:      Number(v(id)) }));
  bindLive('p-w',     id => ({ width:  Math.max(1, Number(v(id))) }));
  bindLive('p-h',     id => ({ height: Math.max(1, Number(v(id))) }));
  bindLive('p-color', id => ({ color:  v(id) }));
  bindLive('p-z',     id => ({ zIndex: Number(v(id)) }));

  if (!isShape) {
    bindLive('p-font', id => {
      const newFont = v(id);
      const newH = FONT_HEIGHTS[newFont] || 36;
      // Mirror the updated height into the height input so user sees it immediately
      const hInput = document.getElementById('p-h');
      if (hInput) hInput.value = newH;
      return { font: newFont, height: newH };
    });
    bindLive('p-align',   id => ({ align:      v(id) }));
    bindLive('p-vis',     id => ({ visibility: v(id) }));
    if (!isTextLabel) bindLive('p-preview', id => ({ preview: v(id) }));
  }

  document.getElementById('p-delete').addEventListener('click', () => {
    removeElement(el.id);
    setSelectedId(null);
    showProperties(null);
    scheduleRedraw();
    onDelete && onDelete();
  });

  // ── Helpers ────────────────────────────────────────────────────────────────

  function v(id) { return document.getElementById(id)?.value ?? ''; }

  function bindLive(id, propsOf) {
    const input = document.getElementById(id);
    if (!input) return;
    // 'input' → live canvas update + notify auto-save
    input.addEventListener('input', () => {
      updateElement(el.id, propsOf(id));
      scheduleRedraw();
      onAnyChange && onAnyChange();
    });
    // 'change' (blur / Enter) → push to undo history
    input.addEventListener('change', () => {
      commitHistory();
    });
  }
}

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
