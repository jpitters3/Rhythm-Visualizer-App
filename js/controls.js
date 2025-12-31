// ==== EVENTS FOR BUTTONS / CONTROLS ====

patternSelect.addEventListener('change', updatePatternButtons);

playBtn.addEventListener('click', () => {
  // Make click idempotent and resilient to rapid taps
  if (playing) stop();
  else start();
});

// If the tab is hidden, stop playback to avoid runaway timers in the background
document.addEventListener('visibilitychange', () => {
  if (document.hidden && playing) stop();
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

themeBtn.addEventListener('click', () => {
  document.body.classList.toggle('dark');
  localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
});

presentBtn.addEventListener('click', () => {
  const on = !document.body.classList.contains('present');
  setPresentation(on);
});

exitPresent.addEventListener('click', () => setPresentation(false));

function updateMetroUI() {
  metroBtn.classList.toggle('active', metronomeOn);
  metroBtn.textContent = metronomeOn ? 'Metronome: On' : 'Metronome: Off';
}

metroBtn.addEventListener('click', () => {
  metronomeOn = !metronomeOn;
  localStorage.setItem(METRO_KEY, metronomeOn ? 'on' : 'off');
  updateMetroUI();
  if (metronomeOn) ensureAudio();
});

clearBtn.addEventListener('click', () => {
  innerLabels = Array(measures * STEPS).fill('');

  cells().forEach((c) => {
    c.classList.remove('label-d', 'label-t', 'label-s', 'label-n', 'has-label', 'selected', 'play');
    const inner = c.querySelector('.inner');
    if (inner) inner.textContent = '';
  });
  selectedIndex = null;
  step = 0;
});

saveBtn.addEventListener('click', async () => {
  const defaultName = `Pattern ${new Date().toLocaleString()}`;
  window.focus();
  const name = prompt('Save pattern as:', getSelectedPatternName() || defaultName);
  if (!name) return;

  saveCurrentPatternAs(name);
});

async function saveCurrentPatternAs(name){
  if (!name) return false;

  const trimmed = String(name || '').trim();
  if (!trimmed) return false;

  try {
    if (isAuthed()) {
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

loadBtn.addEventListener('click', async () => {
  try {
    // CLOUD MODE
    if (isAuthed()) {
      const selected = getSelectedPatternName();
      if (!selected) {
        alert('Select a saved pattern first.');
        return;
      }
      const state = await dbLoadPatternByName(selected);
      if (!state) {
        alert('Could not load that pattern.');
        return;
      }
      applyPattern(state);
      localStorage.setItem(LAST_USED_KEY, selected);
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
  } catch (err) {
    console.error(err);
    alert(`Load failed: ${err?.message || err}`);
  }
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
    if (isAuthed()) {
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
    if (isAuthed()) {
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
        if (isAuthed()) {
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