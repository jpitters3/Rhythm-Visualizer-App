// ==== EVENTS FOR BUTTONS / CONTROLS ====
import { gridA, gridB, activeGrid } from './grid-context.js';
import { isAuthed, openAuthModal } from './auth.js';
import { openWelcomeDashboard } from './dashboard.js';
import { start, stop, addTickObserver } from './noteplayer.js';
import { renderAllMeasures, invertRange, invertFollowing, setDualGrid, clearGrid, resetGridToDefault } from './notegrid.js';
import { TransportRegistry, TransportUI } from './transport-ui.js';
import {
  dbSavePattern, dbDeletePattern, dbRenamePattern, dbLoadPatternByName, dbListPatternNames,
  serializePattern, applyPattern, getSavedPatterns, setSavedPatterns,
  getSelectedPatternName, refreshPatternSelect, updatePatternButtons, ensureHasSelection,
  LAST_USED_KEY, hasUnsavedChanges, syncPhraseNameDisplay
} from './pattern-crud.js';
import { setPresentation } from './presentation-mode.js';
import { getRange } from './range-selection.js';
import { exportAudioWav } from './audio-export.js';
import { editHandsMode, setEditHandsMode, labelNotation, setLabelNotation } from './state.js';
import { updateUserGridLabelNotation } from './profile.js';
import { HistoryManager } from './history.js';
import { canAccess, FEATURE } from './gated-feature.js';
import { alert, confirm, prompt } from './alert.js';
import { Bus, BUS_EVENT } from './bus.js';
import { Modal } from './modal.js';
import { escapeHtml } from './utils.js';

// Global references assigned in initControls
let patternSelect, handBtn, resetBtn, themeBtn, presentBtn, exitPresent, micBtn, saveBtn, renameBtn, deleteBtn, exportBtn, navDashboardBtn, importBtn, loadBtn;

/**
 * @deprecated Use alert, confirm, prompt from ./alert.js instead
 */
export async function showCustomModal({ title, message, mode = 'confirm', defaultValue = '' }) {
  if (mode === 'alert') return await alert(message, title);
  if (mode === 'prompt') return await prompt(message, defaultValue, title);
  return await confirm(message, title);
}

function closeConfirmModal() {
  // Obsolete but kept for potential legacy references during transition
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

  document.getElementById(`clearBtn-${ctx.id}`)?.addEventListener('click', async () => {
    if (await confirm('Are you sure you want to clear the grid?')) {
      clearGrid(ctx);
    }
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

export async function createNewPhrase() {
  if (hasUnsavedChanges()) {
    const ok = await confirm('You have unsaved changes. Discard and start a new phrase?');
    if (!ok) return false;
  }
  const name = await prompt('Name your new phrase:', 'Untitled');
  if (!name?.trim()) return false;
  resetGridToDefault(gridA);
  await saveCurrentPatternAs(name.trim());
  return true;
}

/**
 * Main Save Logic with Gating
 */
export async function saveCurrentPatternAs(name, source = 'manual') {
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

    await dbSavePattern(trimmed, serializePattern(), source);
    localStorage.setItem(LAST_USED_KEY, trimmed);
    await refreshPatternSelect(trimmed);
    updateCurrentPhraseName(trimmed);
    Bus.emit(BUS_EVENT.GRID_CHANGED);
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
      await applyPattern(state);
      localStorage.setItem(LAST_USED_KEY, pattern);
      updateCurrentPhraseName(pattern);
      return;
    }

    // LOCAL MODE (Fallback)
    const saved = getSavedPatterns();
    const names = Object.keys(saved);
    if (names.length === 0) return;

    let name = pattern || getSelectedPatternName();
    if (!name) return;

    if (!saved[name]) return;
    await applyPattern(saved[name]);
    localStorage.setItem(LAST_USED_KEY, name);
    updateCurrentPhraseName(name);
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

function closeAccountDropdown() {
  document.getElementById('accountDropdownMenu')?.classList.remove('show');
  document.getElementById('phraseSubmenu')?.classList.remove('open');
  const btn = document.getElementById('phraseMenuBtn');
  if (btn) btn.textContent = '📂 Phrase ▾';
  document.getElementById('adminSubmenu')?.classList.remove('open');
  const adminBtn = document.getElementById('adminMenuBtn');
  if (adminBtn) adminBtn.textContent = '⚙️ Admin Tools ▾';
}

export function updateCurrentPhraseName(name) {
  syncPhraseNameDisplay(name);
}

async function showOpenPhraseModal() {
  const overlayEl = document.getElementById('openPhraseModal');
  if (!overlayEl) return;

  const modal = new Modal(overlayEl);
  overlayEl.querySelector('.close-modal-btn')?.addEventListener('click', () => modal.close(), { once: true });

  const listEl = document.getElementById('phraseList');
  const searchInput = document.getElementById('phraseSearchInput');
  if (searchInput) searchInput.value = '';

  listEl.innerHTML = '<div class="phrase-list-loading">Loading…</div>';
  modal.open();
  if (searchInput) searchInput.focus();

  try {
    let names = [];
    if (await isAuthed()) {
      names = await dbListPatternNames();
    } else {
      const saved = getSavedPatterns();
      names = Object.keys(saved).sort((a, b) => a.localeCompare(b));
    }

    const current = getSelectedPatternName();

    function renderList(filter = '') {
      const filtered = filter
        ? names.filter(n => n.toLowerCase().includes(filter.toLowerCase()))
        : names;

      listEl.innerHTML = '';

      if (names.length === 0) {
        listEl.innerHTML = '<div class="phrase-list-empty"><span>No saved phrases yet.</span></div>';
        return;
      }

      if (filtered.length === 0) {
        listEl.innerHTML = '<div class="phrase-list-empty"><span>No matches.</span></div>';
        return;
      }

      filtered.forEach(name => {
        const isCurrent = name === current;
        const btn = document.createElement('button');
        btn.className = 'phrase-list-item' + (isCurrent ? ' current' : '');
        btn.innerHTML = `
          <svg class="phrase-item-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
          <span class="phrase-item-name">${escapeHtml(name)}</span>
          ${isCurrent ? '<span class="phrase-item-badge">open</span>' : ''}
        `;
        btn.addEventListener('click', async () => {
          modal.close();
          if (hasUnsavedChanges()) {
            const ok = await confirm('You have unsaved changes. Discard and open this phrase?');
            if (!ok) return;
          }
          await loadPatternByName(name);
          updateCurrentPhraseName(name);
          updatePatternButtons();
        });
        listEl.appendChild(btn);
      });
    }

    renderList();

    if (searchInput) {
      searchInput.addEventListener('input', () => renderList(searchInput.value), { signal: modal.el._abortController?.signal });
      searchInput.addEventListener('keydown', e => {
        if (e.key === 'Escape') modal.close();
      });
    }

  } catch (err) {
    listEl.innerHTML = `<div class="phrase-list-empty" style="color:var(--danger,#e74c3c);">Failed to load: ${escapeHtml(err.message)}</div>`;
  }
}

/**
 * Initialize all controls and listeners
 */
export function initControls() {
  // 1. Get Elements
  patternSelect = document.getElementById('patternSelect');

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

  setupGridControls(gridA);
  setupGridControls(gridB);

  // Quick-save button
  const quickSaveBtn = document.getElementById('quickSaveBtn');
  if (quickSaveBtn) {
    const updateQuickSave = () => {
      quickSaveBtn.classList.toggle('visible', hasUnsavedChanges() && !!getSelectedPatternName());
    };
    Bus.on(BUS_EVENT.GRID_CHANGED, updateQuickSave);
    Bus.on(BUS_EVENT.GRID_RENDERED, updateQuickSave);
    quickSaveBtn.addEventListener('click', () => {
      saveBtn?.click();
    });
  }

  confirmModal?.addEventListener('click', (e) => {
    if (e.target === confirmModal) closeConfirmModal();
  });

  // 2. Dropdown Setup
  const micDropdownMenu = document.getElementById('micDropdownMenu');
  setupDropdown(micBtn, micDropdownMenu);

  // Close dropdowns on outside click
  window.addEventListener('click', (e) => {
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
        updateCurrentPhraseName(selected);
        updatePatternButtons();
      }
    } else {
      await loadPatternByName(selected);
      updateCurrentPhraseName(selected);
      updatePatternButtons();
    }
  });

  // 5. Save / Load / Rename / Delete
  saveBtn?.addEventListener('click', async (e) => {
    if (e) e.stopPropagation();

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

    const defaultName = `Phrase ${new Date().toLocaleString()}`;
    const name = await showCustomModal({
      title: 'Save Phrase',
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

  // Phrase Menu Toggle
  document.getElementById('phraseMenuBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const submenu = document.getElementById('phraseSubmenu');
    const btn = document.getElementById('phraseMenuBtn');
    if (!submenu) return;
    const isOpen = submenu.classList.contains('open');
    submenu.classList.toggle('open', !isOpen);
    if (btn) btn.textContent = isOpen ? '📂 Phrase ▾' : '📂 Phrase ▴';
  });

  // Close phrase submenu when account dropdown closes
  document.getElementById('accountBtn')?.addEventListener('click', () => {
    // Reset submenu state when dropdown closes (handled via accountDropdownMenu hide)
  });

  // New Phrase
  document.getElementById('newPhraseBtn')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    closeAccountDropdown();
    await createNewPhrase();
  });


  // Open Phrase
  document.getElementById('openPhraseBtn')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    closeAccountDropdown();
    await showOpenPhraseModal();
  });

  // Close submenus when account dropdown is closed (outside click)
  document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('accountDropdownMenu');
    if (!dropdown?.classList.contains('show')) {
      document.getElementById('phraseSubmenu')?.classList.remove('open');
      const btn = document.getElementById('phraseMenuBtn');
      if (btn) btn.textContent = '📂 Phrase ▾';
      document.getElementById('adminSubmenu')?.classList.remove('open');
      const adminBtn = document.getElementById('adminMenuBtn');
      if (adminBtn) adminBtn.textContent = '⚙️ Admin Tools ▾';
    }
  });

  renameBtn?.addEventListener('click', async (e) => {
    if (e) e.stopPropagation();

    if (!await ensureHasSelection()) return;

    const oldName = document.getElementById('currentPhraseName')?.textContent?.trim() || getSelectedPatternName();
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
        updateCurrentPhraseName(trimmed);
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
        updateCurrentPhraseName(trimmed);
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

    if (!await ensureHasSelection()) return;

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
      await applyPattern(obj);
      updateCurrentPhraseName(obj.name || 'Imported');

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

  // 6. Generic Controls — tsBeats / tsSub listeners are wired in initNotePlayer

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

  presentBtn?.addEventListener('click', async () => {
    const on = !document.body.classList.contains('present');
    await setPresentation(on);
  });

  exitPresent?.addEventListener('click', async () => await setPresentation(false));

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

  navDashboardBtn?.addEventListener('click', () => openWelcomeDashboard());

  // eslint-disable-next-line no-unused-vars
  async function openLegacyDashboard() {
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
  }

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