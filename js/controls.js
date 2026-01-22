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

playBtn.addEventListener('click', () => {
  // Make click idempotent and resilient to rapid taps
  if (playing) stop();
  else start();
});

// If the tab is hidden, stop playback to avoid runaway timers in the background
document.addEventListener('visibilitychange', () => {
  if (document.hidden && playing) stop();
});

bpmInput.addEventListener('mousedown', () => {
  if (window.HistoryManager) window.HistoryManager.pushState();
});

bpmInput.addEventListener('input', () => {
  bpmVal.textContent = bpmInput.value;
  restartIfPlaying();
});

gridBtn.addEventListener('click', () => setMode(mode === '8' ? '16' : '8'));

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
      window.invertRange(r.start, r.end);
    } else {
      // 2. Fallback to Flip Following from Caret
      const start = (typeof caretIndex !== 'undefined' && caretIndex !== null) ? caretIndex : 0;
      if (window.invertFollowing) window.invertFollowing(start);
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
  metronomeOn = !metronomeOn;
  localStorage.setItem(METRO_KEY, metronomeOn ? 'on' : 'off');
  updateMetroUI();
  if (metronomeOn) ensureAudio();
});

clearBtn.addEventListener('click', () => {
  if (window.HistoryManager) window.HistoryManager.pushState();
  innerLabels = Array(measures * STEPS).fill('');
  window.innerHands = Array(measures * STEPS).fill(null);

  cells().forEach((c) => {
    c.classList.remove('label-d', 'label-t', 'label-s', 'label-n', 'has-label', 'selected', 'play');
    const inner = c.querySelector('.inner');
    if (inner) inner.textContent = '';
  });
  selectedIndex = null;
  step = 0;

  if (typeof serializePattern === 'function') {
    window.lastSavedState = JSON.stringify(serializePattern());
  }
});

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
    refreshPatternSelect(trimmed);
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

    let name = getSelectedPatternName();
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
(function initVirtualControls() {
  const vControls = document.getElementById('virtualHandpanPlaybackControls');

  // Elements (Closured)
  const vMetroBtn = document.getElementById('virtualHandpanMetroBtn');
  const vBpmInput = document.getElementById('virtualHandpanBpmInput');
  const vBpmVal = document.getElementById('virtualHandpanBpmVal');
  const vPlayBtn = document.getElementById('virtualHandpanPlayBtn');

  // Lesson Player Play Button
  const vLessonPlayBtn = document.getElementById('vLessonPlayBtn');

  // We don't return early if vControls is missing, because vLessonPlayBtn might exist independently
  // but we can check if individual elements exist before adding listeners.

  const getReal = (id) => document.getElementById(id);

  // LISTENERS (Proxy -> Real)
  if (vMetroBtn) {
    vMetroBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const real = getReal('metroBtn');
      if (real) real.click();
      syncVirtualControls();
    });
  }

  if (vPlayBtn) {
    vPlayBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const real = getReal('playBtn');
      if (real) real.click();
      syncVirtualControls();
    });
  }

  if (vLessonPlayBtn) {
    vLessonPlayBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const real = getReal('playBtn');
      if (real) real.click();
      syncVirtualControls();
    });
  }

  if (vBpmInput) {
    vBpmInput.addEventListener('input', (e) => {
      e.stopPropagation();
      const real = getReal('bpmInput');
      if (real) {
        real.value = e.target.value;
        real.dispatchEvent(new Event('input'));
      }
      if (vBpmVal) vBpmVal.textContent = e.target.value;
    });
  }

  // SYNC FUNCTION (Real -> Proxy)
  function syncVirtualControls() {
    const realBpmInput = getReal('bpmInput');
    const realPlayBtn = getReal('playBtn');
    const realMetroBtn = getReal('metroBtn');

    // BPM
    if (realBpmInput && vBpmInput) {
      if (vBpmInput.value !== realBpmInput.value) {
        vBpmInput.value = realBpmInput.value;
        if (vBpmVal) vBpmVal.textContent = realBpmInput.value;
      }
    }

    // Play State
    if (realPlayBtn) {
      const isPlaying = realPlayBtn.classList.contains('active');

      if (vPlayBtn) {
        vPlayBtn.textContent = realPlayBtn.textContent;
        vPlayBtn.classList.toggle('active', isPlaying);
        vPlayBtn.classList.toggle('playing', isPlaying);
      }

      if (vLessonPlayBtn) {
        if (isPlaying) {
          vLessonPlayBtn.textContent = '⏹';
          vLessonPlayBtn.classList.add('active');
        } else {
          vLessonPlayBtn.textContent = '►';
          vLessonPlayBtn.classList.remove('active');
        }
      }
    }

    // Metronome
    if (realMetroBtn && vMetroBtn) {
      const isOn = realMetroBtn.classList.contains('active') || (typeof metronomeOn !== 'undefined' && metronomeOn);
      vMetroBtn.classList.toggle('active', isOn);
      vMetroBtn.style.opacity = isOn ? '1' : '0.5';
    }
  }

  // EXPOSE GLOBAL (for init.js)
  window.syncVirtualHandpanControls = syncVirtualControls;

  // HOOK UPDATE LOOP AND INIT
  function installHook() {
    // Wait a tick to ensure presentation-mode.js has run if it loaded after us? 
    // DOMContentLoaded covers script load order usually, but safer to check.
    const existingHook = window.updatePresentationView;
    window.updatePresentationView = function (step) {
      if (existingHook) existingHook(step);
      syncVirtualControls();
    };

    // Run once immediately
    syncVirtualControls();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installHook);
  } else {
    installHook();
  }
})();