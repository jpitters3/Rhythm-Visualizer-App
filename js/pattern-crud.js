// SAVE / LOAD PATTERNS WITH SUPABASE
window.lastSavedState = ''; // Snapshot for data loss prevention

window.hasUnsavedChanges = function () {
  if (typeof serializePattern !== 'function') return false;
  const current = JSON.stringify(serializePattern());
  return current !== window.lastSavedState;
};

async function isAuthed() {
  const { data, error } = await supabase1.auth.getUser();
  return !!(data?.user);
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
  window.lastSavedState = JSON.stringify(stateObj);
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
    if (await isAuthed()) {
      const names = (await dbListPatternNames()).sort((a, b) => a.localeCompare(b));
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


function serializePattern(ctx = window.gridA) {
  return {
    version: VERSION,
    mode: ctx.mode,
    bpm: Number(ctx.bpm),
    timeSignature: (typeof getTimeSignature === 'function' ? getTimeSignature() : '4/4'),
    handSplit: document.body.classList.contains('handSplit'),
    steps: ctx.stepsPerMeasure,
    measures: ctx.measures,
    labels: ctx.innerLabels.slice(),
    hands: ctx.innerHands ? ctx.innerHands.slice() : [],
  };
}

function applyPattern(state, ctx = window.gridA) {
  if (!state || !state.mode || !Array.isArray(state.labels)) {
    alert('That pattern JSON does not look valid.');
    return;
  }

  const wasPlaying = ctx.playing;
  if (wasPlaying) stop(ctx);

  setMode(state.mode === '16' ? '16' : '8', ctx);

  if (typeof setTimeSignature === 'function') {
    setTimeSignature(state.timeSignature || '4/4');
  }

  if (typeof state.handSplit === 'boolean') {
    document.body.classList.toggle('handSplit', state.handSplit);
    localStorage.setItem('handSplit', state.handSplit ? 'on' : 'off');
    if (typeof handBtn !== 'undefined' && handBtn) {
      handBtn.classList.add('active');
      handBtn.textContent = state.handSplit ? 'Left/Right: On' : 'Left/Right: Off';
    }
  }

  if (typeof state.bpm === 'number' && !Number.isNaN(state.bpm)) {
    ctx.bpm = Math.max(40, Math.min(200, Math.round(state.bpm)));
    if (ctx.bpmInput) ctx.bpmInput.value = String(ctx.bpm);
    const bVal = document.getElementById(`bpmVal-${ctx.id}`);
    if (bVal) bVal.textContent = String(ctx.bpm);
  }

  // Apply labels across all steps
  ctx.innerLabels = state.labels;
  ctx.innerHands = Array.isArray(state.hands) ? state.hands : Array(ctx.innerLabels.length).fill(null);

  if (ctx.id === 'A') {
    window.innerLabels = ctx.innerLabels;
  }

  renderAllMeasures(ctx);
  clearSelection(ctx);

  if (wasPlaying) start(ctx);
  window.lastSavedState = JSON.stringify(state);
}

function ensureHasSelection() {
  const name = getSelectedPatternName();
  if (!name) {
    alert('Select a saved pattern first.');
    return false;
  }
  return true;
}