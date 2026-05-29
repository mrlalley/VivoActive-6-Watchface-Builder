import { DATA_FIELDS, CATEGORIES } from './modules/data-fields.js';
import { addElement, createElement, exportState, importState, undo, redo } from './modules/elements.js';
import { initCanvas, render, setSelectedId, toggleSafeArea, toggleGrid, bringForward, sendBackward } from './modules/canvas.js';
import { showProperties } from './modules/properties.js';
import { exportProject, previewInSimulator, openInVSCode } from './modules/export.js';

const LS_KEY = 'wfb-design';
let saveTimer = null;

// ─── Auto-save ────────────────────────────────────────────────────────────────

function scheduleAutoSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    localStorage.setItem(LS_KEY, exportState());
    flashSaveIndicator();
  }, 600);
}

function flashSaveIndicator() {
  const el = document.getElementById('save-indicator');
  if (!el) return;
  el.classList.add('visible');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('visible'), 2000);
}

function tryRestore() {
  const saved = localStorage.getItem(LS_KEY);
  if (!saved) return false;
  try {
    importState(saved);
    return true;
  } catch {
    return false;
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

function init() {
  buildPalette();

  initCanvas(
    document.getElementById('watch-canvas'),
    onSelect,
    onCanvasChange,
  );

  // ── Toolbar: edit ──
  document.getElementById('btn-undo').addEventListener('click', () => { undo(); render(); scheduleAutoSave(); });
  document.getElementById('btn-redo').addEventListener('click', () => { redo(); render(); scheduleAutoSave(); });
  document.getElementById('btn-safe-area').addEventListener('click', toggleSafeArea);
  document.getElementById('btn-grid').addEventListener('click', toggleGrid);
  document.getElementById('btn-bring-forward').addEventListener('click', () => { bringForward(); scheduleAutoSave(); });
  document.getElementById('btn-send-backward').addEventListener('click', () => { sendBackward(); scheduleAutoSave(); });

  // ── Toolbar: save/load ──
  document.getElementById('btn-new').addEventListener('click', handleNew);
  document.getElementById('btn-save-json').addEventListener('click', handleSaveJSON);
  document.getElementById('btn-load-json').addEventListener('click', () => document.getElementById('file-input').click());
  document.getElementById('file-input').addEventListener('change', handleLoadJSON);

  // ── Toolbar: export ──
  document.getElementById('btn-preview').addEventListener('click', handlePreview);
  document.getElementById('btn-export').addEventListener('click', handleExport);
  document.getElementById('btn-open-vscode').addEventListener('click', handleOpenVSCode);

  // ── Modal ──
  document.getElementById('btn-add').addEventListener('click', () => document.getElementById('field-modal').classList.remove('hidden'));
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('field-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });

  // ── Log overlay ──
  document.getElementById('log-close').addEventListener('click', () => document.getElementById('log-overlay').classList.add('hidden'));
  document.getElementById('log-open-vscode').addEventListener('click', handleOpenVSCode);

  // ── Keyboard ──
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); render(); scheduleAutoSave(); }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); redo(); render(); scheduleAutoSave(); }
    if (e.key === 'Escape') closeModal();
  });

  // ── Restore or load defaults ──
  if (!tryRestore()) addDefaults();

  // Wait for Garmin TTF fonts to finish loading before first render so text
  // sizes are correct from the start (fonts/Yantramanav + Roboto served from /builder/fonts/).
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => render());
  } else {
    render();
  }
}

// ─── Palette ──────────────────────────────────────────────────────────────────

function buildPalette() {
  const palette = document.getElementById('field-palette');
  const modal   = document.getElementById('modal-field-list');

  CATEGORIES.forEach(cat => {
    const fields = DATA_FIELDS.filter(f => f.category === cat.id);

    const sideDetails = document.createElement('details');
    sideDetails.className = 'palette-category';
    if (cat.open) sideDetails.open = true;
    const sideSummary = document.createElement('summary');
    sideSummary.className = 'category-header';
    sideSummary.textContent = cat.label;
    sideDetails.appendChild(sideSummary);
    const sideItems = document.createElement('div');
    sideItems.className = 'category-items';
    fields.forEach(f => sideItems.appendChild(fieldItem(f, 'palette-item', () => addFieldAt(f.id, 195, 195))));
    sideDetails.appendChild(sideItems);
    palette.appendChild(sideDetails);

    const modalDetails = document.createElement('details');
    modalDetails.className = 'modal-category';
    modalDetails.open = true;
    const modalSummary = document.createElement('summary');
    modalSummary.className = 'modal-category-header';
    modalSummary.textContent = cat.label;
    modalDetails.appendChild(modalSummary);
    const modalItems = document.createElement('div');
    modalItems.className = 'modal-category-grid';
    fields.forEach(f => modalItems.appendChild(fieldItem(f, 'modal-field-item', () => { addFieldAt(f.id, 195, 195); closeModal(); })));
    modalDetails.appendChild(modalItems);
    modal.appendChild(modalDetails);
  });
}

function fieldItem(field, className, onClick) {
  const el = document.createElement('div');
  el.className = className;
  el.innerHTML = `<span class="icon">${field.icon}</span><span>${field.label}</span>`;
  el.addEventListener('click', onClick);
  return el;
}

function addFieldAt(fieldId, x, y) {
  const el = createElement(fieldId, x, y);
  if (!el) return;
  addElement(el);
  setSelectedId(el.id);
  showProperties(el, onDelete, scheduleAutoSave);
  render();
  scheduleAutoSave();
}

// ─── Callbacks ────────────────────────────────────────────────────────────────

function onSelect(el) {
  showProperties(el, onDelete, scheduleAutoSave);
}

function onCanvasChange() {
  scheduleAutoSave();
}

function onDelete() {
  showProperties(null);
  scheduleAutoSave();
}

// ─── Save / Load / New ───────────────────────────────────────────────────────

function handleNew() {
  if (!confirm('Start a new design? The current design will be cleared.')) return;
  importState(JSON.stringify({ elements: [], nextId: 1 }));
  addDefaults();
  setSelectedId(null);
  showProperties(null);
  render();
  localStorage.removeItem(LS_KEY);
}

function handleSaveJSON() {
  const blob = new Blob([exportState()], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'watchface-design.json';
  a.click();
  URL.revokeObjectURL(url);
}

function handleLoadJSON(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      importState(ev.target.result);
      setSelectedId(null);
      showProperties(null);
      render();
      localStorage.setItem(LS_KEY, ev.target.result);
      flashSaveIndicator();
    } catch (err) {
      alert('Could not load design file: ' + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = ''; // allow reloading same file
}

// ─── Export ───────────────────────────────────────────────────────────────────

async function handlePreview() {
  const btn = document.getElementById('btn-preview');
  btn.disabled = true;
  btn.textContent = '⏳ Building…';
  try {
    const result = await previewInSimulator();
    if (result.success) {
      btn.textContent = '✓ Launched';
      if (result.log) showLog(`▶ Simulator launched\n\n${result.log}`);
    } else {
      showLog(`✗ Preview failed\n\n${result.error || ''}\n\n${result.log || ''}`);
    }
  } catch (err) {
    showLog(`✗ Network error: ${err.message}`);
  } finally {
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = '▶ Preview';
    }, 3000);
  }
}

async function handleExport() {
  const name = prompt('Project name (used in manifest.xml):', 'MyWatchFace');
  if (name === null) return;
  showLog('Building project…\n');
  try {
    const result = await exportProject(name.trim() || 'MyWatchFace');
    if (result.success) {
      showLog(`✓ Build succeeded!\n\nOutput: ${result.prgPath}\n\n${result.log || '(no compiler output)'}`);
    } else {
      showLog(`✗ Build failed\n\n${result.error || ''}\n\n${result.log || ''}\n\n──────────────────────────\nManual build:\n  Open exported-garmin-project/ in VS Code\n  Run: Monkey C: Build for Device → vivoactive6`);
    }
  } catch (err) {
    showLog(`✗ Network error: ${err.message}`);
  }
}

async function handleOpenVSCode() {
  try {
    const result = await openInVSCode();
    if (!result.success) showLog(`Could not open VS Code:\n${result.error}`);
  } catch (err) {
    showLog(`Error: ${err.message}`);
  }
}

function showLog(msg) {
  document.getElementById('log-content').textContent = msg;
  document.getElementById('log-overlay').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('field-modal').classList.add('hidden');
}

// ─── Default canvas state ─────────────────────────────────────────────────────

function addDefaults() {
  const defaults = [
    { id: 'hours',        x: 155, y: 178 },
    { id: 'minutes',      x: 250, y: 178 },
    { id: 'dateFullDate', x: 195, y: 240 },
    { id: 'heartRate',    x: 120, y: 290 },
    { id: 'battery',      x: 270, y: 290 },
  ];
  defaults.forEach(({ id, x, y }, i) => {
    const el = createElement(id, x, y);
    if (el) { el.zIndex = i; addElement(el, false); }
  });
}

document.addEventListener('DOMContentLoaded', init);
