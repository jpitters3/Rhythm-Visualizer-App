// song-composer.js
// Side-panel Song Composer: create compositions made of ordered sections
// (phrase, recording, note) with drag-and-drop reorder, mic recording,
// and sequential playback that auto-advances after each phrase loop.

import { Sidepanel } from './sidepanel.js';
import { supabase } from './supabase-client.js';
import { currentUser } from './state.js';
import {
  dbLoadPatternByName, dbSavePattern, applyPattern, serializePattern,
  dbListPatternNames, hasUnsavedChanges,
} from './pattern-crud.js';
import { getRange } from './range-selection.js';
import { addTickObserver, removeTickObserver, start, stop } from './noteplayer.js';
import { TransportRegistry } from './transport-ui.js';
import { gridA } from './grid-context.js';
import { alert, confirm, prompt } from './alert.js';
import { closeSidebar } from './courses.js';
import { openTrimUI, closeTrimUI } from './recording-trim.js';
import { updateCurrentPhraseName } from './controls.js';
import { canAccess, FEATURE } from './gated-feature.js';
import { Bus, BUS_EVENT } from './bus.js';

// ============================================================
// State
// ============================================================
let compositions = [];   // [{ id, title, sections: [...] }]
let expandedId   = null; // currently expanded composition id
// playback: { compositionId, boundaries, currentSectionIdx, loopObserver }
// boundaries: [{ start, end, sectionId, color, title }]  (step indices into stitched phrase)
let playback         = null;
// lastPlayback: { compositionId, currentSectionIdx, boundaries } — persists after stop so the
// playbar can show the last section and replay from it when the user hits play again.
let lastPlayback      = null;
// stitched: { compositionId, boundaries, savedState }  — set independently of playback
// savedState holds the pre-stitch grid state so it can be restored on toggle-off
let stitched          = null;
let isLoadingSection = false; // true while stitching/loading to block premature cleanup

// Default colours auto-assigned to new sections
const PALETTE = ['#4a90e2','#e2714a','#4ae291','#c44ae2','#e2c14a','#4ac9e2','#e24a7a','#8fe24a'];

// ============================================================
// Sidepanel
// ============================================================
const composerEl = document.getElementById('composerSidebar');
const composerPanel = new Sidepanel(composerEl, { onClose: () => {
  stopPlayback();
  closeTrimUI();
  removeContextMenu();
}});

// Register with TransportRegistry so the composer play button stays in sync
// when the transport controls start/stop the grid externally.
TransportRegistry.register({
  ctx: gridA,
  update() {
    if (playback && !gridA.playing && !isLoadingSection) {
      cleanupPlayback();
      renderCompositions();
    }
  },
});

export function openComposer() {
  closeSidebar({ reason: 'composer', source: 'composer' });
  composerPanel.open();
  updateBodySidebarClass();
  if (currentUser) fetchCompositions();
}

export function closeComposer() {
  composerPanel.close();
  updateBodySidebarClass();
}

export function toggleComposer() {
  composerPanel.isOpen ? closeComposer() : openComposer();
}

function updateBodySidebarClass() {
  const anyOpen = !!document.querySelector('.sidebar.open');
  document.body.classList.toggle('sidebar-open', anyOpen);
}

// ============================================================
// Supabase CRUD
// ============================================================
async function fetchCompositions() {
  if (!currentUser) return;
  setListHTML('<p class="loading">Loading...</p>');

  const { data, error } = await supabase
    .from('compositions')
    .select('id, title, created_at, composition_sections(id, position, type, title, phrase_name, audio_url, note_text, color, pattern_snapshot)')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false });

  if (error) { console.error('[Composer] fetch error', error); return; }

  compositions = (data || []).map(c => ({
    ...c,
    sections: (c.composition_sections || []).sort((a, b) => a.position - b.position),
  }));

  renderCompositions();
  prefetchMissingSnapshots();
}

// Silently pre-load pattern data for any phrase section that doesn't yet have
// a snapshot, so play-section is instant when the user clicks it.
async function prefetchMissingSnapshots() {
  for (const comp of compositions) {
    for (const section of comp.sections) {
      if (section.type !== 'phrase' || !section.phrase_name) continue;
      if (section.pattern_snapshot?.labels?.length) continue;
      try {
        const state = await dbLoadPatternByName(section.phrase_name);
        if (state?.labels?.length) section.pattern_snapshot = state;
      } catch (_) {}
    }
  }
}

async function createComposition() {
  if (!currentUser) { await alert('Sign in to use Song Composer.'); return; }

  if (!canAccess(FEATURE.UNLIMITED_COMPOSITIONS, { count: compositions.length })) {
    Bus.emit(BUS_EVENT.SHOW_UPGRADE_MODAL, {
      feature: FEATURE.UNLIMITED_COMPOSITIONS,
    });
    return;
  }

  const title = await prompt('Composition title:', 'Untitled Composition');
  if (!title?.trim()) return;

  const { data, error } = await supabase
    .from('compositions')
    .insert({ user_id: currentUser.id, title: title.trim() })
    .select('id, title, created_at')
    .single();

  if (error) { await alert('Could not create composition.'); return; }
  compositions.unshift({ ...data, sections: [] });
  expandedId = data.id;
  showPlaybar(data.title);
  updatePlaybarSection();
  renderCompositions();
}

function genCompShareToken(len = 12) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}

async function shareComposition(id) {
  const comp = compositions.find(c => c.id === id);
  if (!comp) return;

  // Generate token if not already set
  let token = comp.share_token;
  if (!token) {
    token = genCompShareToken();
    const { error } = await supabase
      .from('compositions')
      .update({ share_token: token })
      .eq('id', id);
    if (error) { await alert('Could not generate share link.'); return; }
    comp.share_token = token;
  }

  const url = `${location.origin}${location.pathname}?comp=${encodeURIComponent(token)}`;

  try {
    await navigator.clipboard.writeText(url);
    await alert('Share link copied to clipboard!');
  } catch {
    await prompt('Copy this link:', url);
  }
}

async function renameComposition(id) {
  const comp = compositions.find(c => c.id === id);
  if (!comp) return;
  const title = await prompt('Rename composition:', comp.title);
  if (!title?.trim() || title.trim() === comp.title) return;

  const { error } = await supabase
    .from('compositions')
    .update({ title: title.trim(), updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) { await alert('Could not rename.'); return; }
  comp.title = title.trim();
  renderCompositions();
}

async function saveAsPhrase(id) {
  const comp = compositions.find(c => c.id === id);
  if (!comp) return;

  const phraseSections = (comp.sections || []).filter(s => s.type === 'phrase' && s.phrase_name);
  if (!phraseSections.length) {
    await alert('This composition has no phrase sections to export.');
    return;
  }

  const name = await prompt('Save stitched composition as phrase:', comp.title);
  if (!name?.trim()) return;

  const boundaries = await ensureStitched(id);
  if (!boundaries) return;

  // Build the state from the currently stitched grid
  const state = serializePattern(gridA);
  // Tag it so the system knows where it came from
  state.source = 'composition';
  state.composition_id = id;

  try {
    await dbSavePattern(name.trim(), state, 'composition');
    await alert(`Saved as "${name.trim()}".`);
  } catch (e) {
    await alert('Could not save phrase. ' + e.message);
  }
}

// ============================================================
// Print
// ============================================================

const PRINT_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Georgia', serif; padding: 32px; background: #fff; color: #000; font-size: 13px; }
  h1 { font-size: 20px; font-weight: bold; margin-bottom: 24px; }
  .section { margin-bottom: 32px; }
  .section-label { font-size: 12px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px; color: #333; }
  .measure { margin-bottom: 14px; }
  .measure-label { font-size: 11px; color: #666; margin-bottom: 3px; }
  .beat-row { display: flex; gap: 0; }
  .beat { display: flex; flex-direction: column; align-items: center; min-width: 32px; border-right: 1px solid #ddd; padding: 0 4px; }
  .beat:last-child { border-right: none; }
  .beat-label { font-size: 10px; color: #999; margin-bottom: 3px; min-height: 14px; }
  .note { font-size: 13px; font-weight: 600; min-height: 20px; display: flex; align-items: center; justify-content: center; }
  .note-multi { font-size: 11px; font-weight: 600; min-height: 20px; display: flex; align-items: center; justify-content: center; white-space: nowrap; }
  .note-empty { color: #ccc; font-size: 11px; }
  .rh { color: #610a42; }
  .lh { color: #1a55cc; }
  .section + .section { border-top: 1px dashed #ccc; padding-top: 24px; }
  @media print { body { padding: 16px; } .section + .section { border-top: none; } }
`;

function _pEsc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _printBeatLabels(stepsPerMeasure, mode) {
  const labels = [];
  if (mode === '16') {
    const beats = Math.ceil(stepsPerMeasure / 4);
    for (let b = 1; b <= beats; b++) labels.push(String(b), 'e', '&', 'a');
  } else {
    const beats = Math.ceil(stepsPerMeasure / 2);
    for (let b = 1; b <= beats; b++) labels.push(String(b), '&');
  }
  return labels.slice(0, stepsPerMeasure);
}

function _printEffectiveHand(index, hands, mode) {
  const manual = Array.isArray(hands) ? (hands[index] || null) : null;
  if (manual) return manual;
  if (mode === '8') return index % 2 === 0 ? 'R' : 'L';
  const pos = index % 4;
  return (pos === 0 || pos === 2) ? 'R' : 'L';
}

function _buildPrintHTML(title, sectionData) {
  let sectionsHTML = '';
  sectionData.forEach(({ section, state }, si) => {
    const mode = state.mode || '8';
    const spm = state.steps || (mode === '16' ? 16 : 8);
    const measureCount = Math.ceil(state.labels.length / spm);
    const beatLbls = _printBeatLabels(spm, mode);

    let measuresHTML = '';
    for (let m = 0; m < measureCount; m++) {
      let rowHTML = '';
      for (let s = 0; s < spm; s++) {
        const idx = m * spm + s;
        const label = state.labels[idx];
        const beatLabel = beatLbls[s] || '';
        let noteHTML;

        if (Array.isArray(label)) {
          const hand = _printEffectiveHand(idx, state.hands, mode);
          const cls = hand === 'R' ? 'rh' : 'lh';
          const filled = label.filter(v => v && v !== '');
          filled.sort((a, b) => {
            const na = parseFloat(a), nb = parseFloat(b);
            return (isNaN(na) ? 999 : na) - (isNaN(nb) ? 999 : nb);
          });
          while (filled.length < 4) filled.push(null);
          const parts = filled.slice(0, 4).map(v =>
            v ? `<span class="${cls}">${_pEsc(v)}</span>` : `<span class="note-empty">·</span>`
          ).join(', ');
          noteHTML = `<div class="note-multi">[${parts}]</div>`;
        } else if (!label || label === '') {
          noteHTML = `<div class="note note-empty">·</div>`;
        } else {
          const hand = _printEffectiveHand(idx, state.hands, mode);
          const cls = hand === 'R' ? 'rh' : 'lh';
          noteHTML = `<div class="note ${cls}">${_pEsc(label)}</div>`;
        }

        rowHTML += `<div class="beat"><div class="beat-label">${_pEsc(beatLabel)}</div>${noteHTML}</div>`;
      }
      measuresHTML += `
        <div class="measure">
          <div class="measure-label">Measure ${m + 1}</div>
          <div class="beat-row">${rowHTML}</div>
        </div>`;
    }

    sectionsHTML += `
      <div class="section">
        <div class="section-label">${_pEsc(section.title || section.phrase_name || `Section ${si + 1}`)}</div>
        ${measuresHTML}
      </div>`;
  });

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>${_pEsc(title)}</title>
<style>${PRINT_CSS}</style>
</head>
<body>
<h1>${_pEsc(title)}</h1>
${sectionsHTML}
</body>
</html>`;
}

async function printComposition(id) {
  const comp = compositions.find(c => c.id === id);
  if (!comp) return;

  const phraseSections = comp.sections.filter(s => s.type === 'phrase' && s.phrase_name);
  if (!phraseSections.length) {
    await alert('This composition has no phrase sections to print.');
    return;
  }

  const sectionData = [];
  for (const section of phraseSections) {
    const state = await loadSectionPattern(section);
    if (state?.labels?.length) sectionData.push({ section, state });
  }

  if (!sectionData.length) {
    await alert('Could not load any phrase patterns.');
    return;
  }

  const html = _buildPrintHTML(comp.title, sectionData);
  const win = window.open('', '_blank');
  if (!win) { await alert('Please allow pop-ups for this site to print.'); return; }
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 400);
}

async function deleteComposition(id) {
  const comp = compositions.find(c => c.id === id);
  if (!comp) return;
  const ok = await confirm(`Delete "${comp.title}"? This cannot be undone.`);
  if (!ok) return;

  const { error } = await supabase.from('compositions').delete().eq('id', id);
  if (error) { await alert('Could not delete.'); return; }

  if (playback?.compositionId === id) stopPlayback();
  if (expandedId === id) expandedId = null;
  compositions = compositions.filter(c => c.id !== id);
  renderCompositions();
}

async function addSection(compositionId, type, extra = {}) {
  const comp = compositions.find(c => c.id === compositionId);
  if (!comp) return;
  const position = comp.sections.length;

  // Only assign a palette colour for phrase sections; other types don't use colour
  const autoColor = type === 'phrase' ? PALETTE[position % PALETTE.length] : null;
  const row = { composition_id: compositionId, position, type, color: autoColor, ...extra };

  const { data, error } = await supabase
    .from('composition_sections')
    .insert(row)
    .select()
    .single();

  if (error) { await alert('Could not add section.'); return; }
  comp.sections.push(data);
  renderCompositions();
  return data;
}

async function copySection(sectionId) {
  let src = null, comp = null, srcIdx = -1;
  for (const c of compositions) {
    const idx = c.sections.findIndex(s => s.id === sectionId);
    if (idx !== -1) { src = c.sections[idx]; comp = c; srcIdx = idx; break; }
  }
  if (!src || !comp) return;

  const insertAt = srcIdx + 1;

  const { data, error } = await supabase
    .from('composition_sections')
    .insert({
      composition_id:   comp.id,
      position:         insertAt,
      type:             src.type,
      title:            src.title            ?? null,
      phrase_name:      src.phrase_name      ?? null,
      audio_url:        src.audio_url        ?? null,
      note_text:        src.note_text        ?? null,
      color:            src.color            ?? null,
      pattern_snapshot: src.pattern_snapshot ?? null,
    })
    .select()
    .single();

  if (error) { await alert('Could not copy section.'); return; }

  comp.sections.splice(insertAt, 0, data);
  await reorderSections(comp.id, comp.sections.map(s => s.id));
  renderCompositions();
}

async function deleteSection(sectionId) {
  for (const comp of compositions) {
    const idx = comp.sections.findIndex(s => s.id === sectionId);
    if (idx === -1) continue;

    const { error } = await supabase
      .from('composition_sections')
      .delete()
      .eq('id', sectionId);

    if (error) { await alert('Could not delete section.'); return; }

    comp.sections.splice(idx, 1);
    await reorderSections(comp.id, comp.sections.map(s => s.id));
    renderCompositions();
    return;
  }
}

async function reorderSections(compositionId, orderedIds) {
  const comp = compositions.find(c => c.id === compositionId);
  if (!comp) return;

  const byId = Object.fromEntries(comp.sections.map(s => [s.id, s]));
  comp.sections = orderedIds.map((id, i) => ({ ...byId[id], position: i }));

  await Promise.all(
    comp.sections.map(s =>
      supabase.from('composition_sections').update({ position: s.position }).eq('id', s.id)
    )
  );
}

// ============================================================
// Phrase-picker flow
// ============================================================
async function showPhrasePicker(compositionId) {
  let names = [];
  try { names = await dbListPatternNames(); } catch (_) {}
  renderCompositions(compositionId, { showPhrasePicker: true, phraseNames: names.filter(Boolean) });
}

// ============================================================
// Add phrase from grid
// ============================================================
async function addPhraseFromGrid(compositionId) {
  const allLabels = gridA.innerLabels || [];

  // Determine the slice to save — use selection if present, otherwise full grid
  const range = getRange(gridA);
  const labels = range ? allLabels.slice(range.start, range.end + 1) : allLabels;
  const hands  = range
    ? (gridA.innerHands || []).slice(range.start, range.end + 1)
    : (gridA.innerHands || []);

  const isEmpty = labels.every(l =>
    !l || l === '' || (Array.isArray(l) && l.every(s => !s || s === ''))
  );

  if (isEmpty) {
    await alert('Compose in the grid and then press "Add phrase from grid" to add the new section to your song.');
    return;
  }

  const rangeLabel = range ? ` (beats ${range.start + 1} – ${range.end + 1})` : '';
  const name = await prompt(`Name this new phrase${rangeLabel}:`, 'New Phrase');
  if (!name?.trim()) return;

  const trimmed = name.trim();

  try {
    const base = serializePattern(gridA);
    const state = { ...base, labels, hands, measures: Math.ceil(labels.length / base.steps) };
    const saved = await dbSavePattern(trimmed, state);
    if (!saved) return; // user cancelled overwrite
  } catch (e) {
    await alert('Could not save phrase. Make sure you are signed in.');
    return;
  }

  await addSection(compositionId, 'phrase', { title: trimmed, phrase_name: trimmed, pattern_snapshot: state });
}

// ============================================================
// Note section editor
// ============================================================
async function updateNoteText(sectionId, text) {
  for (const comp of compositions) {
    const section = comp.sections.find(s => s.id === sectionId);
    if (!section) continue;
    section.note_text = text;
    await supabase.from('composition_sections').update({ note_text: text }).eq('id', sectionId);
    return;
  }
}

async function updateSectionColor(sectionId, color) {
  for (const comp of compositions) {
    const section = comp.sections.find(s => s.id === sectionId);
    if (!section) continue;
    section.color = color;
    await supabase.from('composition_sections').update({ color }).eq('id', sectionId);
    if (playback?.compositionId === comp.id && playback.boundaries) {
      playback.boundaries = playback.boundaries.map(b =>
        b.sectionId === sectionId ? { ...b, color } : b
      );
      applyGridSectionColors(playback.boundaries);
    }
    renderCompositions();
    return;
  }
}

// ============================================================
// Mic Recording
// ============================================================
let mediaRecorder  = null;
let recordingChunks = [];
let recordingTimer  = null;
let recordingSection = null;
let recordingStart  = 0;

async function startRecording(sectionId) {
  if (mediaRecorder) return;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    await alert('Microphone access denied.');
    return;
  }

  recordingChunks = [];
  recordingSection = sectionId;
  recordingStart = Date.now();

  mediaRecorder = new MediaRecorder(stream);
  mediaRecorder.ondataavailable = e => { if (e.data.size) recordingChunks.push(e.data); };
  mediaRecorder.onstop = () => {
    stream.getTracks().forEach(t => t.stop());
    onRecordingComplete();
  };
  mediaRecorder.start(250);

  const timerEl = document.querySelector(`[data-record-timer="${sectionId}"]`);
  recordingTimer = setInterval(() => {
    const secs = Math.floor((Date.now() - recordingStart) / 1000);
    const mm = String(Math.floor(secs / 60)).padStart(2, '0');
    const ss = String(secs % 60).padStart(2, '0');
    if (timerEl) timerEl.textContent = `${mm}:${ss}`;
  }, 1000);

  const btn = document.querySelector(`[data-record-btn="${sectionId}"]`);
  if (btn) { btn.textContent = '⏹ Stop'; btn.classList.add('recording'); }
  document.querySelector(`.section-item[data-id="${sectionId}"]`)?.classList.add('recording');
}

function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
  mediaRecorder.stop();
  clearInterval(recordingTimer);
  recordingTimer = null;
}

async function onRecordingComplete() {
  const blob = new Blob(recordingChunks, { type: 'audio/webm' });
  mediaRecorder = null;
  recordingChunks = [];
  const sectionId = recordingSection;
  recordingSection = null;

  if (!currentUser || !sectionId) return;

  const path = `${currentUser.id}/${sectionId}.webm`;
  const { error: uploadError } = await supabase.storage
    .from('composition-audio')
    .upload(path, blob, { upsert: true, contentType: 'audio/webm' });

  if (uploadError) { await alert('Failed to upload recording.'); return; }

  const { error } = await supabase
    .from('composition_sections')
    .update({ audio_url: path })
    .eq('id', sectionId);

  if (error) { await alert('Failed to save recording reference.'); return; }

  for (const comp of compositions) {
    const section = comp.sections.find(s => s.id === sectionId);
    if (section) { section.audio_url = path; break; }
  }
  renderCompositions();
}

// ============================================================
// Audio upload — creates a recording section from a local file
// ============================================================
function uploadAudioForComp(compId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'audio/*';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file || !currentUser) return;

    const title = file.name.replace(/\.[^/.]+$/, '');
    const section = await addSection(compId, 'recording', { title });
    if (!section?.id) return;

    const ext = file.name.split('.').pop() || 'audio';
    const path = `${currentUser.id}/${section.id}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('composition-audio')
      .upload(path, file, { upsert: true, contentType: file.type });

    if (uploadError) { await alert('Failed to upload audio.'); return; }

    const { error } = await supabase
      .from('composition_sections')
      .update({ audio_url: path })
      .eq('id', section.id);

    if (error) { await alert('Failed to save audio reference.'); return; }

    for (const comp of compositions) {
      const s = comp.sections.find(s => s.id === section.id);
      if (s) { s.audio_url = path; break; }
    }
    renderCompositions();
  };
  input.click();
}

// ============================================================
// Stitch toggle — loads all phrases into the grid + colours cells
// independently of playback.
// ============================================================
async function toggleStitch(compositionId) {
  if (stitched?.compositionId === compositionId) {
    doUnstitch();
    renderCompositions();
    return;
  }
  await ensureStitched(compositionId);
  renderCompositions();
}

// Restores the grid to the state it was in before stitching.
function doUnstitch() {
  if (!stitched) return;
  stopPlayback();
  if (stitched.savedState) {
    isLoadingSection = true;
    applyPattern(stitched.savedState, gridA).finally(() => { isLoadingSection = false; });
  }
  clearGridSectionColors();
  stitched = null;
}

// Loads + stitches all phrases for compositionId into the grid (from fromSectionIdx).
// Returns the boundaries array, or null on failure.
// Re-uses the existing stitched state if it's already for this composition.
async function ensureStitched(compositionId, fromSectionIdx = 0) {
  // Already stitched for this comp from the beginning — reuse
  if (stitched?.compositionId === compositionId && fromSectionIdx === 0) {
    return stitched.boundaries;
  }

  const comp = compositions.find(c => c.id === compositionId);
  if (!comp) return null;

  const phraseSections = comp.sections.filter(s => s.type === 'phrase' && s.phrase_name);
  if (!phraseSections.length) {
    await alert('No phrase sections to play. Add at least one phrase section first.');
    return null;
  }

  const fromSections = phraseSections.slice(fromSectionIdx);
  if (!fromSections.length) return null;

  // Save current grid state so we can restore it when toggling off
  const savedState = fromSectionIdx === 0
    ? { mode: gridA.mode || '16', labels: [...(gridA.innerLabels || [])],
        hands: [...(gridA.innerHands || [])], bpm: gridA.bpm }
    : stitched?.savedState ?? null;

  const allLabels  = [];
  const allHands   = [];
  const boundaries = [];
  let baseMode = '16';
  let baseBpm  = null;

  isLoadingSection = true;
  stop(gridA);

  try {
    let offset = 0;
    for (const section of fromSections) {
      let state;
      state = await loadSectionPattern(section);
      if (!state?.labels?.length) continue;
      if (!offset) { baseMode = state.mode || '16'; baseBpm = state.bpm ?? null; }
      boundaries.push({
        start:     offset,
        end:       offset + state.labels.length - 1,
        sectionId: section.id,
        color:     section.color ?? null,
        title:     section.phrase_name,
      });
      allLabels.push(...state.labels);
      allHands.push(...(Array.isArray(state.hands) ? state.hands : Array(state.labels.length).fill(null)));
      offset += state.labels.length;
    }

    if (!allLabels.length) {
      isLoadingSection = false;
      await alert('Could not load any phrases.');
      return null;
    }

    const pattern = { mode: baseMode, labels: allLabels, hands: allHands,
                      ...(baseBpm != null ? { bpm: baseBpm } : {}) };
    await applyPattern(pattern, gridA);
  } catch (e) {
    console.error('[Composer] stitch error', e);
    isLoadingSection = false;
    return null;
  }

  isLoadingSection = false;

  stitched = { compositionId, boundaries, savedState };
  applyGridSectionColors(boundaries);
  return boundaries;
}

// ============================================================
// Playback — uses stitched grid; stitches first if needed
// ============================================================
async function startPlayback(compositionId, fromSectionIdx = 0) {
  stopPlayback();

  const boundaries = await ensureStitched(compositionId, fromSectionIdx);
  if (!boundaries) return;

  const comp = compositions.find(c => c.id === compositionId);
  if (!comp) return;

  // ── Init playback state ──────────────────────────────────────
  playback = { compositionId, boundaries, currentSectionIdx: 0 };
  showPlaybar(comp.title);
  document.getElementById('composerPlayBtn').innerText = '■';
  updatePlaybarSection();
  highlightCurrentSection();

  // ── Tick observer: track section + stop at end ───────────────
  const lastStep = boundaries[boundaries.length - 1].end;
  playback.loopObserver = (ctx) => {
    if (ctx !== gridA || !playback) return;
    const step = ctx.step;

    const idx = playback.boundaries.findIndex(b => step >= b.start && step <= b.end);
    if (idx !== -1 && idx !== playback.currentSectionIdx) {
      playback.currentSectionIdx = idx;
      highlightCurrentSection();
      updatePlaybarSection();
    }

    if (step === lastStep) stopPlayback();
  };
  addTickObserver(playback.loopObserver);

  await start(gridA);
  renderCompositions();
  TransportRegistry.updateAll(gridA);
}

// Cleans up composer state without touching the transport — used when the
// grid stops externally (transport button) so we don't double-stop.
function cleanupPlayback() {
  if (!playback) return;
  // Preserve last playback so the bar stays in context after stopping
  lastPlayback = {
    compositionId:    playback.compositionId,
    currentSectionIdx: playback.currentSectionIdx,
    boundaries:       playback.boundaries,
  };
  if (playback.loopObserver) removeTickObserver(playback.loopObserver);
  playback = null;
  // Only clear grid colours if we're not still in stitched/compose mode
  if (!stitched) clearGridSectionColors();
  document.querySelectorAll('.section-item.playing').forEach(el => {
    el.classList.remove('playing');
    el.style.removeProperty('background');
    el.style.removeProperty('--section-playing-color');
  });
  // Keep playbar visible with last section info
  updatePlaybarSection();
}

// Header play button: always starts from section 0; stops if already playing this comp.
async function togglePlaybackFromStart(id) {
  if (playback?.compositionId === id && gridA.playing) {
    stopPlayback();
  } else {
    await startPlayback(id, 0);
  }
}

// Playbar play button: resumes from the most recently played section.
async function togglePlaybarPlayback() {
  if (playback && gridA.playing) {
    stopPlayback();
  } else {
    const compId = playback?.compositionId || lastPlayback?.compositionId;
    if (!compId) return;
    const fromIdx = lastPlayback
      ? absoluteSectionIdx(lastPlayback.compositionId, lastPlayback.currentSectionIdx)
      : 0;
    await startPlayback(compId, fromIdx);
  }
}

function stopPlayback() {
  if (!playback) return;
  cleanupPlayback();
  stop(gridA);
  TransportRegistry.updateAll(gridA);
  renderCompositions();
  document.getElementById('composerPlayBtn').innerText = '▶';
}

function nextSection() {
  const ctx = playback || lastPlayback;
  if (!ctx?.boundaries) return;
  const next = Math.min(ctx.currentSectionIdx + 1, ctx.boundaries.length - 1);
  if (next === ctx.currentSectionIdx) return;
  if (playback) {
    startPlayback(ctx.compositionId, absoluteSectionIdx(ctx.compositionId, next));
  } else {
    // Not playing — just update the displayed section in lastPlayback
    lastPlayback.currentSectionIdx = next;
    updatePlaybarSection();
  }
}

function prevSection() {
  const ctx = playback || lastPlayback;
  if (!ctx?.boundaries) return;
  const prev = Math.max(ctx.currentSectionIdx - 1, 0);
  if (prev === ctx.currentSectionIdx) return;
  if (playback) {
    startPlayback(ctx.compositionId, absoluteSectionIdx(ctx.compositionId, prev));
  } else {
    // Not playing — just update the displayed section in lastPlayback
    lastPlayback.currentSectionIdx = prev;
    updatePlaybarSection();
  }
}

// Map a boundary index (within fromSections slice) back to the composition's
// full phrase-section list so startPlayback(fromSectionIdx) is correct.
function absoluteSectionIdx(compositionId, boundaryIdx) {
  const comp = compositions.find(c => c.id === compositionId);
  if (!comp) return 0;
  const phraseSections = comp.sections.filter(s => s.type === 'phrase' && s.phrase_name);
  const targetId = playback?.boundaries?.[boundaryIdx]?.sectionId;
  const idx = phraseSections.findIndex(s => s.id === targetId);
  return idx >= 0 ? idx : 0;
}

function showPlaybar(title) {
  const bar = document.getElementById('composerPlaybar');
  if (!bar) return;
  bar.style.display = '';
  bar.removeAttribute('aria-hidden');
  document.getElementById('composerPlaybarTitle').textContent = title;
  // Seek bar is only shown for audio recordings; hide it for phrase playback
  hideSeekBar();
  audioSectionId = null;
  updatePlaybarSection();
}

function hidePlaybar() {
  const bar = document.getElementById('composerPlaybar');
  if (!bar) return;
  bar.style.display = 'none';
  bar.setAttribute('aria-hidden', 'true');
}

function updatePlaybarSection() {
  const el = document.getElementById('composerPlaybarSection');
  if (!el) return;
  const ctx = playback || lastPlayback;
  if (!ctx) { el.textContent = ''; return; }
  const b = ctx.boundaries?.[ctx.currentSectionIdx];
  el.textContent = b
    ? `Section ${ctx.currentSectionIdx + 1} / ${ctx.boundaries.length} — ${b.title || '(untitled)'}`
    : '';
}

// ============================================================
// Grid section colouring
// ============================================================
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function applyGridSectionColors(boundaries) {
  clearGridSectionColors();
  const cells = gridA.cells;
  boundaries.forEach(({ start, end, color }, i) => {
    const hex  = color || PALETTE[i % PALETTE.length];
    const fill = hexToRgba(hex, 0.18);
    const border = hexToRgba(hex, 0.7);
    for (let step = start; step <= end; step++) {
      const cell = cells[step];
      if (!cell) continue;
      cell.style.setProperty('--section-bg', fill);
      cell.style.setProperty('--section-border', border);
      cell.classList.add('composer-section-tinted');
      if (step === start) cell.classList.add('composer-section-start');
    }
  });
}

function clearGridSectionColors() {
  gridA.container?.querySelectorAll('.composer-section-tinted').forEach(cell => {
    cell.style.removeProperty('--section-bg');
    cell.style.removeProperty('--section-border');
    cell.classList.remove('composer-section-tinted', 'composer-section-start');
  });
}

function highlightCurrentSection() {
  document.querySelectorAll('.section-item.playing').forEach(el => {
    el.classList.remove('playing');
    el.style.removeProperty('background');
    el.style.removeProperty('--section-playing-color');
  });
  const b = playback?.boundaries?.[playback.currentSectionIdx];
  if (!b) return;
  const el = document.querySelector(`.section-item[data-id="${b.sectionId}"]`);
  if (!el) return;
  const color = b.color || PALETTE[playback.currentSectionIdx % PALETTE.length];
  el.classList.add('playing');
  el.style.background = hexToRgba(color, 0.3);
  el.style.setProperty('--section-playing-color', color);
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ============================================================
// Render
// ============================================================
function setListHTML(html) {
  const el = document.getElementById('compositionList');
  if (el) el.innerHTML = html;
}

function renderCompositions(forceExpandId = null, opts = {}) {
  if (forceExpandId) expandedId = forceExpandId;

  if (!currentUser) {
    setListHTML('<div class="composer-empty"><p>Sign in to use Song Composer.</p></div>');
    return;
  }

  if (!compositions.length) {
    setListHTML('<div class="composer-empty"><p>No compositions yet.</p><p>Tap "+ New Composition" to start.</p></div>');
    return;
  }

  const html = compositions.map(comp => renderCompositionItem(comp, opts)).join('');
  setListHTML(html);
  bindSectionListeners();
}

function renderCompositionItem(comp, opts = {}) {
  const isExpanded  = expandedId === comp.id;
  const isPlaying   = playback?.compositionId === comp.id && gridA.playing;
  const isStitched  = stitched?.compositionId === comp.id;

  const playIcon  = isPlaying ? '■' : '▶';
  const playTitle = isPlaying ? 'Stop' : 'Play composition';

  const showPicker  = opts.showPhrasePicker && isExpanded;
  const phraseNames = opts.phraseNames || [];

  const sectionsHTML = isExpanded
    ? `
      <div class="composition-sections">
        ${(() => { let pi = 0; return comp.sections.map((s, i) => renderSectionItem(s, i, s.type === 'phrase' ? pi++ : -1)).join(''); })()}
        ${showPicker ? renderPhrasePicker(comp.id, phraseNames) : ''}
        <div class="add-section-row">
          <button class="add-section-btn" data-action="add-phrase" data-comp="${comp.id}">➕ Phrase</button>
          <button class="add-section-btn" data-action="add-from-grid" data-comp="${comp.id}">➕ From Grid</button>
          <button class="add-section-btn" data-action="add-recording" data-comp="${comp.id}">🎙 Record</button>
          <button class="add-section-btn" data-action="add-upload" data-comp="${comp.id}">⬆ Upload</button>
          <button class="add-section-btn" data-action="add-note" data-comp="${comp.id}">✏️ Note</button>
        </div>
      </div>`
    : '';

  return `
    <div class="composition-item${isExpanded ? ' expanded' : ''}" data-id="${comp.id}">
      <div class="composition-header" data-action="toggle-comp" data-id="${comp.id}">
        <span class="composition-chevron">▶</span>
        <span class="composition-title">${esc(comp.title)}</span>
        <button class="composition-stitch-btn${isStitched ? ' active' : ''}"
          data-action="toggle-stitch" data-id="${comp.id}" title="${isStitched ? 'Exit compose view' : 'Show song in grid'}">
          🎨
        </button>
        <button class="composition-play-btn${isPlaying ? ' active' : ''}"
          data-action="play-comp" data-id="${comp.id}" title="${playTitle}">
          ${playIcon}
        </button>
        <button class="composition-menu-btn"
          data-action="menu-comp" data-id="${comp.id}" title="Options">⋮</button>
      </div>
      ${sectionsHTML}
    </div>`;
}

function renderSectionItem(s, _index = 0, phraseIndex = 0) {
  const icon  = { phrase: '🎵', recording: '🎙', note: '✏️' }[s.type] ?? '•';
  const label = s.title || s.phrase_name || (s.type === 'note' ? 'Note' : s.type);
  const sub   = s.type === 'phrase' && s.phrase_name ? s.phrase_name
              : s.type === 'recording' ? (s.audio_url ? 'Recorded' : 'No recording yet')
              : s.type === 'note' ? (s.note_text || '') : '';

  const swatchColor = s.color || PALETTE[phraseIndex % PALETTE.length];
  const isPlayingSection = playback?.boundaries?.[playback?.currentSectionIdx]?.sectionId === s.id;
  const playingStyle = s.type === 'phrase'
    ? `background:${hexToRgba(swatchColor, isPlayingSection ? 0.45 : 0.25)};--section-playing-color:${swatchColor};`
    : '';
  const colorSwatch = s.type === 'phrase'
    ? `<button class="section-color-swatch" data-action="pick-color" data-id="${s.id}"
    style="background:${esc(swatchColor)}" title="Change section colour"></button>`
    : '';

  const recordControls = s.type === 'recording' ? `
    <div class="recording-controls" data-record-controls="${s.id}">
      <button class="record-btn" data-record-btn="${s.id}" data-section="${s.id}"
        data-action="toggle-record">
        ${s.audio_url ? '⏺ Re-record' : '⏺ Record'}
      </button>
      ${s.audio_url ? `<button class="add-section-btn" style="flex:none; padding:5px 8px;"
        data-action="play-recording" data-section="${s.id}">▶</button>
      <button class="add-section-btn" style="flex:none; padding:5px 8px;"
        data-action="trim-recording" data-section="${s.id}" title="Trim recording">✂</button>` : ''}
      <span class="record-timer" data-record-timer="${s.id}"></span>
    </div>` : '';

  const noteEditor = s.type === 'note' ? `
    <div class="note-editor">
      <textarea rows="2" data-note-section="${s.id}"
        placeholder="Add notes…">${esc(s.note_text || '')}</textarea>
    </div>` : '';

  return `
    <div class="section-item${isPlayingSection ? ' playing' : ''}" draggable="true"
      data-id="${s.id}" data-type="${s.type}" data-comp="${sectionCompId(s.id)}"
      style="${playingStyle}">
      <span class="drag-handle" title="Drag to reorder">⠿⠿</span>
      <span class="section-icon">${icon}</span>
      <div class="section-info${s.type === 'phrase' ? ' clickable' : ''}"
        ${s.type === 'phrase' ? `data-action="edit-section" data-id="${s.id}"` : ''}>
        <span class="section-title">${esc(label)}</span>
        ${sub ? `<span class="section-subtitle">${esc(sub)}</span>` : ''}
      </div>
      ${s.type === 'phrase' ? `
      <button class="section-action-btn" data-action="play-section" data-id="${s.id}" title="Play phrase">▶</button>
      ` : ''}
      ${colorSwatch}
      <button class="section-action-btn section-menu-btn" data-action="section-menu" data-id="${s.id}" data-type="${s.type}" title="More options">···</button>
    </div>
    ${recordControls}
    ${noteEditor}`;
}

function renderPhrasePicker(compId, names) {
  if (!names.length) {
    return `<div class="phrase-picker">
      <div class="phrase-picker-empty">No saved phrases found.</div>
    </div>`;
  }
  const items = names.map(n =>
    `<div class="phrase-picker-item" data-action="pick-phrase" data-comp="${compId}" data-name="${esc(n)}">${esc(n)}</div>`
  ).join('');
  return `<div class="phrase-picker"><div class="phrase-picker-list">${items}</div></div>`;
}

function sectionCompId(sectionId) {
  for (const comp of compositions) {
    if (comp.sections.find(s => s.id === sectionId)) return comp.id;
  }
  return '';
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================================
// Event delegation (all clicks inside #composerSidebar)
// ============================================================
function bindSectionListeners() {
  document.querySelectorAll('.section-item[draggable]').forEach(el => {
    el.addEventListener('dragstart', onDragStart);
    el.addEventListener('dragover',  onDragOver);
    el.addEventListener('dragleave', onDragLeave);
    el.addEventListener('drop',      onDrop);
    el.addEventListener('dragend',   onDragEnd);
  });

  document.querySelectorAll('[data-note-section]').forEach(ta => {
    ta.addEventListener('input', debounce(() => {
      updateNoteText(ta.dataset.noteSection, ta.value);
    }, 600));
  });
}

// ============================================================
// Drag-and-drop
// ============================================================
let dragSrcId = null;

function onDragStart(e) {
  dragSrcId = this.dataset.id;
  this.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.section-item.drag-over').forEach(el => el.classList.remove('drag-over'));
  if (this.dataset.id !== dragSrcId) this.classList.add('drag-over');
}

function onDragLeave() {
  this.classList.remove('drag-over');
}

async function onDrop(e) {
  e.preventDefault();
  this.classList.remove('drag-over');
  const targetId = this.dataset.id;
  if (!dragSrcId || dragSrcId === targetId) return;

  const compId = this.dataset.comp;
  const comp = compositions.find(c => c.id === compId);
  if (!comp) return;

  const srcIdx = comp.sections.findIndex(s => s.id === dragSrcId);
  const tgtIdx = comp.sections.findIndex(s => s.id === targetId);
  if (srcIdx === -1 || tgtIdx === -1) return;

  const [moved] = comp.sections.splice(srcIdx, 1);
  comp.sections.splice(tgtIdx, 0, moved);

  await reorderSections(compId, comp.sections.map(s => s.id));

  // If this composition is currently playing, re-stitch so the grid reflects the new order
  if (playback?.compositionId === compId) {
    startPlayback(compId);
  } else {
    renderCompositions();
  }
}

function onDragEnd() {
  dragSrcId = null;
  document.querySelectorAll('.section-item.dragging, .section-item.drag-over')
    .forEach(el => el.classList.remove('dragging', 'drag-over'));
}

// ============================================================
// Context menu
// ============================================================
let contextMenu = null;
let contextMenuTrigger = null;

// Prefer the stored snapshot; fall back to a live name lookup for older sections.
async function loadSectionPattern(section) {
  if (section.pattern_snapshot?.labels?.length) return section.pattern_snapshot;
  if (section.phrase_name) {
    try { return await dbLoadPatternByName(section.phrase_name); } catch (_) {}
  }
  return null;
}

async function editSection(sectionId) {
  let section = null;
  for (const c of compositions) {
    section = c.sections.find(s => s.id === sectionId);
    if (section) break;
  }
  if (!section) return;
  if (hasUnsavedChanges()) {
    if (!await confirm('You have unsaved changes. Discard them?')) return;
  }
  if (stitched) doUnstitch();
  const state = await loadSectionPattern(section);
  if (state) {
    isLoadingSection = true;
    await applyPattern(state, gridA);
    isLoadingSection = false;
    updateCurrentPhraseName(section.phrase_name);
  }
  renderCompositions();
}

function showSectionMenu(triggerBtn, sectionId, sectionType) {
  removeContextMenu();
  const menu = document.createElement('div');
  menu.className = 'composer-context-menu';

  const items = [];
  items.push(`<button data-action="copy">⧉ Duplicate</button>`);
  items.push(`<button data-action="delete" class="danger">✕ Delete</button>`);
  menu.innerHTML = items.join('');

  // Position below the trigger button, right-aligned to it
  const rect = triggerBtn.getBoundingClientRect();
  menu.style.right = `${window.innerWidth - rect.right}px`;
  menu.style.top   = `${rect.bottom + 4}px`;
  menu.style.left  = 'auto';
  document.body.appendChild(menu);
  contextMenu = menu;
  contextMenuTrigger = triggerBtn;

  menu.addEventListener('click', async e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    removeContextMenu();
    if (btn.dataset.action === 'edit')   await editSection(sectionId);
    if (btn.dataset.action === 'copy')   await copySection(sectionId);
    if (btn.dataset.action === 'delete') await deleteSection(sectionId);
  });

  setTimeout(() => {
    document.addEventListener('click', removeContextMenu, { once: true });
  }, 0);
}

function showContextMenu(x, y, compId) {
  removeContextMenu();
  const menu = document.createElement('div');
  menu.className = 'composer-context-menu';
  menu.innerHTML = `
    <button data-action="print" data-id="${compId}">🖨 Print</button>
    <button data-action="share" data-id="${compId}">🔗 Share</button>
    <button data-action="save-as" data-id="${compId}">💾 Save As...</button>
    <button data-action="rename" data-id="${compId}">✏️ Rename</button>
    <button data-action="delete" data-id="${compId}" class="danger">🗑 Delete</button>`;
  menu.style.left = `${x}px`;
  menu.style.top  = `${y}px`;
  document.body.appendChild(menu);
  contextMenu = menu;

  menu.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    removeContextMenu();
    if (btn.dataset.action === 'print') printComposition(btn.dataset.id);
    else if (btn.dataset.action === 'share') shareComposition(btn.dataset.id);
    else if (btn.dataset.action === 'save-as') saveAsPhrase(btn.dataset.id);
    else if (btn.dataset.action === 'rename') renameComposition(btn.dataset.id);
    else if (btn.dataset.action === 'delete') deleteComposition(btn.dataset.id);
  });

  setTimeout(() => {
    document.addEventListener('click', removeContextMenu, { once: true });
  }, 0);
}

function removeContextMenu() {
  contextMenu?.remove();
  contextMenu = null;
  contextMenuTrigger = null;
}

// ============================================================
// Recording playback
// ============================================================
let audioPlayer    = null;
let audioSectionId = null; // section currently loaded in audioPlayer

function fmtTime(secs) {
  if (!isFinite(secs) || isNaN(secs)) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function showSeekBar() {
  document.getElementById('composerSeekRow').style.display = '';
}

function hideSeekBar() {
  document.getElementById('composerSeekRow').style.display = 'none';
}

function updateSeek() {
  if (!audioPlayer) return;
  const dur = isFinite(audioPlayer.duration) ? audioPlayer.duration : 0;
  const pct = dur ? (audioPlayer.currentTime / dur) * 100 : 0;
  document.getElementById('composerSeekBar').value            = pct;
  document.getElementById('composerSeekCurrent').textContent  = fmtTime(audioPlayer.currentTime);
  document.getElementById('composerSeekDuration').textContent = fmtTime(dur);
}

function stopAudioPlayback() {
  if (!audioPlayer) return;
  audioPlayer.pause();
  audioPlayer.onloadedmetadata  = null;
  audioPlayer.ondurationchange  = null;
  audioPlayer.ontimeupdate      = null;
  audioPlayer.onended           = null;
  audioPlayer = null;
  document.getElementById('composerPlayBtn').innerText = '▶';
}

// Returns all recording sections (with audio) across a composition, in order.
function recordingSectionsForComp(compositionId) {
  const comp = compositions.find(c => c.id === compositionId);
  if (!comp) return [];
  return comp.sections.filter(s => s.type === 'recording' && s.audio_url);
}

async function playRecording(sectionId) {
  // Find section + its composition
  let section = null;
  let compId  = null;
  for (const comp of compositions) {
    const s = comp.sections.find(s => s.id === sectionId);
    if (s?.audio_url) { section = s; compId = comp.id; break; }
  }
  if (!section) return;

  const { data, error } = await supabase.storage
    .from('composition-audio')
    .createSignedUrl(section.audio_url, 3600);
  if (error || !data?.signedUrl) return;

  stopAudioPlayback();
  stopPlayback(); // stop phrase playback if running

  audioPlayer = new Audio(data.signedUrl);

  // Show playbar in audio mode (showPlaybar resets audioSectionId, so set it after)
  const comp = compositions.find(c => c.id === compId);
  showPlaybar(comp?.title ?? 'Recording');
  audioSectionId = sectionId;
  document.getElementById('composerPlaybarSection').textContent = section.title || '(untitled recording)';
  showSeekBar();
  document.getElementById('composerPlayBtn').innerText = '■';

  audioPlayer.ontimeupdate = updateSeek;

  audioPlayer.onended = () => {
    document.getElementById('composerPlayBtn').innerText = '▶';
    audioPlayer.ontimeupdate = null;
  };

  audioPlayer.onloadedmetadata = () => {
    if (!isFinite(audioPlayer.duration)) {
      // Seek past the end to force the browser to discover the real duration via range requests.
      // We do NOT call play() yet — we wait for ondurationchange to reset to 0 first.
      audioPlayer.currentTime = 1e10;
    } else {
      updateSeek();
      audioPlayer.play();
    }
  };

  audioPlayer.ondurationchange = () => {
    if (isFinite(audioPlayer.duration)) {
      audioPlayer.ondurationchange = null; // only handle once
      audioPlayer.currentTime = 0;
      updateSeek();
      audioPlayer.play();
    }
  };
}

function audioNextSection() {
  if (!audioSectionId) return;
  let compId = null;
  for (const comp of compositions) {
    if (comp.sections.find(s => s.id === audioSectionId)) { compId = comp.id; break; }
  }
  const recs = recordingSectionsForComp(compId);
  const idx  = recs.findIndex(s => s.id === audioSectionId);
  if (idx === -1 || idx >= recs.length - 1) return;
  playRecording(recs[idx + 1].id);
}

function audioPrevSection() {
  if (!audioSectionId) return;
  let compId = null;
  for (const comp of compositions) {
    if (comp.sections.find(s => s.id === audioSectionId)) { compId = comp.id; break; }
  }
  const recs = recordingSectionsForComp(compId);
  const idx  = recs.findIndex(s => s.id === audioSectionId);
  if (idx <= 0) return;
  playRecording(recs[idx - 1].id);
}

// ============================================================
// Top-level click delegation
// ============================================================
composerEl?.addEventListener('click', async (e) => {
  // Section item click (not on a button) → scroll grid to that section's cells
  const sectionItem = e.target.closest('.section-item');
  if (sectionItem && !e.target.closest('[data-action]')) {
    const sectionId = sectionItem.dataset.id;
    const b = playback?.boundaries?.find(b => b.sectionId === sectionId);
    if (b != null) gridA.cells[b.start]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }

  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  e.stopPropagation();

  const action = btn.dataset.action;
  const id     = btn.dataset.id;
  const comp   = btn.dataset.comp;

  switch (action) {
    case 'toggle-comp':
      expandedId = (expandedId === id) ? null : id;
      renderCompositions();
      let songTitle = '';
      let el = e.target.closest('span.composition-title');
      if (!el) el = e.target.querySelector('span.composition-title');
      if (el) songTitle = el.innerText;
      showPlaybar(songTitle);
      updatePlaybarSection();
      break;

    case 'toggle-stitch':
      await toggleStitch(id);
      break;

    case 'play-comp':
      togglePlaybackFromStart(id);
      break;

    case 'menu-comp': {
      const rect = btn.getBoundingClientRect();
      showContextMenu(rect.left, rect.bottom + 4, id);
      break;
    }

    case 'add-phrase':
      await showPhrasePicker(comp);
      break;

    case 'add-from-grid':
      await addPhraseFromGrid(comp);
      break;

    case 'pick-phrase': {
      const name = btn.dataset.name;
      let snapshot = null;
      try { snapshot = await dbLoadPatternByName(name); } catch (_) {}
      await addSection(comp, 'phrase', { title: name, phrase_name: name, pattern_snapshot: snapshot });
      expandedId = comp;
      renderCompositions();
      break;
    }

    case 'add-recording':
      await addSection(comp, 'recording', { title: 'Recording' });
      break;

    case 'add-upload':
      uploadAudioForComp(comp);
      break;

    case 'add-note':
      await addSection(comp, 'note', { title: 'Note' });
      break;

    case 'section-menu':
      if (contextMenuTrigger === btn) {
        removeContextMenu();
      } else {
        showSectionMenu(btn, id, btn.dataset.type);
      }
      break;

    case 'edit-section':
      await editSection(id);
      break;

    case 'play-section': {
      // Exit stitch mode, load just this phrase, and play it on loop
      let playSection = null;
      for (const c of compositions) { playSection = c.sections.find(s => s.id === id); if (playSection) break; }
      if (!playSection) break;
      if (stitched) doUnstitch();
      stopPlayback();
      const playState = await loadSectionPattern(playSection);
      if (playState) {
        isLoadingSection = true;
        await applyPattern(playState, gridA);
        isLoadingSection = false;
      }
      if (!playback) { // not cancelled
        await start(gridA);
        TransportRegistry.updateAll(gridA);
        renderCompositions();
      }
      break;
    }

    case 'copy-section':
      await copySection(id);
      break;

    case 'delete-section':
      await deleteSection(id);
      break;

    case 'toggle-record': {
      const secId = btn.dataset.section;
      if (mediaRecorder && recordingSection === secId) {
        stopRecording();
      } else {
        await startRecording(secId);
      }
      break;
    }

    case 'play-recording':
      await playRecording(btn.dataset.section);
      break;

    case 'trim-recording': {
      const trimSecId = btn.dataset.section;
      let trimSection = null, trimComp = null;
      for (const c of compositions) {
        const s = c.sections.find(s => s.id === trimSecId);
        if (s) { trimSection = s; trimComp = c; break; }
      }
      if (!trimSection?.audio_url) break;

      const { data: trimUrlData, error: trimUrlErr } = await supabase.storage
        .from('composition-audio')
        .createSignedUrl(trimSection.audio_url, 3600);
      if (trimUrlErr || !trimUrlData?.signedUrl) break;

      stopAudioPlayback();
      await openTrimUI(trimSecId, {
        section:    trimSection,
        compTitle:  trimComp.title,
        signedUrl:  trimUrlData.signedUrl,
        onClose() {
          if (audioSectionId) document.getElementById('composerSeekRow').style.display = '';
        },
        onApply(newAudioUrl) {
          if (newAudioUrl) trimSection.audio_url = newAudioUrl;
        },
      });
      break;
    }

    case 'pick-color': {
      let currentColor = '#4a90e2';
      for (const comp of compositions) {
        const sec = comp.sections.find(s => s.id === id);
        if (sec) { currentColor = sec.color || currentColor; break; }
      }
      const rect = btn.getBoundingClientRect();
      const picker = document.createElement('input');
      picker.type  = 'color';
      picker.value = currentColor;
      Object.assign(picker.style, {
        position: 'fixed',
        left: `${rect.left}px`,
        top:  `${rect.bottom + 4}px`,
        width: '0', height: '0',
        opacity: '0', pointerEvents: 'none',
        padding: '0', border: '0',
      });
      document.body.appendChild(picker);
      picker.addEventListener('input', (ev) => updateSectionColor(id, ev.target.value));
      picker.addEventListener('change', () => picker.remove());
      picker.addEventListener('blur', () => picker.remove());
      picker.click();
      break;
    }
  }
});

// Playbar buttons — audio-mode aware
document.getElementById('composerPlayBtn')?.addEventListener('click', () => {
  if (audioSectionId) {
    if (audioPlayer && !audioPlayer.paused) {
      audioPlayer.pause();
      document.getElementById('composerPlayBtn').innerText = '▶';
    } else if (audioPlayer) {
      audioPlayer.play();
      document.getElementById('composerPlayBtn').innerText = '■';
    } else {
      playRecording(audioSectionId); // replay from start
    }
  } else {
    togglePlaybarPlayback();
  }
});

document.getElementById('composerNextBtn')?.addEventListener('click', () => {
  if (audioSectionId) audioNextSection(); else nextSection();
});

document.getElementById('composerPrevBtn')?.addEventListener('click', () => {
  if (audioSectionId) audioPrevSection(); else prevSection();
});

// ============================================================
// Shared Composition Link Handling
// ============================================================

const SHARED_COMP_KEY = 'pendingSharedComp';

let sharedCompToken = null;

function clearSharedCompURL() {
  const url = new URL(location.href);
  url.searchParams.delete('comp');
  history.replaceState({}, '', url.toString());
}

function updateSharedCompBanner(comp, creatorName) {
  const banner = document.getElementById('sharedCompBanner');
  const sub = document.getElementById('sharedCompBannerSub');
  if (!banner) return;
  const by = creatorName && creatorName !== 'Unknown' ? ` by ${creatorName}` : '';
  sub.textContent = `"${comp.title}"${by} — you can view and add this to your Composer.`;
  banner.style.display = 'flex';
}

function hideSharedCompBanner() {
  const banner = document.getElementById('sharedCompBanner');
  if (banner) banner.style.display = 'none';
  sharedCompToken = null;
}

export async function loadSharedCompositionFromURL() {
  const sp = new URLSearchParams(location.search);
  const token = sp.get('comp');
  if (!token) return false;

  sharedCompToken = token;

  // Not logged in — store token and prompt auth
  if (!currentUser) {
    sessionStorage.setItem(SHARED_COMP_KEY, token);
    clearSharedCompURL();
    Bus.emit(BUS_EVENT.OPEN_AUTH_MODAL);
    return false;
  }

  return _openSharedComposition(token);
}

async function _openSharedComposition(token) {
  const { data, error } = await supabase
    .from('compositions')
    .select('id, title, user_id, share_token, composition_sections(*)')
    .eq('share_token', token)
    .maybeSingle();

  if (error || !data) {
    await alert('That share link is invalid or the composition is no longer shared.');
    clearSharedCompURL();
    return false;
  }

  // Build comp object and inject into panel
  const comp = {
    ...data,
    sections: (data.composition_sections || []).sort((a, b) => a.position - b.position),
  };

  // Get creator name
  let creatorName = 'Unknown';
  const { getProfileById } = await import('./profile.js');
  if (data.user_id) {
    const profile = await getProfileById(data.user_id);
    if (profile?.username) creatorName = profile.username;
  }

  // Open composer and display the shared comp (read-only — not in user's compositions array)
  openComposer();
  const list = document.getElementById('compositionList');
  if (list) {
    list.innerHTML = '';
    // Temporarily render just this shared comp
    const placeholder = document.createElement('div');
    placeholder.className = 'shared-comp-preview';
    placeholder.innerHTML = renderSharedCompPreview(comp);
    list.appendChild(placeholder);
  }

  updateSharedCompBanner(comp, creatorName);
  clearSharedCompURL();

  // Wire Add + Exit buttons
  document.getElementById('sharedCompAddBtn')?.addEventListener('click', () => addSharedCompToMyComposer(comp), { once: true });
  document.getElementById('sharedCompExitBtn')?.addEventListener('click', () => {
    hideSharedCompBanner();
    fetchCompositions(); // restore user's own compositions
  }, { once: true });

  return true;
}

function renderSharedCompPreview(comp) {
  const sections = comp.sections || [];
  const rows = sections.map(s => {
    const icon = s.type === 'phrase' ? '🎵' : s.type === 'recording' ? '🎙' : '✏️';
    return `<div class="section-row">${icon} ${esc(s.title || s.phrase_name || 'Untitled')}</div>`;
  }).join('');
  return `
    <div class="composition-header" style="cursor:default;">
      <span class="comp-title">${esc(comp.title)}</span>
    </div>
    <div class="section-list">${rows || '<div class="empty-state">No sections</div>'}</div>`;
}

async function addSharedCompToMyComposer(sourceComp) {
  if (!currentUser) { await alert('Sign in to add this composition.'); return; }

  const title = await prompt('Save composition as:', sourceComp.title);
  if (!title?.trim()) return;

  // Create new composition
  const { data: newComp, error } = await supabase
    .from('compositions')
    .insert({ user_id: currentUser.id, title: title.trim() })
    .select('id, title, created_at')
    .single();

  if (error) { await alert('Could not add composition.'); return; }

  // Copy sections — for phrase sections without a snapshot, fetch pattern data now
  // while we still have read access via the source composition's RLS context.
  const sectionsToInsert = [];
  for (const [i, s] of (sourceComp.sections || []).entries()) {
    let snapshot = s.pattern_snapshot ?? null;
    if (!snapshot && s.type === 'phrase' && s.phrase_name) {
      try { snapshot = await dbLoadPatternByName(s.phrase_name); } catch (_) {}
    }
    sectionsToInsert.push({
      composition_id:   newComp.id,
      position:         i,
      type:             s.type,
      title:            s.title,
      phrase_name:      s.phrase_name,
      note_text:        s.note_text,
      color:            s.color,
      pattern_snapshot: snapshot,
      // audio_url intentionally omitted — recordings are user-specific storage paths
    });
  }

  if (sectionsToInsert.length) {
    await supabase.from('composition_sections').insert(sectionsToInsert);
  }

  hideSharedCompBanner();
  compositions.unshift({ ...newComp, sections: sectionsToInsert });
  expandedId = newComp.id;
  renderCompositions();
  await alert(`"${title.trim()}" added to your Composer!`);
}

// After login, check if there's a pending shared composition to open
export async function resumePendingSharedComp() {
  const token = sessionStorage.getItem(SHARED_COMP_KEY);
  if (!token) return;
  sessionStorage.removeItem(SHARED_COMP_KEY);
  await _openSharedComposition(token);
}

// Seek bar
document.getElementById('composerSeekBar')?.addEventListener('input', (e) => {
  if (!audioPlayer || !isFinite(audioPlayer.duration) || !audioPlayer.duration) return;
  audioPlayer.currentTime = (audioPlayer.duration * e.target.value) / 100;
  updateSeek();
});

// Header "Composer" button
document.getElementById('toggleComposerBtn')?.addEventListener('click', () => {
  toggleComposer();
  document.getElementById('accountDropdownMenu')?.classList.remove('show');
});

// New Composition button
document.getElementById('newCompositionBtn')?.addEventListener('click', createComposition);

// Close button
document.getElementById('closeComposerSidebar')?.addEventListener('click', closeComposer);

// ============================================================
// Utilities
// ============================================================
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
