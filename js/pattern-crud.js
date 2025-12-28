// SAVE / LOAD PATTERNS WITH SUPABASE
function isAuthed() {
  return !!currentUser;
}

async function dbListPatternNames() {
  const { data, error } = await supabase1
    .from('patterns')
    .select('name')
    .order('updated_at', { ascending: false });

  if (error) throw error;
  return (data || []).map(r => r.name);
}

async function dbLoadPatternByName(name) {
  const { data, error } = await supabase1
    .from('patterns')
    .select('data')
    .eq('name', name)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data?.data || null;
}

async function dbSavePattern(name, stateObj) {
  const row = {
    name,
    data: stateObj,
    updated_at: new Date().toISOString(),
  };

  // unique(user_id, name) => upsert to overwrite
  const { error } = await supabase1
    .from('patterns')
    .upsert(row, { onConflict: 'user_id,name' });

  if (error) throw error;
}

function withTimeout(promise, ms = 3000, label = 'timeout') {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(label)), ms)),
  ]);
}


async function dbDeletePattern(name) {
  const { error } = await supabase1
    .from('patterns')
    .delete()
    .eq('name', name);

  if (error) throw error;
}

async function dbRenamePattern(oldName, newName) {
  // rename = update name (unique per user enforced)
  const { error } = await supabase1
    .from('patterns')
    .update({ name: newName, updated_at: new Date().toISOString() })
    .eq('name', oldName);

  if (error) throw error;
}


// ===== SAVE / LOAD =====
function getSavedPatterns() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function setSavedPatterns(obj) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
}

function getSelectedPatternName() {
  return patternSelect.value || '';
}

function updatePatternButtons() {
  const hasSelection = !!patternSelect.value;
  loadBtn.disabled = false;
  renameBtn.disabled = !hasSelection;
  deleteBtn.disabled = !hasSelection;
}

async function refreshPatternSelect(selectedName = '') {
  try {
    patternSelect.innerHTML = '';

    // CLOUD MODE
    if (isAuthed()) {
      const names = (await dbListPatternNames()).sort((a,b) => a.localeCompare(b));
      if (names.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = '(no saved patterns)';
        patternSelect.appendChild(opt);
        updatePatternButtons();
        return;
      }

      for (const name of names) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        patternSelect.appendChild(opt);
      }

      const lastUsed = localStorage.getItem(LAST_USED_KEY) || '';
      if (selectedName && names.includes(selectedName)) patternSelect.value = selectedName;
      else if (lastUsed && names.includes(lastUsed)) patternSelect.value = lastUsed;
      else patternSelect.value = names[0];

      updatePatternButtons();
      return;
    }

    // LOCAL MODE (logged out)
    const saved = getSavedPatterns();
    const names = Object.keys(saved).sort((a, b) => a.localeCompare(b));

    if (names.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '(no saved patterns)';
      patternSelect.appendChild(opt);
      updatePatternButtons();
      return;
    }

    for (const name of names) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      patternSelect.appendChild(opt);
    }

    const lastUsed = localStorage.getItem(LAST_USED_KEY) || '';
    if (selectedName && saved[selectedName]) patternSelect.value = selectedName;
    else if (lastUsed && saved[lastUsed]) patternSelect.value = lastUsed;
    else patternSelect.value = names[0];

    updatePatternButtons();
  } catch (err) {
    console.error(err);
    alert(`Could not load patterns: ${err?.message || err}`);
  }
}


function serializePattern() {
  return {
    version: VERSION,
    mode,
    bpm: Number(bpmInput.value),
    handSplit: document.body.classList.contains('handSplit'),
    steps: STEPS,
    measures: measures,
    labels: innerLabels.slice(),
  };
}

function applyPattern(state) {
  if (!state || !state.mode || !Array.isArray(state.labels)) {
    alert('That pattern JSON does not look valid.');
    return;
  }

  const wasPlaying = playing;
  if (wasPlaying) stop();

  setMode(state.mode === '16' ? '16' : '8');

  measures = Number.isFinite(state.measures) ? Math.max(1, Math.floor(state.measures)) : 1;
  buildGrid();

  if (typeof state.handSplit === 'boolean') {
    document.body.classList.toggle('handSplit', state.handSplit);
    localStorage.setItem('handSplit', state.handSplit ? 'on' : 'off');
    handBtn.classList.add('active');
    handBtn.textContent = state.handSplit ? 'Left/Right: On' : 'Left/Right: Off';
  }

  if (typeof state.bpm === 'number' && !Number.isNaN(state.bpm)) {
    bpmInput.value = String(Math.max(40, Math.min(200, Math.round(state.bpm))));
    bpmVal.textContent = bpmInput.value;
  }

  const totalSteps = measures * STEPS;
  const all = cells();

  // Apply labels across all steps
  for (let i = 0; i < totalSteps; i++) {
    setInnerLabel(i, state.labels[i] || '');
  }

  clearSelection();
  if (wasPlaying) start();
}

function ensureHasSelection() {
  const name = getSelectedPatternName();
  if (!name) {
    alert('Select a saved pattern first.');
    return false;
  }
  return true;
}