import { DATA_FIELDS, CATEGORIES } from './modules/data-fields.js';
import { addElement, createElement, exportState, importState, undo, redo } from './modules/elements.js';
import { initCanvas, render, setSelectedId, toggleSafeArea, toggleGrid, bringForward, sendBackward } from './modules/canvas.js';
import { showProperties } from './modules/properties.js';
import { exportProject, previewInSimulator } from './modules/export.js';

const LS_KEY = 'wfb-design';
let saveTimer = null;
let lastExportedPath = null;

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

// ─── Settings ────────────────────────────────────────────────────────────────

function initSettings() {
  // Listen for Settings overlay show event from main process
  if (window.electronAPI?.onSettingsShow) {
    window.electronAPI.onSettingsShow(() => showSettings());
  }

  // Listen for New Design menu item
  if (window.electronAPI?.onNewDesign) {
    window.electronAPI.onNewDesign(() => handleNew());
  }

  const settingsOverlay = document.getElementById('settings-overlay');
  const saveBtn = document.getElementById('settings-save');
  const cancelBtn = document.getElementById('settings-cancel');
  const sdkPathInput = document.getElementById('settings-sdk-path');
  const devKeyInput = document.getElementById('settings-dev-key');
  const sdkBrowseBtn = document.getElementById('settings-sdk-browse');
  const keyBrowseBtn = document.getElementById('settings-key-browse');

  if (!settingsOverlay) return;

  // Load config on init and try auto-detect if fields are empty
  async function loadSettings() {
    const cfg = await window.electronAPI?.getConfig?.();
    if (cfg.sdkBin) sdkPathInput.value = cfg.sdkBin;
    if (cfg.devKey) devKeyInput.value = cfg.devKey;

    // Auto-detect only if fields are empty
    if (!cfg.sdkBin || !cfg.devKey) {
      const detected = await window.electronAPI?.autoDetect?.();
      if (detected) {
        if (!cfg.sdkBin && detected.sdkBin) sdkPathInput.value = detected.sdkBin;
        if (!cfg.devKey && detected.devKey) devKeyInput.value = detected.devKey;
      }
    }
  }

  loadSettings().catch(() => {});

  // Browse button handlers
  sdkBrowseBtn?.addEventListener('click', async () => {
    const result = await window.electronAPI?.openFileDialog?.({
      title: 'Select SDK bin directory',
      properties: ['openDirectory'],
    });
    if (result?.filePaths?.[0]) {
      sdkPathInput.value = result.filePaths[0];
    }
  });

  keyBrowseBtn?.addEventListener('click', async () => {
    const result = await window.electronAPI?.openFileDialog?.({
      title: 'Select developer_key.der',
      properties: ['openFile'],
      filters: [{ name: 'DER Files', extensions: ['der'] }],
    });
    if (result?.filePaths?.[0]) {
      devKeyInput.value = result.filePaths[0];
    }
  });

  // Generate key button
  const keyGenerateBtn = document.getElementById('settings-key-generate');
  const keyStatusEl = document.getElementById('settings-key-status');

  keyGenerateBtn?.addEventListener('click', async () => {
    keyGenerateBtn.disabled = true;
    keyGenerateBtn.textContent = '⏳ Generating… (15–30s)';
    keyStatusEl.style.display = 'block';
    keyStatusEl.textContent = 'Generating 4096-bit RSA key — please wait…';
    keyStatusEl.style.color = '#888';

    const outputPath = devKeyInput.value.trim() || null;
    let result = await window.electronAPI?.generateDevKey?.({ outputPath, force: false });

    // Handle existing file case
    if (result && !result.success && result.exists) {
      const overwrite = confirm(
        `A developer key already exists at:\n${result.path}\n\nOverwrite it? The old key cannot be recovered.`
      );
      if (!overwrite) {
        keyGenerateBtn.disabled = false;
        keyGenerateBtn.textContent = '🔑 Generate New Key';
        keyStatusEl.style.display = 'none';
        return;
      }
      // Retry with force
      result = await window.electronAPI?.generateDevKey?.({ outputPath: result.path, force: true });
    }

    // Handle final outcome
    if (result?.success) {
      devKeyInput.value = result.path;
      keyStatusEl.textContent = '✓ Key generated successfully.';
      keyStatusEl.style.color = '#4caf50';
    } else {
      keyStatusEl.textContent = `✗ Error: ${result?.error || 'Unknown error'}`;
      keyStatusEl.style.color = '#e05050';
    }

    keyGenerateBtn.disabled = false;
    keyGenerateBtn.textContent = '🔑 Generate New Key';
  });

  // Save button
  saveBtn?.addEventListener('click', async () => {
    if (!sdkPathInput.value.trim() || !devKeyInput.value.trim()) {
      alert('Please fill in both SDK path and developer key path.');
      return;
    }
    saveBtn.disabled = true;
    saveBtn.textContent = '💾 Saved — restarting…';
    const result = await window.electronAPI?.saveConfig?.({
      sdkBin: sdkPathInput.value.trim(),
      devKey: devKeyInput.value.trim(),
    });
    if (result?.success) {
      // Relaunch is scheduled in main process; this will exit shortly
    } else {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Settings';
    }
  });

  // Cancel button
  cancelBtn?.addEventListener('click', hideSettings);

  // Click overlay to close (on backdrop only)
  settingsOverlay?.addEventListener('click', (e) => {
    if (e.target === settingsOverlay) hideSettings();
  });
}

function showSettings() {
  const overlay = document.getElementById('settings-overlay');
  if (overlay) overlay.classList.remove('hidden');
}

function hideSettings() {
  const overlay = document.getElementById('settings-overlay');
  if (overlay) overlay.classList.add('hidden');
}

// ─── Init ─────────────────────────────────────────────────────────────────────

function init() {
  initSettings();
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
  document.getElementById('btn-settings').addEventListener('click', showSettings);

  // ── Toolbar: save/load ──
  document.getElementById('btn-new').addEventListener('click', handleNew);
  document.getElementById('btn-save-design').addEventListener('click', handleSaveDesign);
  document.getElementById('btn-save-json').addEventListener('click', handleSaveJSON);
  document.getElementById('btn-load-json').addEventListener('click', () => document.getElementById('file-input').click());
  document.getElementById('file-input').addEventListener('change', handleLoadJSON);

  // ── Toolbar: export ──
  document.getElementById('btn-preview').addEventListener('click', handlePreview);
  document.getElementById('btn-export').addEventListener('click', handleExport);

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

async function handleSaveDesign() {
  const projectName = prompt('Design name:', 'MyWatchFace');
  if (!projectName) return;

  try {
    const elements = getElements();
    const res = await fetch('/api/save-design', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectName, elements }),
    });

    const result = await res.json();
    if (!result.success) {
      alert(`Save failed: ${result.error}`);
    } else {
      flashSaveIndicator();
      alert(`✓ Design saved!\n\nFile: ${result.filePath}\n\nYou can load it later with the Load button.`);
    }
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
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
      lastExportedPath = result.projectPath;
      showLog(`✓ Build succeeded!\n\nOutput: ${result.prgPath}\n\n${result.log || '(no compiler output)'}`);
    } else {
      showLog(`✗ Build failed\n\n${result.error || ''}\n\n${result.log || ''}\n\n──────────────────────────\nManual build:\n  Open exported-garmin-project/ in VS Code\n  Run: Monkey C: Build for Device → vivoactive6`);
    }
  } catch (err) {
    showLog(`✗ Network error: ${err.message}`);
  }
}

async function handleOpenVSCode() {
  if (!lastExportedPath) {
    alert('No exported project yet. Click Export first.');
    return;
  }
  if (window.electronAPI?.openInVSCode) {
    try {
      await window.electronAPI.openInVSCode(lastExportedPath);
    } catch (err) {
      alert(`Could not open VS Code: ${err.message}`);
    }
  } else {
    alert(`Open VS Code manually:\n\ncode "${lastExportedPath}"`);
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
