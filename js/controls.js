// ==== EVENTS FOR BUTTONS / CONTROLS ====
import { gridA, gridB, activeGrid } from './grid-context.js';
import { isAuthed, openAuthModal } from './auth.js';
import { start, stop, ensureAudio, unlockAudio, setMode, addTickObserver } from './noteplayer.js';
import { renderAllMeasures, invertRange, invertFollowing, setDualGrid, clearGrid, resetGridToDefault } from './notegrid.js';
import { TransportRegistry, TransportUI } from './transport-ui.js';
import {
  dbSavePattern, dbDeletePattern, dbRenamePattern, dbLoadPatternByName, dbListPatternNames,
  serializePattern, applyPattern, getSavedPatterns, setSavedPatterns,
  getSelectedPatternName, refreshPatternSelect, updatePatternButtons, ensureHasSelection,
  LAST_USED_KEY, hasUnsavedChanges
} from './pattern-crud.js';
import { setPresentation } from './presentation-mode.js';
import { getRange } from './range-selection.js';
import { exportAudioWav } from './audio-export.js';
import { editHandsMode, setEditHandsMode, labelNotation, setLabelNotation } from './state.js';
import { updateUserGridLabelNotation } from './profile.js';
import { HistoryManager } from './history.js';
import { Bus, BUS_EVENT } from './bus.js';
import { canAccess, FEATURE } from './gated-feature.js';

// Global references assigned in initControls
let patternSelect, gridBtn, handBtn, resetBtn, themeBtn, presentBtn, exitPresent, micBtn, saveBtn, renameBtn, deleteBtn, exportBtn, navDashboardBtn, importBtn, loadBtn;

// Custom Confirmation Modal Logic
let confirmModal, confirmTitle, confirmMessage, confirmOkBtn, confirmCancelBtn, confirmInputWrapper, confirmInput;

/**
 * Promise-based Custom Modal
 * mode: 'alert', 'confirm', 'prompt'
 */
export function showCustomModal({ title, message, mode = 'confirm', defaultValue = '' }) {
  return new Promise((resolve) => {
    if (!confirmModal) {
      if (mode === 'alert') { alert(message); resolve(true); }
      else if (mode === 'prompt') { resolve(prompt(message, defaultValue)); }
      else { resolve(confirm(message)); }
      return;
    }

    confirmTitle.textContent = title || (mode === 'prompt' ? 'Input Required' : (mode === 'alert' ? 'Notification' : 'Confirm'));
    confirmMessage.textContent = message || '';
    
    confirmInputWrapper.style.display = (mode === 'prompt') ? 'block' : 'none';
    confirmCancelBtn.style.display = (mode === 'alert') ? 'none' : 'inline-block';
    
    if (mode === 'prompt') {
      confirmInput.value = defaultValue || '';
    }

    const onOk = () => {
      const val = (mode === 'prompt') ? confirmInput.value : true;
      cleanup();
      resolve(val);
    };

    const onCancel = () => {
      cleanup();
      resolve(mode === 'prompt' ? null : false);
    };

    const cleanup = () => {
      confirmOkBtn.removeEventListener('click', onOk);
      confirmCancelBtn.removeEventListener('click', onCancel);
      closeConfirmModal();
    };

    confirmOkBtn.addEventListener('click', onOk);
    confirmCancelBtn.addEventListener('click', onCancel);

    confirmModal.classList.add('open');
    confirmModal.setAttribute('aria-hidden', 'false');

    if (mode === 'prompt') {
      setTimeout(() => {
        confirmInput.focus();
        confirmInput.select();
      }, 50);
    } else {
      confirmOkBtn.focus();
    }
  });
}

function closeConfirmModal() {
  if (confirmModal) {
    confirmModal.classList.remove('open');
    confirmModal.setAttribute('aria-hidden', 'true');
  }
}

/**
 * Dropdown toggle helper
 */
function setupDropdown(btn, menu) {
  if (!btn || !menu) return;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.toggle('show');
  });

  // Auto-close when an item is clicked
  menu.addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
      menu.classList.remove('show');
    }
  });
}

function setupGridControls(ctx) {
  const pBtn = document.getElementById(`playBtn-${ctx.id}`);
  const bInput = document.getElementById(`bpm-${ctx.id}`);
  const bVal = document.getElementById(`bpmVal-${ctx.id}`);
  const mBtn = document.getElementById(`muteBtn-${ctx.id}`);

  if (pBtn) {
    pBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (ctx.playing) stop(ctx);
      else start(ctx);
    });
  }

  if (bInput) {
    bInput.addEventListener('mousedown', () => {
      if (HistoryManager) HistoryManager.pushState();
    });
    bInput.addEventListener('input', () => {
      ctx.bpm = parseInt(bInput.value);
      if (bVal) bVal.textContent = bInput.value;
      if (ctx.playing) {
        stop(ctx);
        start(ctx);
      }
    });
  }

  document.getElementById(`clearBtn-${ctx.id}`)?.addEventListener('click', () => {
    clearGrid(ctx);
  });

  if (mBtn) {
    mBtn.addEventListener('click', () => {
      ctx.isMuted = !ctx.isMuted;
      mBtn.classList.toggle('muted', ctx.isMuted);
      mBtn.textContent = ctx.isMuted ? '🔇' : '🔊';
    });
  }
}

function updateNotationUI() {
  const btn = document.getElementById('labelNotationBtn');
  if (!btn) return;
  btn.textContent = (labelNotation === 'musical') ? '1 2 3' : '1 & 2';
  btn.title = (labelNotation === 'musical') ? 'Switch to Numeric Notation' : 'Switch to Musical Notation';
}

/**
 * Main Save Logic with Gating
 */
export async function saveCurrentPatternAs(name) {
  if (!name) return false;

  const trimmed = String(name || '').trim();
  if (!trimmed) return false;

  try {
    // Check auth
    if (!(await isAuthed())) {
      await showCustomModal({
        title: 'Sign In Required',
        message: 'Please sign in or create an account to save patterns.',
        mode: 'alert'
      });
      openAuthModal();
      return false;
    }

    // PRO Gating: check count for NEW patterns
    const existingNames = await dbListPatternNames();
    const isNew = !existingNames.includes(trimmed);

    if (isNew && !canAccess(FEATURE.UNLIMITED_PATTERNS, { count: existingNames.length })) {
      Bus.emit(BUS_EVENT.SHOW_UPGRADE_MODAL, { 
        feature: FEATURE.UNLIMITED_PATTERNS, 
        featureId: 'feat-storage' 
      });
      return false;
    }

    await dbSavePattern(trimmed, serializePattern());
    localStorage.setItem(LAST_USED_KEY, trimmed);
    await refreshPatternSelect(trimmed);
    return true;
  } catch (err) {
    console.error(err);
    await showCustomModal({
      title: 'Save Failed',
      message: err?.message || err,
      mode: 'alert'
    });
    return false;
  }
}

/**
 * Main Load Logic
 */
export async function loadPatternByName(pattern) {
  try {
    // CLOUD MODE
    if (await isAuthed()) {
      if (!pattern) return;
      const state = await dbLoadPatternByName(pattern);
      if (!state) {
        await showCustomModal({
          title: 'Load Failed',
          message: 'Could not load that pattern.',
          mode: 'alert'
        });
        return;
      }
      applyPattern(state);
      localStorage.setItem(LAST_USED_KEY, pattern);
      return;
    }

    // LOCAL MODE (Fallback)
    const saved = getSavedPatterns();
    const names = Object.keys(saved);
    if (names.length === 0) return;

    let name = pattern || getSelectedPatternName();
    if (!name) return;

    if (!saved[name]) return;
    applyPattern(saved[name]);
    localStorage.setItem(LAST_USED_KEY, name);
  } catch (err) {
    console.error(err);
    await showCustomModal({
      title: 'Load Failed',
      message: err?.message || err,
      mode: 'alert'
    });
  }
}

/**
 * Checks if the grid has notes and shows/hides the export wrapper
 */
export function checkExportVisibility() {
  const container = document.getElementById('exportAudioWrapper');
  if (!container || !activeGrid || !activeGrid.innerLabels) return;

  const hasNotes = activeGrid.innerLabels.some(l => {
    if (Array.isArray(l)) return l.some(sub => sub !== '');
    return l !== '';
  });

  if (hasNotes) {
    container.style.display = 'block';
  } else {
    container.style.display = 'none';
  }
}

/**
 * Sync function (Legacy compatibility or triggered broadcast)
 */
export function syncVirtualHandpanControls() {
  TransportRegistry.updateAll(gridA);
}

/**
 * Initialize all controls and listeners
 */
export function initControls() {
  // 1. Get Elements
  patternSelect = document.getElementById('patternSelect');
  gridBtn = document.getElementById('gridBtn');
  handBtn = document.getElementById('handBtn');
  resetBtn = document.getElementById('resetBtn');
  themeBtn = document.getElementById('themeBtn');
  presentBtn = document.getElementById('presentBtn');
  exitPresent = document.getElementById('exitPresent');
  micBtn = document.getElementById('micBtn');
  saveBtn = document.getElementById('saveBtn');
  renameBtn = document.getElementById('renameBtn');
  deleteBtn = document.getElementById('deleteBtn');
  exportBtn = document.getElementById('exportBtn');
  navDashboardBtn = document.getElementById('navDashboardBtn');
  importBtn = document.getElementById('importBtn');
  loadBtn = document.getElementById('loadBtn');

  // Confirm Modal Elements
  confirmModal = document.getElementById('confirmModal');
  confirmTitle = document.getElementById('confirmTitle');
  confirmMessage = document.getElementById('confirmMessage');
  confirmOkBtn = document.getElementById('confirmOkBtn');
  confirmCancelBtn = document.getElementById('confirmCancelBtn');
  confirmInputWrapper = document.getElementById('confirmInputWrapper');
  confirmInput = document.getElementById('confirmInput');

  confirmModal?.addEventListener('click', (e) => {
    if (e.target === confirmModal) closeConfirmModal();
  });

  // 2. Dropdown Setup
  const fileDropdownBtn = document.getElementById('fileDropdownBtn');
  const fileDropdownMenu = document.getElementById('fileDropdownMenu');
  setupDropdown(fileDropdownBtn, fileDropdownMenu);

  const micDropdownMenu = document.getElementById('micDropdownMenu');
  setupDropdown(micBtn, micDropdownMenu);

  // Close dropdowns on outside click
  window.addEventListener('click', (e) => {
    if (fileDropdownBtn && fileDropdownMenu && !fileDropdownBtn.contains(e.target) && !fileDropdownMenu.contains(e.target)) {
      fileDropdownMenu.classList.remove('show');
    }
    if (micBtn && micDropdownMenu && !micBtn.contains(e.target) && !micDropdownMenu.contains(e.target)) {
      micDropdownMenu.classList.remove('show');
    }
  });

  // 3. Grid Controls
  setupGridControls(gridA);
  setupGridControls(gridB);

  document.getElementById('dualModeBtn')?.addEventListener('click', () => {
    const visible = document.getElementById('measures-B').style.display !== 'none';
    setDualGrid(!visible);
  });

  // 4. Pattern Select
  patternSelect?.addEventListener('change', async () => {
    const selected = getSelectedPatternName();
    if (!selected) return;

    if (hasUnsavedChanges()) {
      const ok = await showCustomModal({
        title: 'Unsaved Changes',
        message: 'You have unsaved changes. Discard them and load the new pattern?',
        mode: 'confirm'
      });
      if (ok) {
        await loadPatternByName(selected);
        updatePatternButtons();
      }
    } else {
      await loadPatternByName(selected);
      updatePatternButtons();
    }
  });

  // 5. Save / Load / Rename / Delete
  saveBtn?.addEventListener('click', async (e) => {
    if (e) e.stopPropagation();
    
    // Close dropdown
    if (fileDropdownMenu) fileDropdownMenu.classList.remove('show');

    // Auth Check BEFORE prompt
    if (!(await isAuthed())) {
      await showCustomModal({
        title: 'Sign In Required',
        message: 'Please sign in or create an account to save patterns.',
        mode: 'alert'
      });
      openAuthModal();
      return;
    }

    const defaultName = `Pattern ${new Date().toLocaleString()}`;
    const name = await showCustomModal({
      title: 'Save Pattern',
      message: 'Enter a name for your pattern:',
      mode: 'prompt',
      defaultValue: getSelectedPatternName() || defaultName
    });
    
    if (name) {
      await saveCurrentPatternAs(name);
    }
  });

  loadBtn?.addEventListener('click', async (e) => {
    if (e) e.stopPropagation();

    // Close dropdown
    if (fileDropdownMenu) fileDropdownMenu.classList.remove('show');

    const selected = getSelectedPatternName();
    if (!selected) {
      await showCustomModal({
        title: 'Notice',
        message: 'Please select a pattern to load.',
        mode: 'alert'
      });
      return;
    }

    if (hasUnsavedChanges()) {
      const ok = await showCustomModal({
        title: 'Unsaved Changes',
        message: 'You have unsaved changes. Discard them and load the new pattern?',
        mode: 'confirm'
      });
      if (ok) {
        await loadPatternByName(selected);
        updatePatternButtons();
      }
    } else {
      await loadPatternByName(selected);
      updatePatternButtons();
    }
  });

  renameBtn?.addEventListener('click', async (e) => {
    if (e) e.stopPropagation();

    // Close dropdown
    if (fileDropdownMenu) fileDropdownMenu.classList.remove('show');

    if (!ensureHasSelection()) return;

    const oldName = getSelectedPatternName();
    const nextName = await showCustomModal({
      title: 'Rename Pattern',
      message: `Enter new name for "${oldName}":`,
      mode: 'prompt',
      defaultValue: oldName
    });
    
    if (!nextName) return;

    const trimmed = nextName.trim();
    if (!trimmed || trimmed === oldName) return;

    try {
      if (await isAuthed()) {
        await dbRenamePattern(oldName, trimmed);
        localStorage.setItem(LAST_USED_KEY, trimmed);
        await refreshPatternSelect(trimmed);
      } else {
        // local
        const saved = getSavedPatterns();
        if (!saved[oldName]) return;

        if (saved[trimmed]) {
          const ok = await showCustomModal({
            title: 'Overwrite?',
            message: 'A pattern with that name already exists. Overwrite it?',
            mode: 'confirm'
          });
          if (!ok) return;
        }

        saved[trimmed] = saved[oldName];
        delete saved[oldName];
        localStorage.setItem(LAST_USED_KEY, trimmed);
        setSavedPatterns(saved);
        await refreshPatternSelect(trimmed);
      }
    } catch (err) {
      console.error(err);
      await showCustomModal({
        title: 'Rename Failed',
        message: err.message || err,
        mode: 'alert'
      });
    }
  });

  deleteBtn?.addEventListener('click', async (e) => {
    if (e) e.stopPropagation();

    // Close dropdown
    if (fileDropdownMenu) fileDropdownMenu.classList.remove('show');

    if (!ensureHasSelection()) return;

    const name = getSelectedPatternName();
    const ok = await showCustomModal({
      title: 'Delete Pattern',
      message: `Are you sure you want to delete "${name}"? This cannot be undone.`,
      mode: 'confirm'
    });

    if (ok) {
      try {
        if (await isAuthed()) {
          await dbDeletePattern(name);
          if (localStorage.getItem(LAST_USED_KEY) === name) localStorage.removeItem(LAST_USED_KEY);
          await refreshPatternSelect();
        } else {
          const saved = getSavedPatterns();
          if (!saved[name]) return;
          delete saved[name];
          setSavedPatterns(saved);
          if (localStorage.getItem(LAST_USED_KEY) === name) localStorage.removeItem(LAST_USED_KEY);
          await refreshPatternSelect();
        }
      } catch (err) {
        console.error(err);
        await showCustomModal({
          title: 'Delete Failed',
          message: err.message || err,
          mode: 'alert'
        });
      }
    }
  });

  exportBtn?.addEventListener('click', async (e) => {
    if (e) e.stopPropagation();

    // Close dropdown
    if (fileDropdownMenu) fileDropdownMenu.classList.remove('show');

    const data = JSON.stringify(serializePattern(), null, 2);
    try {
      await navigator.clipboard.writeText(data);
      await showCustomModal({
        title: 'Exported',
        message: 'Pattern JSON copied to clipboard.',
        mode: 'alert'
      });
    } catch {
      await showCustomModal({
        title: 'Copy JSON',
        message: 'Manually copy the following text:',
        mode: 'prompt',
        defaultValue: data
      });
    }
  });

  importBtn?.addEventListener('click', async (e) => {
    if (e) e.stopPropagation();

    // Close dropdown
    if (fileDropdownMenu) fileDropdownMenu.classList.remove('show');

    if (hasUnsavedChanges()) {
      const ok = await showCustomModal({
        title: 'Unsaved Changes',
        message: 'You have unsaved changes. Discard them and proceed with import?',
        mode: 'confirm'
      });
      if (!ok) return;
    }

    const raw = await showCustomModal({
      title: 'Import Pattern',
      message: 'Paste pattern JSON here:',
      mode: 'prompt'
    });
    
    if (!raw) return;

    try {
      const obj = JSON.parse(raw);
      applyPattern(obj);

      const wantSave = await showCustomModal({
        title: 'Import Success',
        message: 'Loaded! Save this pattern to your cloud list?',
        mode: 'confirm'
      });
      
      if (wantSave) {
        if (!(await isAuthed())) {
          await showCustomModal({
            title: 'Sign In Required',
            message: 'Please sign in or create an account to save patterns.',
            mode: 'alert'
          });
          openAuthModal();
          return;
        }
        const suggested = obj.name || `Imported ${new Date().toLocaleString()}`;
        const name = await showCustomModal({
          title: 'Save Imported Pattern',
          message: 'Enter a name for this pattern:',
          mode: 'prompt',
          defaultValue: suggested
        });
        
        if (name) {
          // PRO Gating: check count for NEW patterns
          const existingNames = await dbListPatternNames();
          const isNew = !existingNames.includes(name);

          if (isNew && !canAccess(FEATURE.UNLIMITED_PATTERNS, { count: existingNames.length })) {
            Bus.emit(BUS_EVENT.SHOW_UPGRADE_MODAL, { 
              feature: FEATURE.UNLIMITED_PATTERNS, 
              featureId: 'feat-storage' 
            });
            return;
          }

          await dbSavePattern(name, obj);
          await refreshPatternSelect(name);
        }
      }
    } catch {
      await showCustomModal({
        title: 'Error',
        message: 'That did not parse as valid JSON.',
        mode: 'alert'
      });
    }
  });

  // 6. Generic Controls
  gridBtn?.addEventListener('click', () => {
    const ctx = activeGrid;
    setMode(ctx.mode === '8' ? '16' : '8', ctx);
  });

  handBtn?.addEventListener('click', () => {
    const on = !document.body.classList.contains('handSplit');
    document.body.classList.toggle('handSplit', on);
    localStorage.setItem('handSplit', on ? 'on' : 'off');
    handBtn.classList.toggle('active', on);
    handBtn.textContent = on ? 'Left/Right: On' : 'Left/Right: Off';
  });

  resetBtn?.addEventListener('click', async () => {
    if (hasUnsavedChanges()) {
      const ok = await showCustomModal({
        title: 'Unsaved Changes',
        message: 'Discard changes and reset?',
        mode: 'confirm'
      });
      if (ok) resetGridToDefault(activeGrid);
    } else {
      resetGridToDefault(activeGrid);
    }
  });

  themeBtn?.addEventListener('click', () => {
    document.body.classList.toggle('dark');
    localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
  });

  presentBtn?.addEventListener('click', () => {
    const on = !document.body.classList.contains('present');
    setPresentation(on);
  });

  exitPresent?.addEventListener('click', () => setPresentation(false));

  const labelNotationBtn = document.getElementById('labelNotationBtn');
  labelNotationBtn?.addEventListener('click', () => {
    const newVal = (labelNotation === 'musical') ? 'numeric' : 'musical';
    setLabelNotation(newVal);
    updateNotationUI();
    renderAllMeasures(gridA);
    renderAllMeasures(gridB);
    if (typeof updateUserGridLabelNotation === 'function') {
      updateUserGridLabelNotation(newVal);
    }
  });

  document.addEventListener('labelNotationChanged', (e) => {
    const newVal = e.detail;
    if (newVal && newVal !== labelNotation) {
      setLabelNotation(newVal);
      updateNotationUI();
      renderAllMeasures(gridA);
      renderAllMeasures(gridB);
    }
  });

  navDashboardBtn?.addEventListener('click', async () => {
    if (hasUnsavedChanges()) {
      const ok = await showCustomModal({
        title: 'Unsaved Changes',
        message: 'Discard changes and return to dashboard?',
        mode: 'confirm'
      });
      if (ok) window.location.hash = '#dashboard';
    } else {
      window.location.hash = '#dashboard';
    }
  });

  // 7. Sticking Mode
  const stickingBtn = document.getElementById('stickingBtn');
  const flipHandsBtn = document.getElementById('flipHandsBtn');
  stickingBtn?.addEventListener('click', () => {
    setEditHandsMode(!editHandsMode);
    stickingBtn.classList.toggle('active', editHandsMode);
    if (editHandsMode) {
      document.body.dataset.cursor = 'hand';
      if (flipHandsBtn) flipHandsBtn.style.display = 'inline-block';
    } else {
      delete document.body.dataset.cursor;
      if (flipHandsBtn) flipHandsBtn.style.display = 'none';
    }
  });

  flipHandsBtn?.addEventListener('click', () => {
    const r = getRange();
    if (HistoryManager) HistoryManager.pushState();
    if (r) invertRange(r.start, r.end);
    else invertFollowing(activeGrid.caretIndex || 0);
  });

  // 8. Transports Logic
  const setupAllTransports = () => {
    const containers = document.querySelectorAll('.transport-container');
    const template = document.getElementById('transport-template');
    if (!template) return;
    containers.forEach(container => {
      if (container.querySelector('.t-play-btn')) return;
      const clone = template.content.cloneNode(true);
      container.appendChild(clone);
      const gridId = container.dataset.grid || 'A';
      const ctx = (gridId === 'B') ? gridB : gridA;
      new TransportUI(ctx, container);
    });
  };

  setupAllTransports();

  addTickObserver((ctx) => {
    TransportRegistry.updateAll(ctx || gridA);
  });

  document.addEventListener('playbackStateChange', (e) => {
    const ctx = e.detail?.grid || gridA;
    TransportRegistry.updateAll(ctx);
  });

  // 9. Export Audio
  const exportAudioBtn = document.getElementById('exportAudioBtn');
  exportAudioBtn?.addEventListener('click', async () => {
    if (!canAccess(FEATURE.DOWNLOAD_WAV)) {
      Bus.emit(BUS_EVENT.SHOW_UPGRADE_MODAL, { 
        feature: FEATURE.DOWNLOAD_WAV, 
        featureId: 'feat-audio' 
      });
      return;
    }
    const originalHtml = exportAudioBtn.innerHTML;
    exportAudioBtn.disabled = true;
    exportAudioBtn.innerHTML = '⏳ Rendering...';
    try {
      const blob = await exportAudioWav();
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const name = patternSelect?.value || 'Pattern';
        a.download = `${name}.wav`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error(err);
      await showCustomModal({
        title: 'Export Error',
        message: err.message || err,
        mode: 'alert'
      });
    } finally {
      exportAudioBtn.disabled = false;
      exportAudioBtn.innerHTML = originalHtml;
    }
  });

  updateNotationUI();
  updatePatternButtons();
}