// ==== EVENTS FOR BUTTONS / CONTROLS ====
import { gridA, gridB, activeGrid } from './grid-context.js';
import { isAuthed } from './auth.js';
import { start, stop, ensureAudio, setMode, addTickObserver } from './noteplayer.js';
import { renderAllMeasures, invertRange, invertFollowing, setDualGrid } from './notegrid.js';
import { TransportRegistry, TransportUI } from './transport-ui.js';
import {
  dbSavePattern, dbDeletePattern, dbRenamePattern, dbLoadPatternByName,
  serializePattern, applyPattern, getSavedPatterns, setSavedPatterns,
  getSelectedPatternName, refreshPatternSelect, updatePatternButtons, ensureHasSelection,
  LAST_USED_KEY, hasUnsavedChanges
} from './pattern-crud.js';
import { setPresentation } from './presentation-mode.js';
import { getRange } from './range-selection.js';
import { editHandsMode, setEditHandsMode } from './state.js';
import { updateUserGridLabelNotation } from './profile.js';
import { HistoryManager } from './history.js';

const patternSelect = document.getElementById('patternSelect');
const gridBtn = document.getElementById('gridBtn');
const handBtn = document.getElementById('handBtn');
const themeBtn = document.getElementById('themeBtn');
const presentBtn = document.getElementById('presentBtn');
const exitPresent = document.getElementById('exitPresent');
const metroBtn = document.getElementById('metroBtn');
const micBtn = document.getElementById('micBtn');
const saveBtn = document.getElementById('saveBtn');
const loadBtn = document.getElementById('loadBtn');
const renameBtn = document.getElementById('renameBtn');
const deleteBtn = document.getElementById('deleteBtn');
const exportBtn = document.getElementById('exportBtn');
const importBtn = document.getElementById('importBtn');

if (patternSelect) {
  patternSelect.addEventListener('change', updatePatternButtons);
}

// Dropdown Logic
const dropdownBtn = document.getElementById('fileDropdownBtn');
const dropdownMenu = document.getElementById('fileDropdownMenu');
const micDropdownMenu = document.getElementById('micDropdownMenu');

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

setupDropdown(dropdownBtn, dropdownMenu);
setupDropdown(micBtn, micDropdownMenu);

// Close dropdown when clicking outside
window.addEventListener('click', (e) => {
  if (dropdownBtn && dropdownMenu && !dropdownBtn.contains(e.target) && !dropdownMenu.contains(e.target)) {
    dropdownMenu.classList.remove('show');
  }
  if (micBtn && micDropdownMenu && !micBtn.contains(e.target) && !micDropdownMenu.contains(e.target)) {
    micDropdownMenu.classList.remove('show');
  }
});

function setupGridControls(ctx) {
  const pBtn = ctx.playBtn;
  const bInput = ctx.bpmInput;
  const bVal = document.getElementById(`bpmVal-${ctx.id}`);
  const mBtn = ctx.muteBtn;

  if (pBtn) {
    pBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // We don't generally change activeGrid on playback toggle unless clicked inside grid, but it's okay.
      // window.activeGrid = ctx; // Removed global assignment
      if (ctx.playing) stop(ctx);
      else start(ctx);
    });
  }

  if (bInput) {
    bInput.addEventListener('mousedown', () => {
      // window.activeGrid = ctx;
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
    // window.activeGrid = ctx;
    if (HistoryManager) HistoryManager.pushState();
    const s = ctx.stepsPerMeasure;
    ctx.innerLabels = Array(ctx.measures * s).fill('');
    ctx.innerHands = Array(ctx.measures * s).fill(null);
    renderAllMeasures(ctx);
    ctx.step = 0;
  });

  if (mBtn) {
    mBtn.addEventListener('click', () => {
      // window.activeGrid = ctx;
      ctx.isMuted = !ctx.isMuted;
      mBtn.classList.toggle('muted', ctx.isMuted);
      mBtn.textContent = ctx.isMuted ? '🔇' : '🔊';
    });
  }
}

setupGridControls(gridA);
setupGridControls(gridB);

document.getElementById('dualModeBtn')?.addEventListener('click', () => {
  const visible = document.getElementById('measures-B').style.display !== 'none';
  setDualGrid(!visible);
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (gridA.playing) stop(gridA);
    if (gridB.playing) stop(gridB);
  }
});

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

// Sticking Mode
const stickingBtn = document.getElementById('stickingBtn');
const flipHandsBtn = document.getElementById('flipHandsBtn');

if (stickingBtn) {
  stickingBtn.addEventListener('click', () => {
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
}

if (flipHandsBtn) {
  flipHandsBtn.addEventListener('click', () => {
    const r = (typeof getRange === 'function') ? getRange() : null;

    if (r) {
      if (HistoryManager) HistoryManager.pushState();
      invertRange(r.start, r.end);
    } else {
      // Fallback to Flip Following from Caret
      const idx = activeGrid.caretIndex ?? 0;
      if (HistoryManager) HistoryManager.pushState();
      invertFollowing(idx);
    }

    if (navigator.vibrate) navigator.vibrate([50, 50, 50]);
  });
}

themeBtn?.addEventListener('click', () => {
  document.body.classList.toggle('dark');
  localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
});

presentBtn?.addEventListener('click', () => {
  const on = !document.body.classList.contains('present');
  if (setPresentation) {
    setPresentation(on);
  }
});

exitPresent?.addEventListener('click', () => setPresentation(false));

metroBtn?.addEventListener('click', () => {
  const ctx = activeGrid;
  ctx.metronomeOn = !ctx.metronomeOn;
  localStorage.setItem('groovepan_metro' + '-' + ctx.id, ctx.metronomeOn ? 'on' : 'off');
  if (TransportRegistry) TransportRegistry.updateAll(ctx);
  if (ctx.metronomeOn) ensureAudio();
});

function updateNotationUI() {
  const btn = document.getElementById('labelNotationBtn');
  if (!btn) return;
  btn.textContent = (window.labelNotation === 'musical') ? '1 2 3' : '1 & 2';
  btn.title = (window.labelNotation === 'musical') ? 'Switch to Numeric Notation' : 'Switch to Musical Notation';
}
updateNotationUI();

document.getElementById('labelNotationBtn')?.addEventListener('click', () => {
  window.labelNotation = (window.labelNotation === 'musical') ? 'numeric' : 'musical';
  localStorage.setItem('labelNotation', window.labelNotation);
  updateNotationUI();
  updateNotationUI();
  renderAllMeasures(gridA);
  renderAllMeasures(gridB);

  // Persist to profile if signed in
  if (typeof updateUserGridLabelNotation === 'function') {
    updateUserGridLabelNotation(window.labelNotation);
  }
});

saveBtn?.addEventListener('click', async () => {
  const defaultName = `Pattern ${new Date().toLocaleString()}`;
  window.focus();
  const name = prompt('Save pattern as:', getSelectedPatternName() || defaultName);
  if (!name) return;

  saveCurrentPatternAs(name);
});

export async function saveCurrentPatternAs(name) {
  if (!name) return false;

  const trimmed = String(name || '').trim();
  if (!trimmed) return false;

  try {
    if (await isAuthed()) {
      await dbSavePattern(trimmed, serializePattern());
      localStorage.setItem(LAST_USED_KEY, trimmed);
      await refreshPatternSelect(trimmed);
      return;
    }

    // local fallback
    const saved = getSavedPatterns();
    saved[trimmed] = serializePattern();
    localStorage.setItem(LAST_USED_KEY, trimmed);
    setSavedPatterns(saved);
    await refreshPatternSelect(trimmed);
    return true;
  } catch (err) {
    console.error(err);
    alert(`Save failed: ${err?.message || err}`);
  }
}

export async function loadPatternByName(pattern) {
  try {
    // CLOUD MODE
    if (await isAuthed()) {
      if (!pattern) {
        alert('Select a saved pattern first.');
        return;
      }
      const state = await dbLoadPatternByName(pattern);
      if (!state) {
        alert('Could not load that pattern.');
        return;
      }
      applyPattern(state);
      localStorage.setItem(LAST_USED_KEY, pattern);
      return;
    }

    // LOCAL MODE
    const saved = getSavedPatterns();
    const names = Object.keys(saved);
    if (names.length === 0) {
      alert('No saved patterns yet. Click Save to store one.');
      return;
    }

    let name = pattern || getSelectedPatternName();
    if (!name) {
      const lastUsed = localStorage.getItem(LAST_USED_KEY) || '';
      name = (lastUsed && saved[lastUsed]) ? lastUsed : names.sort((a, b) => a.localeCompare(b))[0];
      patternSelect.value = name;
      updatePatternButtons();
    }

    if (!saved[name]) return;
    applyPattern(saved[name]);
    localStorage.setItem(LAST_USED_KEY, name);

    // Sync presentation view (handled by observers now)
    // Note: older code had manual update check here.
  } catch (err) {
    console.error(err);
    alert(`Load failed: ${err?.message || err}`);
  }
}

loadBtn?.addEventListener('click', async () => {
  const selected = getSelectedPatternName();
  loadPatternByName(selected);
});

renameBtn?.addEventListener('click', async () => {
  if (!ensureHasSelection()) return;

  const oldName = getSelectedPatternName();
  window.focus();
  const nextName = prompt('Rename pattern to:', oldName);
  if (!nextName) return;

  const trimmed = nextName.trim();
  if (!trimmed || trimmed === oldName) return;

  try {
    if (await isAuthed()) {
      await dbRenamePattern(oldName, trimmed);
      localStorage.setItem(LAST_USED_KEY, trimmed);
      await refreshPatternSelect(trimmed);
      return;
    }

    // local
    const saved = getSavedPatterns();
    if (!saved[oldName]) return;

    if (saved[trimmed]) {
      const ok = confirm('A pattern with that name already exists. Overwrite it?');
      if (!ok) return;
    }

    saved[trimmed] = saved[oldName];
    delete saved[oldName];
    localStorage.setItem(LAST_USED_KEY, trimmed);
    setSavedPatterns(saved);
    await refreshPatternSelect(trimmed);
  } catch (err) {
    console.error(err);
    alert(`Rename failed: ${err?.message || err}`);
  }
});

// Custom Confirmation Modal Logic
const confirmModal = document.getElementById('confirmModal');
const confirmTitle = document.getElementById('confirmTitle');
const confirmMessage = document.getElementById('confirmMessage');
const confirmOkBtn = document.getElementById('confirmOkBtn');
const confirmCancelBtn = document.getElementById('confirmCancelBtn');
let confirmCallback = null;

function showConfirm(title, message, onConfirm) {
  if (!confirmModal) {
    if (confirm(message)) onConfirm();
    return;
  }
  confirmTitle.textContent = title;
  confirmMessage.textContent = message;
  confirmCallback = onConfirm;

  confirmModal.classList.add('open');
  confirmModal.setAttribute('aria-hidden', 'false');
  confirmOkBtn.focus();
}

function closeConfirmModal() {
  if (confirmModal) {
    confirmModal.classList.remove('open');
    confirmModal.setAttribute('aria-hidden', 'true');
  }
  confirmCallback = null;
}

confirmCancelBtn?.addEventListener('click', closeConfirmModal);
confirmOkBtn?.addEventListener('click', () => {
  if (confirmCallback) confirmCallback();
  closeConfirmModal();
});
confirmModal?.addEventListener('click', (e) => {
  if (e.target === confirmModal) closeConfirmModal();
});


deleteBtn?.addEventListener('click', (e) => {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }

  const menu = document.getElementById('fileDropdownMenu');
  if (menu) menu.classList.remove('show');

  setTimeout(() => {
    if (!ensureHasSelection()) return;

    const name = getSelectedPatternName();

    showConfirm(
      'Delete Pattern',
      `Are you sure you want to delete "${name}"? This cannot be undone.`,
      async () => {
        try {
          if (await isAuthed()) {
            await dbDeletePattern(name);
            if (localStorage.getItem(LAST_USED_KEY) === name) localStorage.removeItem(LAST_USED_KEY);
            await refreshPatternSelect();
            return;
          }

          // local
          const saved = getSavedPatterns();
          if (!saved[name]) return;

          delete saved[name];
          setSavedPatterns(saved);
          if (localStorage.getItem(LAST_USED_KEY) === name) localStorage.removeItem(LAST_USED_KEY);
          await refreshPatternSelect();
        } catch (err) {
          console.error(err);
          alert(`Delete failed: ${err?.message || err}`);
        }
      }
    );
  }, 50);
});


exportBtn?.addEventListener('click', async () => {
  const data = JSON.stringify(serializePattern(), null, 2);
  try {
    await navigator.clipboard.writeText(data);
    alert('Pattern JSON copied to clipboard.');
  } catch {
    prompt('Copy this JSON:', data);
  }
});

importBtn?.addEventListener('click', async () => {
  if (hasUnsavedChanges()) {
    if (!confirm('You have unsaved changes. Discard them?')) return;
  }

  const raw = prompt('Paste pattern JSON here:');
  if (!raw) return;
  try {
    const obj = JSON.parse(raw);
    applyPattern(obj);

    const wantSave = confirm('Loaded! Save this pattern to your list?');
    if (wantSave) {
      const suggested = obj.name || `Imported ${new Date().toLocaleString()}`;
      const name = prompt('Save imported pattern as:', suggested);
      if (name) {
        if (await isAuthed()) {
          await dbSavePattern(name, obj);
          await refreshPatternSelect(name);
        } else {
          const saved = getSavedPatterns();
          saved[name] = obj;
          setSavedPatterns(saved);
          await refreshPatternSelect(name);
        }
      }
    }
  } catch {
    alert('That did not parse as JSON.');
  }
});

// === VIRTUAL PLAYBACK CONTROLS ===
export function setupAllTransports() {
  const containers = document.querySelectorAll('.transport-container');
  const template = document.getElementById('transport-template');
  if (!template) return;

  containers.forEach(container => {
    container.innerHTML = '';
    const clone = template.content.cloneNode(true);
    container.appendChild(clone);
    const gridId = container.dataset.grid || 'A';
    const ctx = (gridId === 'B') ? gridB : gridA;
    new TransportUI(ctx, container);
  });
}

// Sync function (Legacy compatibility or triggered broadcast)
export function syncVirtualHandpanControls() {
  TransportRegistry.updateAll(gridA);
}

// Subscribe to Tick to sync UI
addTickObserver((ctx, notes, hands) => {
  if (ctx) TransportRegistry.updateAll(ctx);
  else TransportRegistry.updateAll(gridA);
});

// Init Transports
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupAllTransports);
} else {
  setupAllTransports();
}