// ==== EVENTS FOR BUTTONS / CONTROLS ====

patternSelect.addEventListener('change', updatePatternButtons);
vLessonPlayBtn = document.getElementById('vLessonPlayBtn');

const getReal = (id) => document.getElementById(id);

// Dropdown Logic
// Dropdown Logic
const dropdownBtn = document.getElementById('fileDropdownBtn');
const dropdownMenu = document.getElementById('fileDropdownMenu');

// Mic Dropdown
const micDropdownMenu = document.getElementById('micDropdownMenu');

function setupDropdown(btn, menu) {
  if (!btn || !menu) return;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.toggle('show');
  });

  // Auto-close when an item is clicked
  menu.addEventListener('click', (e) => {
    // If the clicked element is a button or inside one
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
      window.activeGrid = ctx;
      if (ctx.playing) stop(ctx);
      else start(ctx);
    });
  }

  if (bInput) {
    bInput.addEventListener('mousedown', () => {
      window.activeGrid = ctx;
      if (window.HistoryManager) window.HistoryManager.pushState();
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
    window.activeGrid = ctx;
    if (window.HistoryManager) window.HistoryManager.pushState();
    const s = getStepCountPerMeasure(ctx);
    ctx.innerLabels = Array(ctx.measures * s).fill('');
    ctx.innerHands = Array(ctx.measures * s).fill(null);
    if (ctx.id === 'A') window.innerLabels = ctx.innerLabels;
    renderAllMeasures(ctx);
    ctx.step = 0;
  });

  if (mBtn) {
    mBtn.addEventListener('click', () => {
      window.activeGrid = ctx;
      ctx.isMuted = !ctx.isMuted;
      mBtn.classList.toggle('muted', ctx.isMuted);
      mBtn.textContent = ctx.isMuted ? '🔇' : '🔊';
    });
  }
}

setupGridControls(window.gridA);
setupGridControls(window.gridB);

// Dual Mode Toggle
function setDualGrid(next) {
  const mB = document.getElementById('measures-B');
  const cB = document.getElementById('controls-B');
  const btn = document.getElementById('dualModeBtn');
  if (!mB || !cB || !btn) return;

  mB.style.display = next ? 'block' : 'none';
  cB.style.display = next ? 'flex' : 'none';
  btn.classList.toggle('active', next);

  if (next) {
    // Initialize Grid B if it's empty
    if (window.gridB.innerLabels.length === 0) {
      const s = (typeof getStepCountPerMeasure === 'function') ? getStepCountPerMeasure() : 16;
      window.gridB.innerLabels = Array(window.gridA.measures * s).fill('');
      window.gridB.innerHands = Array(window.gridA.measures * s).fill(null);
    }
    renderAllMeasures(window.gridB);
  } else {
    // Stop Grid B if we are disabling dual mode
    if (typeof stop === 'function') stop(window.gridB, false);
    if (window.TransportRegistry) window.TransportRegistry.updateAll(window.gridB);
  }
}

window.setDualGrid = setDualGrid;

document.getElementById('dualModeBtn')?.addEventListener('click', () => {
  const visible = document.getElementById('measures-B').style.display !== 'none';
  setDualGrid(!visible);
});

// If the tab is hidden, stop both
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (window.gridA.playing) stop(window.gridA);
    if (window.gridB.playing) stop(window.gridB);
  }
});

gridBtn.addEventListener('click', () => {
  const ctx = window.activeGrid;
  setMode(ctx.mode === '8' ? '16' : '8', ctx);
});

handBtn.addEventListener('click', () => {
  const on = !document.body.classList.contains('handSplit');
  document.body.classList.toggle('handSplit', on);
  localStorage.setItem('handSplit', on ? 'on' : 'off');

  handBtn.classList.toggle('active', on);
  handBtn.textContent = on ? 'Left/Right: On' : 'Left/Right: Off';
});

// Sticking Mode (Mobile Friendly)
window.editHandsMode = false;
const stickingBtn = document.getElementById('stickingBtn');
const flipHandsBtn = document.getElementById('flipHandsBtn');

if (stickingBtn) {
  stickingBtn.addEventListener('click', () => {
    window.editHandsMode = !window.editHandsMode;
    stickingBtn.classList.toggle('active', window.editHandsMode);

    if (window.editHandsMode) {
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
    // 1. Check for Range Selection
    const r = (typeof getRange === 'function') ? getRange() : null;

    if (r && window.invertRange) {
      if (window.HistoryManager) window.HistoryManager.pushState();
      window.invertRange(r.start, r.end);
    } else {
      // 2. Fallback to Flip Following from Caret
      const start = (typeof caretIndex !== 'undefined' && caretIndex !== null) ? caretIndex : 0;
      if (window.invertFollowing) {
        if (window.HistoryManager) window.HistoryManager.pushState();
        window.invertFollowing(start);
      }
    }

    if (navigator.vibrate) navigator.vibrate([50, 50, 50]);
  });
}

themeBtn.addEventListener('click', () => {
  document.body.classList.toggle('dark');
  localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
});

presentBtn.addEventListener('click', () => {
  const on = !document.body.classList.contains('present');
  if (window.setPresentation) {
    window.setPresentation(on);
  } else {
    console.error('setPresentation not loaded');
  }
});

exitPresent.addEventListener('click', () => setPresentation(false));



metroBtn.addEventListener('click', () => {
  const ctx = window.activeGrid;
  ctx.metronomeOn = !ctx.metronomeOn;
  localStorage.setItem(METRO_KEY + '-' + ctx.id, ctx.metronomeOn ? 'on' : 'off');
  updateMetroUI(); // This might need updating too if it depends on global
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
  renderAllMeasures(window.gridA);
  renderAllMeasures(window.gridB);

  // Persist to profile if signed in
  if (typeof updateUserGridLabelNotation === 'function') {
    updateUserGridLabelNotation(window.labelNotation);
  }
});

// Remove old clearBtn listener as it's now handled in setupGridControls
// clearBtn.addEventListener('click', ...) 

saveBtn.addEventListener('click', async () => {
  const defaultName = `Pattern ${new Date().toLocaleString()}`;
  window.focus();
  const name = prompt('Save pattern as:', getSelectedPatternName() || defaultName);
  if (!name) return;

  saveCurrentPatternAs(name);
});

async function saveCurrentPatternAs(name) {
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

async function loadPatternByName(pattern) {
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

    // Force refresh presentation view if active (fixes blank screen on refresh)
    // Force refresh presentation view if active (fixes blank screen on refresh)
    if (window.updatePresentationView) {
      // Reset cache because applyPattern rebuilt the DOM
      if (window.resetPresentationView) window.resetPresentationView();
      window.updatePresentationView(0);
    }
  } catch (err) {
    console.error(err);
    alert(`Load failed: ${err?.message || err}`);
  }
}

loadBtn.addEventListener('click', async () => {
  const selected = getSelectedPatternName();
  loadPatternByName(selected);
});


renameBtn.addEventListener('click', async () => {
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


deleteBtn.addEventListener('click', async () => {
  if (!ensureHasSelection()) return;

  const name = getSelectedPatternName();
  const ok = confirm(`Delete "${name}"? This cannot be undone.`);
  if (!ok) return;

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
});


exportBtn.addEventListener('click', async () => {
  const data = JSON.stringify(serializePattern(), null, 2);
  try {
    await navigator.clipboard.writeText(data);
    alert('Pattern JSON copied to clipboard.');
  } catch {
    prompt('Copy this JSON:', data);
  }
});

importBtn.addEventListener('click', async () => {
  if (typeof window.hasUnsavedChanges === 'function' && window.hasUnsavedChanges()) {
    if (!confirm('You have unsaved changes. Discard them?')) return;
  }

  const raw = prompt('Paste pattern JSON here:');
  if (!raw) return;
  try {
    const obj = JSON.parse(raw);
    applyPattern(obj);

    const wantSave = confirm('Loaded! Save this pattern to your list?');
    if (wantSave) {
      const saved = getSavedPatterns();
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

// Initialize Pattern from previous session
// Wait for DOM and refreshPatternSelect
// Initialize Pattern from previous session
// MOVED TO init.js to prevent race condition

// === VIRTUAL PLAYBACK CONTROLS (Moved from handpanmap.js) ===
// Initialize Transport Controls for all containers
function setupAllTransports() {
  const containers = document.querySelectorAll('.transport-container');
  const template = document.getElementById('transport-template');
  if (!template) return;

  containers.forEach(container => {
    // Clear existing content
    container.innerHTML = '';

    // Clone template
    const clone = template.content.cloneNode(true);
    container.appendChild(clone);

    // Determine GridContext
    const gridId = container.dataset.grid || 'A';
    const ctx = (gridId === 'B') ? window.gridB : window.gridA;

    // Initialize Modular UI
    new TransportUI(ctx, container);
  });
}

// EXPOSE GLOBAL (for init.js or presentation-mode.js)
window.initModularTransports = setupAllTransports;

// Sync function (Legacy compatibility or triggered broadcast)
window.syncVirtualHandpanControls = function () {
  // Everything is now handled by TransportRegistry.updateAll via listeners
  // but we can force a full refresh if needed.
  TransportRegistry.updateAll(window.gridA);
  TransportRegistry.updateAll(window.gridB);
};

// HOOK UPDATE LOOP AND INIT
function installHook() {
  const existingHook = window.updatePresentationView;
  window.updatePresentationView = function (step, ctx) {
    if (existingHook) existingHook(step, ctx);
    // TransportRegistry handles UI updates during playback via start() -> tick() 
    // but we can ensure sync here too.
    if (ctx) {
      TransportRegistry.updateAll(ctx);
    } else {
      TransportRegistry.updateAll(window.gridA);
    }
  };

  // Run once immediately
  setupAllTransports();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installHook);
} else {
  installHook();
}