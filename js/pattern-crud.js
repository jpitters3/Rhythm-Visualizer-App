// SAVE / LOAD PATTERNS WITH SUPABASE
import { alert, confirm } from './alert.js';
import { supabase } from './supabase-client.js';
import { isAuthed } from './auth.js';
import { gridA, gridB } from './grid-context.js';
import { start, stop, setBeats, setSubdivision } from './noteplayer.js';
import { migratePatternState } from './rhythm-core.js';
import { renderAllMeasures, clearSelection, setDualGrid } from './notegrid.js';
import { TransportRegistry } from './transport-ui.js';
import { Bus, BUS_EVENT } from './bus.js';

export const STORAGE_KEY = 'groovepan_patterns';
export const LAST_USED_KEY = 'groovepan_last_pattern';

export function syncPhraseNameDisplay(name) {
  const patternSelect = document.getElementById('patternSelect');
  if (name !== undefined && patternSelect) patternSelect.value = name;
  const label = (patternSelect?.value || name) || 'Untitled';
  const ids = ['currentProjectName', 'currentPhraseName', 'gridPhraseName'];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) el.textContent = label;
  }
}

let lastSavedState = ''; // Snapshot for data loss prevention

export function hasUnsavedChanges() {
  if (!lastSavedState) return false;
  if (typeof serializePattern !== 'function') return false;
  const current = JSON.stringify(serializePattern());
  return current !== lastSavedState;
}

export function snapshotCurrentState() {
  if (typeof serializePattern === 'function') {
    lastSavedState = JSON.stringify(serializePattern());
  }
}

export async function dbListPatternNames() {
  const { data, error } = await supabase
    .from('patterns')
    .select('name')
    .order('updated_at', { ascending: false });

  if (error) throw error;
  return (data || []).map(r => r.name);
}

export async function dbListPatternsWithData() {
  const { data, error } = await supabase
    .from('patterns')
    .select('name, data')
    .order('updated_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function dbLoadPatternByName(name) {
  const { data, error } = await supabase
    .from('patterns')
    .select('data')
    .eq('name', name)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data?.data || null;
}

export async function dbSavePattern(name, stateObj, source = 'manual') {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // Check for existing pattern with the same name and warn before overwriting
  const { data: existing } = await supabase
    .from('patterns')
    .select('name')
    .eq('user_id', user.id)
    .eq('name', name)
    .maybeSingle();

  if (existing) {
    const ok = await confirm(`A phrase named "${name}" already exists. Overwrite it?`);
    if (!ok) return false;
  }

  const row = {
    user_id: user.id,
    name,
    data: stateObj,
    source,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('patterns')
    .upsert(row, { onConflict: 'user_id,name' });

  if (error) throw error;
  lastSavedState = JSON.stringify(stateObj);
  return true;
}

function withTimeout(promise, ms = 3000, label = 'timeout') {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(label)), ms)),
  ]);
}


export async function dbDeletePattern(name) {
  // Since RLS is on, we don't strictly need user_id in .eq() if calling delete() on own rows,
  // but it's safer to rely on RLS + name logic.
  const { error } = await supabase
    .from('patterns')
    .delete()
    .eq('name', name);

  if (error) throw error;
}

export async function dbRenamePattern(oldName, newName) {
  // rename = update name (unique per user enforced)
  const { error } = await supabase
    .from('patterns')
    .update({ name: newName, updated_at: new Date().toISOString() })
    .eq('name', oldName);

  if (error) throw error;
}


// ===== SAVE / LOAD =====
export function getSavedPatterns() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function setSavedPatterns(obj) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
}

export function getSelectedPatternName() {
  const patternSelect = document.getElementById('patternSelect');
  return patternSelect ? (patternSelect.value || '') : '';
}

export function updatePatternButtons() {
  const patternSelect = document.getElementById('patternSelect');
  const renameBtn = document.getElementById('renameBtn');
  const deleteBtn = document.getElementById('deleteBtn');

  if (!patternSelect) return;

  const hasSelection = !!patternSelect.value;
  if (renameBtn) renameBtn.disabled = !hasSelection;
  if (deleteBtn) deleteBtn.disabled = !hasSelection;
}

export async function refreshPatternSelect(selectedName = '') {
  const patternSelect = document.getElementById('patternSelect');
  if (!patternSelect) return;

  try {
    patternSelect.innerHTML = '';

    let names = [];
    let loadLocal = true;

    // Try cloud first if supabase exists
    if (typeof supabase !== 'undefined') {
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
      syncPhraseNameDisplay();
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
    syncPhraseNameDisplay();
  } catch (err) {
    console.error('refreshPatternSelect error:', err);
  }
}

export function serializePattern(ctx = gridA) {
  const state = {
    version: (typeof window.VERSION !== 'undefined' ? window.VERSION : 'v1.0'),
    beats: ctx.beats,
    subdivision: ctx.subdivision,
    bpm: Number(ctx.bpm),
    handSplit: document.body.classList.contains('handSplit'),
    steps: ctx.stepsPerMeasure,
    measures: ctx.measures,
    labels: ctx.innerLabels ? ctx.innerLabels.slice() : [],
    hands: ctx.innerHands ? ctx.innerHands.slice() : [],
    tags: ctx.tags ? ctx.tags.slice() : [],
  };

  // If serializing Grid A, check if Dual Mode is active to include Grid B
  if (ctx === gridA) {
    const isDual = document.getElementById('dualModeBtn')?.classList.contains('active');
    if (isDual && gridB) {
      state.gridB = {
        beats: gridB.beats,
        subdivision: gridB.subdivision,
        bpm: Number(gridB.bpm),
        measures: gridB.measures,
        labels: gridB.innerLabels ? gridB.innerLabels.slice() : [],
        hands: gridB.innerHands ? gridB.innerHands.slice() : [],
      };
    }
  }

  return state;
}

export async function applyPattern(state, ctx = gridA) {
  if (!state || !Array.isArray(state.labels)) {
    console.error('Invalid pattern state:', state);
    await alert('That pattern JSON does not look valid.');
    return;
  }

  // Migrate old format ({ mode, timeSignature }) to new ({ beats, subdivision })
  migratePatternState(state);

  const wasPlaying = ctx.playing;
  if (wasPlaying) stop(ctx);

  if (state.beats) setBeats(state.beats, ctx);
  if (state.subdivision) setSubdivision(state.subdivision, ctx);

  if (typeof state.handSplit === 'boolean') {
    document.body.classList.toggle('handSplit', state.handSplit);
    localStorage.setItem('handSplit', state.handSplit ? 'on' : 'off');
    const handBtn = document.getElementById('handBtn');
    if (handBtn) {
      handBtn.classList.add('active');
      handBtn.textContent = state.handSplit ? 'Left/Right: On' : 'Left/Right: Off';
    }
  }

  if (typeof state.bpm === 'number' && !Number.isNaN(state.bpm)) {
    ctx.bpm = Math.max(40, Math.min(220, Math.round(state.bpm)));
    if (TransportRegistry) {
      TransportRegistry.updateAll(ctx);
    }
  }

  // Apply labels across all steps
  // Migration: Convert legacy 'D' labels to 'Ding'
  ctx.innerLabels = state.labels.map(lbl => {
    if (Array.isArray(lbl)) {
      return lbl.map(sub => sub === 'D' ? 'Ding' : sub);
    }
    return lbl === 'D' ? 'Ding' : lbl;
  });

  ctx.innerHands = Array.isArray(state.hands) ? state.hands : Array(ctx.innerLabels.length).fill(null);

  // Apply Tags
  if (Array.isArray(state.tags)) {
    ctx.tags = state.tags;
  } else {
    ctx.tags = [];
  }

  // Dual Grid Handling
  if (ctx === gridA) {
    if (state.gridB) {
      setDualGrid(true);
      await applyPattern(state.gridB, gridB);
    } else {
      setDualGrid(false);
    }
    // Snapshot before render so GRID_RENDERED listeners see a clean state
    lastSavedState = JSON.stringify(serializePattern());
    syncPhraseNameDisplay();
  }

  renderAllMeasures(ctx);

  clearSelection(ctx);

  if (wasPlaying) start(ctx);
}

export async function ensureHasSelection() {
  const name = getSelectedPatternName();
  if (!name) {
    await alert('Select a saved pattern first.');
    return false;
  }
  return true;
}

// Event Bus Listener: Pattern Refresh
Bus.on(BUS_EVENT.PATTERN_REFRESH_NEEDED, async ({ detail }) => {
  await refreshPatternSelect(detail?.selectedName);
});