import { DATA_FIELDS, CATEGORIES } from './modules/data-fields.js';
import { addElement, createElement, exportState, importState, undo, redo, getElements } from './modules/elements.js';
import { initCanvas, render, scheduleRedraw, setSelectedId, toggleSafeArea, toggleGrid, bringForward, sendBackward, cleanupCanvas, runValidation } from './modules/canvas.js';
import { showProperties } from './modules/properties.js';
import { exportProject, previewInSimulator } from './modules/export.js';
import { DEFAULT_ELEMENT_X, DEFAULT_ELEMENT_Y, MAX_DESIGN_ELEMENTS, SAVE_INDICATOR_HIDE_DELAY } from './constants.js';

const LS_KEY = 'wfb-design';
let saveTimer = null;

// Authenticated fetch helper.
// In Electron mode: delegates to preload's apiFetch() which attaches x-wfb-token.
// In browser/web mode: falls back to bare fetch() — server must run without
// WFB_SESSION_TOKEN for unauthenticated browser access to work.
function apiFetch(path, options) {
  if (window.electronAPI?.apiFetch) {
    return window.electronAPI.apiFetch(path, options);
  }
  return fetch(path, options);
}

// ─── Palette accordion state ───────────────────────────────────────────────────
// In-memory only — localStorage is blocked in the sandboxed renderer.
let activeCategoryId = null;
// requestId of the most recent successful export — used by "Open in VS Code".
// We store the requestId (not the full path) because the server no longer sends
// filesystem paths to the renderer. The Electron main process reconstructs the
// full path from exportDir + requestId server-side, keeping paths off the wire.
let lastExportedRequestId = null;

// ─── Auto-save ────────────────────────────────────────────────────────────────

function scheduleAutoSave() {
  runValidation(); // recheck safe-area after any property/structural change
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
  el._t = setTimeout(() => el.classList.remove('visible'), SAVE_INDICATOR_HIDE_DELAY);
}

function tryRestore() {
  const saved = localStorage.getItem(LS_KEY);
  if (!saved) return false;
  try {
    importState(saved);
    return true;
  } catch (err) {
    console.warn('Failed to restore design from localStorage:', err.message);
    // Silently fail and start with empty canvas (graceful degradation)
    return false;
  }
}

// ─── Health check ────────────────────────────────────────────────────────────

function initHealthCheck() {
  const warningEl = document.getElementById('health-warning');
  const warningTitleEl = document.getElementById('health-warning-title');
  const warningTextEl = document.getElementById('health-warning-text');
  const warningActionsEl = document.getElementById('health-warning-actions');
  const closeBtn = document.getElementById('health-warning-close');

  if (!warningEl || !warningTitleEl || !warningTextEl || !closeBtn) return;

  function makeActionBtn(label, onClick) {
    const btn = document.createElement('button');
    btn.className = 'health-warning-action-btn';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  function displayHealthWarning(health) {
    if (health.ok !== false) return;

    let title = '';
    let message = '';
    const buttons = [];

    const openSDKSite = () => window.open('https://developer.garmin.com/connect-iq/sdk/', '_blank', 'noopener,noreferrer');

    const openSettings = () => document.getElementById('btn-settings')?.click();

    const generateKeyInline = async (btn) => {
      if (window.electronAPI?.generateDevKey) {
        // Electron mode: delegate to settings panel which has the full flow
        openSettings();
        return;
      }
      // Web mode: call server endpoint directly
      btn.disabled = true;
      btn.textContent = '⏳ Generating…';
      try {
        let res = await apiFetch('/api/generate-key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
        let result = await res.json();
        if (result.exists) {
          if (!confirm(`A developer key already exists at:\n${result.path}\n\nOverwrite it?`)) {
            btn.disabled = false;
            btn.textContent = '🔑 Generate Developer Key';
            return;
          }
          res = await apiFetch('/api/generate-key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force: true }) });
          result = await res.json();
        }
        if (result.success) {
          warningEl.classList.add('health-warning--hidden'); // Key now exists — hide bar
        } else {
          alert(`Key generation failed: ${result.error || 'Unknown error'}`);
          btn.disabled = false;
          btn.textContent = '🔑 Generate Developer Key';
        }
      } catch (err) {
        alert(`Key generation failed: ${err.message}`);
        btn.disabled = false;
        btn.textContent = '🔑 Generate Developer Key';
      }
    };

    if (!health.sdkFound && !health.keyFound) {
      title = 'Garmin SDK and developer key not found';
      message = 'Design and save work, but export and build to watch are disabled.';
      buttons.push(makeActionBtn('↗ Get Garmin SDK', openSDKSite));
      const keyBtn = makeActionBtn('🔑 Generate Developer Key', () => generateKeyInline(keyBtn));
      buttons.push(keyBtn);
    } else if (!health.sdkFound) {
      title = 'Garmin SDK not found';
      message = 'Export and simulator preview are disabled. Design and save still work.';
      buttons.push(makeActionBtn('↗ Get Garmin SDK', openSDKSite));
    } else if (!health.keyFound) {
      title = 'Developer key not found';
      message = 'Building .prg files for your watch is disabled. Design, save, and export project files still work.';
      const keyBtn = makeActionBtn('🔑 Generate Developer Key', () => generateKeyInline(keyBtn));
      buttons.push(keyBtn);
    } else if (health.error) {
      title = 'Server error';
      message = health.error;
    } else {
      title = 'Build tools not fully configured';
      message = 'Design features work but export and build are disabled.';
    }

    warningTitleEl.textContent = title;
    warningTextEl.textContent = message;
    warningActionsEl.innerHTML = '';
    buttons.forEach(btn => warningActionsEl.appendChild(btn));
    warningEl.classList.remove('health-warning--hidden');
  }

  // Electron mode: listen for IPC health warnings
  if (window.electronAPI?.onHealthWarning) {
    window.electronAPI.onHealthWarning((event, health) => {
      displayHealthWarning(health);
    });
  } else {
    // Web server mode: fetch health status via HTTP
    fetch('/api/health')
      .then(res => res.json())
      .then(health => displayHealthWarning(health))
      .catch(() => {
        warningEl.classList.add('health-warning--hidden');
      });
  }

  // Handle health status (for logging)
  if (window.electronAPI?.onHealthStatus) {
    window.electronAPI.onHealthStatus((event, health) => {
      console.log('[Health Check]', health);
    });
  }

  // Close button
  closeBtn.addEventListener('click', () => {
    warningEl.classList.add('health-warning--hidden');
  });
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
    keyStatusEl.classList.remove('hidden');
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
        keyStatusEl.classList.add('hidden');
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
  initHealthCheck();
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
  document.getElementById('btn-load-json').addEventListener('click', handleLoadDesignDialog);
  document.getElementById('file-input').addEventListener('change', handleLoadJSON);
  document.getElementById('load-close').addEventListener('click', () => document.getElementById('load-overlay').classList.add('hidden'));
  document.getElementById('load-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('load-overlay')) document.getElementById('load-overlay').classList.add('hidden');
  });

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

  // ── Stop the analog render timer when the page unloads (Electron reload / navigation) ──
  window.addEventListener('beforeunload', () => {
    cleanupCanvas();
    window.electronAPI?.cleanup(); // remove persistent IPC listeners before unload
  });

  // ── Restore prior session ──
  // On first cold start (nothing in localStorage) the canvas starts blank.
  // addDefaults() is preserved below as a dev/test utility but not called automatically.
  tryRestore();

  // Wait for Garmin TTF fonts to finish loading before first render so text
  // sizes are correct from the start (fonts/Yantramanav + Roboto served from /builder/fonts/).
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { render(); notifyValidation(runValidation()); });
  } else {
    render();
    notifyValidation(runValidation());
  }
}

/** Show a log entry when validation disables buttons (startup or load-time). */
function notifyValidation(result) {
  if (!result.valid) {
    showLog(
      `⚠️ ${result.invalidIds.size} element${result.invalidIds.size === 1 ? '' : 's'} outside the safe display area.\n\n` +
      result.errors.join('\n') +
      '\n\nMove or resize the highlighted element(s) to re-enable Preview and Export.'
    );
  }
}

// ─── Palette ──────────────────────────────────────────────────────────────────

// Collapse a palette <details> with a height animation.
// Keeps details.open=true during the animation so content remains visible.
function collapsePanel(detailsEl) {
  const content = detailsEl.querySelector('.category-items');
  const summary = detailsEl.querySelector('.category-header');
  if (!content || detailsEl.dataset.animating === '1') return;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  summary.setAttribute('aria-expanded', 'false');
  content.setAttribute('aria-hidden', 'true');

  if (reduced) {
    detailsEl.open = false;
    content.style.height = '';
    return;
  }

  detailsEl.dataset.animating = '1';
  content.style.height   = content.scrollHeight + 'px';
  content.style.overflow = 'hidden';
  content.getBoundingClientRect(); // force reflow
  content.style.transition = 'height 200ms cubic-bezier(0.16,1,0.3,1)';
  content.style.height = '0';

  content.addEventListener('transitionend', function done() {
    content.removeEventListener('transitionend', done);
    detailsEl.open = false;
    content.style.height = content.style.transition = '';
    content.style.overflow = 'hidden'; // keep hidden until next open
    delete detailsEl.dataset.animating;
  }, { once: true });
}

// Expand a palette <details> with a height animation.
function expandPanel(detailsEl) {
  const content = detailsEl.querySelector('.category-items');
  const summary = detailsEl.querySelector('.category-header');
  if (!content) return;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  detailsEl.open = true; // show content so scrollHeight is measurable
  summary.setAttribute('aria-expanded', 'true');
  content.setAttribute('aria-hidden', 'false');

  if (reduced) {
    content.style.height = content.style.overflow = '';
    return;
  }

  const target = content.scrollHeight;
  content.style.height   = '0';
  content.style.overflow = 'hidden';
  content.style.transition = 'height 200ms cubic-bezier(0.16,1,0.3,1)';
  content.getBoundingClientRect(); // force reflow
  content.style.height = target + 'px';

  content.addEventListener('transitionend', function done() {
    content.removeEventListener('transitionend', done);
    content.style.height = content.style.transition = content.style.overflow = '';
  }, { once: true });
}

function buildPalette() {
  const palette = document.getElementById('field-palette');
  const modal   = document.getElementById('modal-field-list');
  const allSideDetails = [];

  CATEGORIES.forEach(cat => {
    const fields = DATA_FIELDS.filter(f => f.category === cat.id);

    // ── Sidebar palette ──
    const sideDetails = document.createElement('details');
    sideDetails.className = 'palette-category';
    sideDetails.dataset.categoryId = cat.id;

    const sideSummary = document.createElement('summary');
    sideSummary.className = 'category-header';
    sideSummary.textContent = cat.label;
    sideSummary.setAttribute('aria-expanded', 'false');
    sideSummary.setAttribute('role', 'button');
    sideSummary.setAttribute('tabindex', '0');

    sideDetails.appendChild(sideSummary);

    const sideItems = document.createElement('div');
    sideItems.className = 'category-items';
    sideItems.setAttribute('aria-hidden', 'true');
    sideItems.style.overflow = 'hidden';
    sideItems.style.height   = '0';
    fields.forEach(f => sideItems.appendChild(fieldItem(f, 'palette-item', () => addFieldAt(f.id, DEFAULT_ELEMENT_X, DEFAULT_ELEMENT_Y))));
    sideDetails.appendChild(sideItems);
    palette.appendChild(sideDetails);
    allSideDetails.push(sideDetails);

    // Intercept native toggle — accordion coordination happens here.
    sideSummary.addEventListener('click', e => {
      e.preventDefault();
      const isOpen = sideDetails.open;
      if (isOpen) {
        collapsePanel(sideDetails);
        activeCategoryId = null;
      } else {
        // Collapse every other open panel first
        allSideDetails.forEach(d => { if (d !== sideDetails && d.open) collapsePanel(d); });
        expandPanel(sideDetails);
        activeCategoryId = cat.id;
      }
    });

    // Keyboard: Enter/Space handled via click; ArrowUp/Down move focus
    sideSummary.addEventListener('keydown', e => {
      const triggers = allSideDetails.map(d => d.querySelector('.category-header'));
      const idx = triggers.indexOf(sideSummary);
      if (e.key === 'ArrowDown') { e.preventDefault(); triggers[(idx + 1) % triggers.length].focus(); }
      if (e.key === 'ArrowUp')   { e.preventDefault(); triggers[(idx - 1 + triggers.length) % triggers.length].focus(); }
      if (e.key === 'Home')      { e.preventDefault(); triggers[0].focus(); }
      if (e.key === 'End')       { e.preventDefault(); triggers[triggers.length - 1].focus(); }
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sideSummary.click(); }
    });

    // ── Modal ──
    const modalDetails = document.createElement('details');
    modalDetails.className = 'modal-category';
    if (cat.open) modalDetails.open = true;
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

  // Restore the last user-opened category on palette re-renders.
  // activeCategoryId is null on first load — leave all categories collapsed.
  // The user opens one explicitly. No fallback default.
  if (activeCategoryId !== null) {
    const restoreDetails = allSideDetails.find(d => d.dataset.categoryId === activeCategoryId);
    if (restoreDetails) {
      const content = restoreDetails.querySelector('.category-items');
      const summary = restoreDetails.querySelector('.category-header');
      restoreDetails.open = true;
      summary.setAttribute('aria-expanded', 'true');
      content.setAttribute('aria-hidden', 'false');
      content.style.height = content.style.overflow = '';
    } else {
      activeCategoryId = null; // category no longer in DOM — reset cleanly
    }
  }
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
  activeCategoryId = null; // collapse palette accordion on next render
  setSelectedId(null);
  showProperties(null);
  render();
  localStorage.removeItem(LS_KEY);
  runValidation();
}

async function handleSaveDesign() {
  // Show the save design dialog and get the project name
  const overlay = document.getElementById('save-design-overlay');
  const input = document.getElementById('save-design-input');
  const confirmBtn = document.getElementById('save-design-confirm');
  const cancelBtn = document.getElementById('save-design-cancel');
  const closeBtn = document.getElementById('save-design-close');

  overlay.classList.remove('hidden');
  input.focus();
  input.select();

  // Wait for user to confirm or cancel
  const projectName = await new Promise((resolve) => {
    const handleConfirm = () => {
      const name = input.value.trim();
      cleanup();
      resolve(name || null);
    };
    const handleCancel = () => {
      cleanup();
      resolve(null);
    };
    const cleanup = () => {
      overlay.classList.add('hidden');
      confirmBtn.removeEventListener('click', handleConfirm);
      cancelBtn.removeEventListener('click', handleCancel);
      closeBtn.removeEventListener('click', handleCancel);
      input.removeEventListener('keydown', handleKeydown);
    };
    const handleKeydown = (e) => {
      if (e.key === 'Enter') handleConfirm();
      if (e.key === 'Escape') handleCancel();
    };

    confirmBtn.addEventListener('click', handleConfirm);
    cancelBtn.addEventListener('click', handleCancel);
    closeBtn.addEventListener('click', handleCancel);
    input.addEventListener('keydown', handleKeydown);
  });

  if (!projectName) return;

  // Check if design already exists
  try {
    const checkRes = await apiFetch(`/api/designs/check/${encodeURIComponent(projectName)}`);
    const checkResult = await checkRes.json();

    if (checkResult.success && checkResult.exists) {
      const confirmed = confirm(
        `⚠️ A design named "${projectName}" already exists.\n\n` +
        `Do you want to overwrite it?`
      );
      if (!confirmed) {
        return;
      }
    }
  } catch (err) {
    console.warn('Could not check if design exists:', err.message);
  }

  try {
    const elements = getElements();
    const res = await apiFetch('/api/save-design', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectName, elements }),
    });

    const text = await res.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch (parseErr) {
      console.error('Response text:', text);
      throw new Error(`Invalid JSON response: ${text.substring(0, 100)}`);
    }

    if (!result.success) {
      alert(`Save failed: ${result.error}`);
    } else {
      flashSaveIndicator();
      alert(`✓ Design saved!\n\n"${result.projectName}" (${result.elementCount} elements)\n\nYou can load it later with the Load button.`);
    }
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
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
      notifyValidation(runValidation()); // check safe-area immediately — local files skip the server validation path
    } catch (err) {
      alert('Could not load design file: ' + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = ''; // allow reloading same file
}

// ─── Load Design ──────────────────────────────────────────────────────────────


async function handleLoadDesignDialog() {
  const overlay = document.getElementById('load-overlay');
  const list = document.getElementById('load-list');

  overlay.classList.remove('hidden');
  list.innerHTML = '<p class="settings-loading-hint">Loading designs...</p>';

  try {
    const res = await apiFetch('/api/designs');
    const result = await res.json();

    if (!result.success || !result.designs || result.designs.length === 0) {
      list.innerHTML = '<p class="settings-loading-empty">No saved designs found.</p>';
      return;
    }

    // Build buttons via DOM API — never via innerHTML — so design.name and design.file
    // cannot inject HTML regardless of what the server returns.
    list.innerHTML = '';
    result.designs.forEach((design) => {
      const btn = document.createElement('button');
      btn.className = 'design-item';
      btn.dataset.file = design.file;
      btn.style.cssText = 'padding:12px;background:#2e2e2e;border:1px solid #3a3a3a;border-radius:3px;color:#fff;text-align:left;cursor:pointer;transition:background 0.2s;width:100%;';

      const nameDiv = document.createElement('div');
      nameDiv.style.cssText = 'font-weight:600;margin-bottom:4px;';
      nameDiv.textContent = design.name; // textContent — XSS-safe

      const metaDiv = document.createElement('div');
      metaDiv.style.cssText = 'font-size:11px;color:#aaa;';
      metaDiv.textContent = `${design.elementCount} elements • ${new Date(design.savedAt).toLocaleString()}`;

      btn.appendChild(nameDiv);
      btn.appendChild(metaDiv);
      btn.addEventListener('mouseover', () => { btn.style.background = '#383838'; });
      btn.addEventListener('mouseout',  () => { btn.style.background = '#2e2e2e'; });
      btn.addEventListener('click', () => {
        document.getElementById('load-overlay').classList.add('hidden');
        loadDesign(btn.dataset.file);
      });
      list.appendChild(btn);
    });
  } catch (err) {
    const p = document.createElement('p');
    p.style.cssText = 'color:#e05050;font-size:12px;';
    p.textContent = `Error loading designs: ${err.message}`;
    list.innerHTML = '';
    list.appendChild(p);
  }
}

async function loadDesign(filename) {
  try {
    const res = await apiFetch(`/api/designs/${encodeURIComponent(filename)}`);
    const result = await res.json();

    if (!result.success) {
      alert(`Error loading design: ${result.error}`);
      return;
    }

    try {
      importState(JSON.stringify(result.design));
    } catch (validationErr) {
      alert(`Design file is corrupted: ${validationErr.message}`);
      return;
    }

    setSelectedId(null);
    showProperties(null);
    render();
    localStorage.setItem(LS_KEY, JSON.stringify(result.design));
    flashSaveIndicator();

    // Run reactive validation — sets button state and red outlines based on actual canvas.
    // If the server flagged a specific element, also select and log it for the user.
    const validationResult = runValidation();
    const warning = result.validationWarning;
    if (warning) {
      const match = warning.match(/element\[(\d+)\]/);
      if (match) {
        const elementIndex = parseInt(match[1], 10);
        const els = getElements();
        if (els[elementIndex]) {
          setSelectedId(els[elementIndex].id);
          // Pass both callbacks so delete and property edits auto-save correctly
          showProperties(els[elementIndex],
            () => { setSelectedId(null); showProperties(null); scheduleRedraw(); scheduleAutoSave(); },
            scheduleAutoSave
          );
          render();
          showLog(`⚠️ One element is outside the safe display area (highlighted in red).\n\nMove or resize it to re-enable Preview and Export.`);
        }
      } else {
        showLog(`⚠️ ${warning}`);
      }
    } else if (!validationResult.valid) {
      // No server warning, but client-side validation found out-of-bounds elements
      notifyValidation(validationResult);
    }
  } catch (err) {
    alert(`Error loading design: ${err.message}`);
  }
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
      const errorMsg = result.error || '';
      showLog(`✗ Preview failed\n\n${errorMsg}\n\n${result.log || ''}`);

      // Try to highlight the offending element from error message
      const match = errorMsg.match(/element\[(\d+)\]/);
      if (match) {
        const elementIndex = parseInt(match[1], 10);
        const elements = getElements();
        if (elements[elementIndex]) {
          setSelectedId(elements[elementIndex].id);
          render();
        }
      }
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

  const projectName = name.trim() || 'MyWatchFace';

  // Check if project already exists
  try {
    const checkRes = await apiFetch(`/api/export/check/${encodeURIComponent(projectName)}`);
    const checkResult = await checkRes.json();

    if (checkResult.success && checkResult.exists) {
      const confirmed = confirm(
        `⚠️ A project named "${projectName}" already exists.\n\n` +
        `Do you want to overwrite it?\n\n` +
        `(Existing .prg file will be replaced)`
      );
      if (!confirmed) {
        showLog('Export cancelled.');
        return;
      }
    }
  } catch (err) {
    // If check fails, continue anyway (user can still export)
    console.warn('Could not check if project exists:', err.message);
  }

  showLog('Building project…\n');
  try {
    const result = await exportProject(projectName);
    if (result.success) {
      lastExportedRequestId = result.requestId || null;
      showLog(`✓ Build succeeded!\n\n${result.log || '(no compiler output)'}`);
    } else {
      const errorMsg = result.error || '';
      showLog(`✗ Build failed\n\n${errorMsg}\n\n${result.log || ''}\n\n──────────────────────────\nManual build:\n  Open exported-garmin-project/ in VS Code\n  Run: Monkey C: Build for Device → vivoactive6`);

      // Try to highlight the offending element from error message
      const match = errorMsg.match(/element\[(\d+)\]/);
      if (match) {
        const elementIndex = parseInt(match[1], 10);
        const elements = getElements();
        if (elements[elementIndex]) {
          setSelectedId(elements[elementIndex].id);
          render();
        }
      }
    }
  } catch (err) {
    showLog(`✗ Network error: ${err.message}`);
  }
}

async function handleOpenVSCode() {
  if (!lastExportedRequestId) {
    alert('No exported project yet. Click Export first.');
    return;
  }
  if (window.electronAPI?.openInVSCode) {
    try {
      // Pass requestId only — main process resolves the full path server-side
      // so filesystem paths never travel through the renderer.
      await window.electronAPI.openInVSCode(lastExportedRequestId);
    } catch (err) {
      alert(`Could not open VS Code: ${err.message}`);
    }
  } else {
    // Web mode: no local filesystem access — direct user to the export directory.
    alert('Open your export directory in VS Code:\n\ncode <your-export-dir>');
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

// addDefaults() — preserved for manual dev/test use only.
// NOT called automatically. New and cold-start both begin with a blank canvas.
// To populate a sample layout for development, call addDefaults() from the console.
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

// Initialize immediately if DOM is already loaded (module script case),
// or wait for DOMContentLoaded if still parsing (inline script case).
// This handles the race condition where <script type="module"> loads after DOMContentLoaded has fired.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
