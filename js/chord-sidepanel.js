// Chords sidepanel: the scale's chord library (js/chord-ui.js) plus a song
// builder — named sections (Verse A, Chorus…) of chord slots — with Send to
// Studio and a full-screen stage view for jamming (js/chord-stage.js).
import ChordUI, { CHORD_DRAG_TYPE } from './chord-ui.js';
import { Sidepanel, updateBodySidebarClass, setLastSidebarType, registerPanelOpener } from './sidepanel.js';
import { closeSidebar } from './courses.js';
import { highlightChordNotes, playChordNotes, notesToLabels } from './chord-playback.js';
import { setChordHighlight } from './handpanmap.js';
import { createChordShapeDiagramEl, updateChordShapeDiagram } from './chord-shape-diagram.js';
import { abbreviateChord, chordShortLabel, sendChordsToStudio } from './progression-to-grid.js';
import { getInversionLabel } from './chord-analyzer.js';
import { getSelectedScaleName } from './state.js';
import { confirm } from './alert.js';
import { openChordStage } from './chord-stage.js';

const SLOT_DRAG_TYPE = 'application/x-panafide-slot';
const SECTION_NAMES = ['Verse A', 'Verse B', 'Chorus', 'Bridge', 'Intro', 'Outro'];
const SECTION_COLORS = 6; // css/chord-sidepanel.css defines [data-color="0".."5"]
const DEFAULT_SLOTS = 4;
const MAX_SLOTS = 8;
const PLAY_SPACING_MS = 750;

let panel = null;
let song = null; // { title, sections: [{ id, name, color, slots: [chord|null] }] }
let activeSectionId = null;
let targetSlot = null; // { sectionId, index } — empty slot picked for the next tap-to-add
let playTimers = [];
let els = {};

// --- Persistence (per scale: chords are tied to the scale's notes) ---

function storageKey() {
  const scale = (getSelectedScaleName() || 'default').toLowerCase().replace(/\s+/g, '_');
  return `chord_song_v1_${scale}`;
}

function newId() {
  return Math.random().toString(36).slice(2, 10);
}

function newSection(name, color) {
  return { id: newId(), name, color, slots: Array(DEFAULT_SLOTS).fill(null) };
}

function emptySong() {
  return { title: '', sections: [newSection(SECTION_NAMES[0], 0)] };
}

function loadSong() {
  try {
    const raw = localStorage.getItem(storageKey());
    song = raw ? JSON.parse(raw) : emptySong();
  } catch {
    song = emptySong();
  }
  if (!song.sections?.length) song = emptySong();
  activeSectionId = song.sections[0].id;
  targetSlot = null;
}

function saveSong() {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(song));
  } catch {
    // ignore (private browsing, quota, etc.)
  }
}

// Only what the builder and stage need; keeps saved songs small.
function storedChord(c) {
  return { root: c.root, quality: c.quality, name: c.name, inversion: c.inversion || 0, notes: c.notes, playable: c.playable };
}

// --- Song editing ---

function findSection(id) {
  return song.sections.find(s => s.id === id);
}

function commit() {
  saveSong();
  render();
}

function nextSectionName() {
  const used = new Set(song.sections.map(s => s.name));
  return SECTION_NAMES.find(n => !used.has(n)) || `Section ${song.sections.length + 1}`;
}

function addSection() {
  const section = newSection(nextSectionName(), song.sections.length % SECTION_COLORS);
  song.sections.push(section);
  activeSectionId = section.id;
  commit();
  els.sections.querySelector(`[data-section-id="${section.id}"] .cs-section-name`)?.focus();
}

function duplicateSection(id) {
  const idx = song.sections.findIndex(s => s.id === id);
  const copy = { ...structuredClone(song.sections[idx]), id: newId() };
  song.sections.splice(idx + 1, 0, copy);
  activeSectionId = copy.id;
  commit();
}

function moveSection(id, delta) {
  const idx = song.sections.findIndex(s => s.id === id);
  const to = idx + delta;
  if (to < 0 || to >= song.sections.length) return;
  const [moved] = song.sections.splice(idx, 1);
  song.sections.splice(to, 0, moved);
  commit();
}

async function deleteSection(id) {
  const section = findSection(id);
  if (section.slots.some(Boolean) && !await confirm(`Delete "${section.name}" and its chords?`)) return;
  song.sections = song.sections.filter(s => s.id !== id);
  if (!song.sections.length) song.sections.push(newSection(SECTION_NAMES[0], 0));
  if (!findSection(activeSectionId)) activeSectionId = song.sections[0].id;
  commit();
}

function setSlot(sectionId, index, chord) {
  const section = findSection(sectionId);
  if (index >= section.slots.length) {
    if (section.slots.length >= MAX_SLOTS) return;
    section.slots.push(chord);
  } else {
    section.slots[index] = chord;
  }
  activeSectionId = sectionId;
  targetSlot = null;
  commit();
}

function addSlot(sectionId) {
  const section = findSection(sectionId);
  if (section.slots.length >= MAX_SLOTS) return;
  section.slots.push(null);
  commit();
}

// Filled → clear it; already empty → remove the slot entirely.
function removeSlot(sectionId, index) {
  const section = findSection(sectionId);
  if (section.slots[index]) section.slots[index] = null;
  else if (section.slots.length > 1) section.slots.splice(index, 1);
  targetSlot = null;
  commit();
}

function swapSlots(from, to) {
  const a = findSection(from.sectionId);
  const b = findSection(to.sectionId);
  if (to.index >= b.slots.length) {
    if (b.slots.length >= MAX_SLOTS) return;
    b.slots.push(null);
  }
  [a.slots[from.index], b.slots[to.index]] = [b.slots[to.index], a.slots[from.index]];
  commit();
}

// Tap-to-add (the touch-friendly path; drag-and-drop is desktop only):
// the picked empty slot, else the active section's first empty slot.
function addChordFromLibrary(chord) {
  const stored = storedChord(chord);
  if (targetSlot && findSection(targetSlot.sectionId)) {
    setSlot(targetSlot.sectionId, targetSlot.index, stored);
    return;
  }
  const section = findSection(activeSectionId) || song.sections[0];
  const empty = section.slots.findIndex(c => !c);
  setSlot(section.id, empty === -1 ? section.slots.length : empty, stored);
}

async function clearSong() {
  if (!await confirm('Start a new song? This clears every section.')) return;
  song = emptySong();
  activeSectionId = song.sections[0].id;
  targetSlot = null;
  commit();
}

// --- Playback / send ---

// Flat play order for the stage and Send to Studio; empty slots skipped.
export function songSequence(s = song) {
  const seq = [];
  s.sections.forEach((section, sectionIndex) => {
    section.slots.forEach((chord, slotIndex) => {
      if (chord?.notes) seq.push({ chord, section, sectionIndex, slotIndex });
    });
  });
  return seq;
}

function stopPlayback() {
  playTimers.forEach(clearTimeout);
  playTimers = [];
  els.sections?.querySelectorAll('.cs-slot.playing').forEach(el => el.classList.remove('playing'));
}

function playSong() {
  stopPlayback();
  const seq = songSequence();
  seq.forEach(({ chord, section, slotIndex }, i) => {
    playTimers.push(setTimeout(() => {
      els.sections.querySelectorAll('.cs-slot.playing').forEach(el => el.classList.remove('playing'));
      els.sections.querySelector(`[data-section-id="${section.id}"] .cs-slot[data-slot="${slotIndex}"]`)?.classList.add('playing');
      playChordNotes(chord.notes);
      highlightChordNotes(chord, true);
    }, i * PLAY_SPACING_MS));
  });
  playTimers.push(setTimeout(() => {
    stopPlayback();
    setChordHighlight([], false);
  }, seq.length * PLAY_SPACING_MS + 400));
}

function phraseName() {
  if (song.title.trim()) return song.title.trim();
  return `Chords ${songSequence().map(({ chord }) => chordShortLabel(chord)).join(' ')}`;
}

async function sendToStudio() {
  const chords = songSequence().map(({ chord }) => chord);
  if (!chords.length) return;
  if (!await sendChordsToStudio(chords, phraseName())) return;
  els.sendBtn.textContent = '✓ Sent to Studio';
  setTimeout(() => { els.sendBtn.textContent = '→ Send to Studio'; }, 1800);
}

// --- Rendering ---

function chordLabelHtml(chord) {
  const inv = chord.inversion ? `<span class="cs-slot-inv">${getInversionLabel(chord.inversion)}</span>` : '';
  return `<span class="cs-slot-name">${abbreviateChord(chord)}${inv}</span>`;
}

function renderSlot(section, chord, index) {
  const slot = document.createElement('div');
  const isTarget = targetSlot?.sectionId === section.id && targetSlot.index === index;
  slot.className = `cs-slot${chord ? ' filled' : ''}${isTarget ? ' target' : ''}`;
  slot.dataset.slot = String(index);
  slot.draggable = !!chord;

  if (chord) {
    const shape = createChordShapeDiagramEl({ flat: true });
    updateChordShapeDiagram(shape, notesToLabels(chord.notes));
    slot.appendChild(shape);
    slot.insertAdjacentHTML('beforeend', chordLabelHtml(chord));
    slot.title = `${chord.name} — tap to play, drag to move`;
  } else {
    slot.insertAdjacentHTML('beforeend', '<span class="cs-slot-empty">Drop a chord</span>');
  }

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'cs-slot-remove';
  remove.title = chord ? 'Clear this chord' : 'Remove this slot';
  remove.textContent = '×';
  slot.appendChild(remove);
  return slot;
}

function renderSection(section) {
  const el = document.createElement('div');
  el.className = `cs-section${section.id === activeSectionId ? ' active' : ''}`;
  el.dataset.sectionId = section.id;
  el.dataset.color = String(section.color ?? 0);
  el.innerHTML = `
    <div class="cs-section-head">
      <span class="cs-section-swatch"></span>
      <input class="cs-section-name" type="text" maxlength="24" list="csSectionNameOptions" aria-label="Section name">
      <button type="button" class="cs-icon-btn" data-act="up" title="Move section up">↑</button>
      <button type="button" class="cs-icon-btn" data-act="down" title="Move section down">↓</button>
      <button type="button" class="cs-icon-btn" data-act="dup" title="Duplicate section">⧉</button>
      <button type="button" class="cs-icon-btn" data-act="del" title="Delete section">🗑</button>
    </div>
    <div class="cs-slots"></div>
  `;
  el.querySelector('.cs-section-name').value = section.name;
  const slotsEl = el.querySelector('.cs-slots');
  section.slots.forEach((chord, i) => slotsEl.appendChild(renderSlot(section, chord, i)));
  if (section.slots.length < MAX_SLOTS) {
    slotsEl.insertAdjacentHTML('beforeend',
      `<button type="button" class="cs-slot-add" data-slot="${section.slots.length}" title="Add a slot">+</button>`);
  }
  return el;
}

function render() {
  if (!els.sections) return;
  els.title.value = song.title;
  els.sections.replaceChildren(...song.sections.map(renderSection));
  const hasChords = songSequence().length > 0;
  els.sendBtn.disabled = !hasChords;
  els.playBtn.disabled = !hasChords;
  els.stageBtn.disabled = !hasChords;
}

// --- Event wiring (delegated, so re-renders need no rebinding) ---

function slotRef(el) {
  const slot = el.closest('.cs-slot, .cs-slot-add');
  const section = el.closest('.cs-section');
  if (!slot || !section) return null;
  return { sectionId: section.dataset.sectionId, index: parseInt(slot.dataset.slot, 10), slotEl: slot };
}

function slotChord(ref) {
  return ref ? findSection(ref.sectionId)?.slots[ref.index] ?? null : null;
}

function wireSections() {
  const root = els.sections;

  root.addEventListener('click', (e) => {
    const sectionEl = e.target.closest('.cs-section');
    if (!sectionEl) return;
    const sectionId = sectionEl.dataset.sectionId;
    const actBtn = e.target.closest('[data-act]');
    if (actBtn) {
      const act = actBtn.dataset.act;
      if (act === 'up') moveSection(sectionId, -1);
      else if (act === 'down') moveSection(sectionId, 1);
      else if (act === 'dup') duplicateSection(sectionId);
      else if (act === 'del') deleteSection(sectionId);
      return;
    }

    const ref = slotRef(e.target);
    if (e.target.closest('.cs-slot-remove') && ref) { removeSlot(ref.sectionId, ref.index); return; }
    if (e.target.closest('.cs-slot-add')) { addSlot(sectionId); return; }

    const chord = slotChord(ref);
    if (chord) {
      playChordNotes(chord.notes);
      highlightChordNotes(chord, true);
      return;
    }
    if (ref) {
      // Empty slot: pick it as the target for the next library "+" tap.
      const same = targetSlot?.sectionId === ref.sectionId && targetSlot.index === ref.index;
      targetSlot = same ? null : { sectionId: ref.sectionId, index: ref.index };
    }
    if (activeSectionId !== sectionId || ref) {
      activeSectionId = sectionId;
      render();
    }
  });

  root.addEventListener('input', (e) => {
    if (!e.target.classList.contains('cs-section-name')) return;
    const section = findSection(e.target.closest('.cs-section').dataset.sectionId);
    section.name = e.target.value;
    saveSong(); // no re-render: it would steal focus mid-typing
  });

  root.addEventListener('focusin', (e) => {
    const sectionEl = e.target.closest('.cs-section');
    if (!sectionEl || sectionEl.dataset.sectionId === activeSectionId) return;
    activeSectionId = sectionEl.dataset.sectionId;
    root.querySelectorAll('.cs-section').forEach(el => el.classList.toggle('active', el === sectionEl));
  });

  root.addEventListener('mouseover', (e) => {
    const chord = slotChord(slotRef(e.target));
    if (chord) highlightChordNotes(chord, true);
  });
  root.addEventListener('mouseout', (e) => {
    const from = e.target.closest('.cs-slot.filled');
    if (from && !from.contains(e.relatedTarget)) setChordHighlight([], false);
  });

  root.addEventListener('dragstart', (e) => {
    const ref = slotRef(e.target);
    if (!slotChord(ref)) return;
    e.dataTransfer.setData(SLOT_DRAG_TYPE, JSON.stringify({ sectionId: ref.sectionId, index: ref.index }));
    e.dataTransfer.effectAllowed = 'move';
    ref.slotEl.classList.add('dragging');
  });
  root.addEventListener('dragend', () => {
    root.querySelectorAll('.dragging, .drag-over').forEach(el => el.classList.remove('dragging', 'drag-over'));
  });

  root.addEventListener('dragover', (e) => {
    const ref = slotRef(e.target);
    const types = e.dataTransfer.types;
    if (!ref || !(types.includes(CHORD_DRAG_TYPE) || types.includes(SLOT_DRAG_TYPE))) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = types.includes(SLOT_DRAG_TYPE) ? 'move' : 'copy';
    root.querySelectorAll('.drag-over').forEach(el => { if (el !== ref.slotEl) el.classList.remove('drag-over'); });
    ref.slotEl.classList.add('drag-over');
  });
  root.addEventListener('dragleave', (e) => {
    const ref = slotRef(e.target);
    if (ref && !ref.slotEl.contains(e.relatedTarget)) ref.slotEl.classList.remove('drag-over');
  });

  root.addEventListener('drop', (e) => {
    const ref = slotRef(e.target);
    if (!ref) return;
    e.preventDefault();
    const chordId = e.dataTransfer.getData(CHORD_DRAG_TYPE);
    const slotData = e.dataTransfer.getData(SLOT_DRAG_TYPE);
    if (chordId) {
      const chord = ChordUI.getChord(chordId);
      if (chord) {
        setSlot(ref.sectionId, ref.index, storedChord(chord));
        playChordNotes(chord.notes);
      }
    } else if (slotData) {
      swapSlots(JSON.parse(slotData), ref);
    }
  });
}

// --- Panel open/close ---

function setButtonsActive(on) {
  document.querySelectorAll('[data-chord-panel]').forEach(b => b.classList.toggle('active', on));
}

export function openChordPanel() {
  setLastSidebarType('chords');
  closeSidebar({ reason: 'chords-open', source: 'chords' }); // mutually exclusive
  ChordUI.update();
  loadSong();
  render();
  panel.open();
  setButtonsActive(true);
  updateBodySidebarClass();
}

export function toggleChordPanel() {
  if (panel.isOpen) closeSidebar({ reason: 'chords-close', source: 'chords' });
  else openChordPanel();
}

function onScaleChanged() {
  // Same 100ms settle delay as js/chord-ui.js, for currentScale to update.
  setTimeout(() => {
    stopPlayback();
    loadSong();
    render();
  }, 100);
}

export function initChordPanel() {
  const el = document.getElementById('chordSidebar');
  if (!el) return;

  panel = new Sidepanel(el, {
    onClose: () => {
      stopPlayback();
      setChordHighlight([], false);
      setButtonsActive(false);
      updateBodySidebarClass();
    },
  });

  els = {
    sections: document.getElementById('csSections'),
    title: document.getElementById('csSongTitle'),
    sendBtn: document.getElementById('csSendBtn'),
    playBtn: document.getElementById('csPlayBtn'),
    stageBtn: document.getElementById('csStageBtn'),
  };

  document.getElementById('closeChordSidebar')?.addEventListener('click', () => {
    closeSidebar({ reason: 'chords-close', source: 'chords' });
  });
  document.querySelectorAll('[data-chord-panel]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      toggleChordPanel();
    });
  });

  els.title.addEventListener('input', () => {
    song.title = els.title.value;
    saveSong();
  });
  document.getElementById('csAddSectionBtn').addEventListener('click', addSection);
  document.getElementById('csNewSongBtn').addEventListener('click', clearSong);
  els.playBtn.addEventListener('click', playSong);
  els.sendBtn.addEventListener('click', sendToStudio);
  els.stageBtn.addEventListener('click', () => {
    stopPlayback();
    setChordHighlight([], false);
    openChordStage(song);
  });

  ChordUI.setAddHandler(addChordFromLibrary);
  wireSections();

  document.getElementById('scaleSelect')?.addEventListener('change', onScaleChanged);
  window.addEventListener('handpan-loaded', () => { if (panel.isOpen) onScaleChanged(); });

  registerPanelOpener('chords', openChordPanel);
  loadSong();
  render();
}
