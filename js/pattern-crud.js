// SAVE / LOAD PATTERNS WITH SUPABASE
window.lastSavedState = ''; // Snapshot for data loss prevention

window.hasUnsavedChanges = function () {
  if (typeof serializePattern !== 'function') return false;
  const current = JSON.stringify(serializePattern());
  return current !== window.lastSavedState;
};

async function isAuthed() {
  if (typeof supabase1 === 'undefined' || !supabase1.auth) return false;
  try {
    const { data, error } = await supabase1.auth.getUser();
    return !!(data?.user);
  } catch (e) {
    console.warn('Auth check failed:', e);
    return false;
  }
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

    let names = [];
    let loadLocal = true;

    // Try cloud first if supabase exists
    if (typeof supabase1 !== 'undefined') {
      try {
        const authed = await withTimeout(isAuthed(), 1000, 'auth-check');
        if (authed) {
          const cloudNames = await withTimeout(dbListPatternNames(), 2000, 'list-patterns');
          names = (cloudNames || []).sort((a, b) => a.localeCompare(b));
          loadLocal = false;
        }
      } catch (e) {
        console.warn('Cloud pattern list failed or timed out, falling back to local:', e);
      }
    }

    if (loadLocal) {
      const saved = getSavedPatterns();
      names = Object.keys(saved).sort((a, b) => a.localeCompare(b));
    }

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
  } catch (err) {
    console.error('refreshPatternSelect error:', err);
  }
}



function serializePattern(ctx = window.gridA) {
  const state = {
    version: (typeof VERSION !== 'undefined' ? VERSION : 'v1.0'),
    mode: ctx.mode,
    bpm: Number(ctx.bpm),
    timeSignature: (typeof getTimeSignature === 'function' ? getTimeSignature() : '4/4'),
    handSplit: document.body.classList.contains('handSplit'),
    steps: ctx.stepsPerMeasure,
    measures: ctx.measures,
    labels: ctx.innerLabels ? ctx.innerLabels.slice() : [],
    hands: ctx.innerHands ? ctx.innerHands.slice() : [],
  };

  // If serializing Grid A, check if Dual Mode is active to include Grid B
  if (ctx === window.gridA) {
    const isDual = document.getElementById('dualModeBtn')?.classList.contains('active');
    if (isDual && window.gridB) {
      state.gridB = {
        mode: window.gridB.mode,
        bpm: Number(window.gridB.bpm),
        measures: window.gridB.measures,
        labels: window.gridB.innerLabels ? window.gridB.innerLabels.slice() : [],
        hands: window.gridB.innerHands ? window.gridB.innerHands.slice() : [],
      };
    }
  }

  return state;
}

function applyPattern(state, ctx = window.gridA) {
  if (!state || !state.mode || !Array.isArray(state.labels)) {
    console.error('Invalid pattern state:', state);
    alert('That pattern JSON does not look valid.');
    return;
  }

  const wasPlaying = ctx.playing;
  if (wasPlaying) stop(ctx);

  setMode(state.mode === '16' ? '16' : '8', ctx);

  // Only set global time signature if provided and if applying to Grid A
  // (Pattern sub-objects for Grid B don't have their own time signature)
  if (ctx === window.gridA && state.timeSignature && typeof setTimeSignature === 'function') {
    setTimeSignature(state.timeSignature);
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
    ctx.bpm = Math.max(40, Math.min(220, Math.round(state.bpm)));
    if (window.TransportRegistry) {
      window.TransportRegistry.updateAll(ctx);
    }
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

  // Dual Grid Handling
  if (ctx === window.gridA) {
    if (state.gridB) {
      if (window.setDualGrid) window.setDualGrid(true);
      applyPattern(state.gridB, window.gridB);
    } else {
      // If loading a single-grid pattern, hide grid B
      // But only if we are currently looking at Grid A
      if (window.setDualGrid) window.setDualGrid(false);
    }
    // Only save the top-level state as lastSavedState
    window.lastSavedState = JSON.stringify(state);
  }
}

function ensureHasSelection() {
  const name = getSelectedPatternName();
  if (!name) {
    alert('Select a saved pattern first.');
    return false;
  }
  return true;
}