// Shared chord sound/highlight helpers, extracted from chord-ui.js so the
// Chord Wheel game (js/chord-wheel-game.js) can reuse them without duplication.
import { playNoteByLabel } from './noteplayer.js';
import { getScale } from './state.js';
import { SCALES } from './config.js';
import { setChordHighlight, isChordTestMode, getPitchPositionMap } from './handpanmap.js';
import { ChordAnalyzer } from './chord-analyzer.js';
import { annotatePlayability } from './chord-playability.js';

export function getAllCurrentNotes() {
  const scale = getScale();
  if (scale && scale.map) {
    const notes = [];
    if (scale.ding) notes.push(scale.ding);
    Object.values(scale.map).forEach(n => notes.push(n));
    return notes;
  }
  const scaleSelect = document.getElementById('scaleSelect');
  if (scaleSelect && SCALES) {
    const name = scaleSelect.value;
    if (name && SCALES[name]) {
      const s = SCALES[name];
      const notes = [];
      if (s.ding) notes.push(s.ding);
      if (s.map) Object.values(s.map).forEach(n => notes.push(n));
      return notes;
    }
  }
  return [];
}

// Every playable triad on the current scale, EXCLUDING Diminished, with
// inversions kept as separate entries (not collapsed to one-per-root) —
// the exact pool js/chord-wheel-game.js's own getScalePool() builds.
// Shared here so other chord games (e.g. js/chord-play-along.js) draw from
// the identical list instead of a lookalike reimplementation.
export function getScaleChordPool() {
  const notes = getAllCurrentNotes();
  if (!notes.length) return [];
  const chords = annotatePlayability(ChordAnalyzer.analyze(notes), getPitchPositionMap());
  return chords
    .filter(c => c.playable && c.quality !== 'Diminished')
    .map(c => ({ ...c, onThisPan: true }));
}

export function highlightChordNotes(chordOrNotes, active) {
  const notes = chordOrNotes.notes ?? chordOrNotes;
  const playable = isChordTestMode() ? (chordOrNotes.playable ?? true) : true;
  const scale = getScale();
  const labelToPitch = scale ? scale.map : null;
  const dingPitch = scale ? scale.ding : null;
  if (!labelToPitch) return;

  const targetLabels = [];
  if (notes.includes(dingPitch)) { targetLabels.push('D'); targetLabels.push('Ding'); }
  for (const [lbl, pitch] of Object.entries(labelToPitch)) {
    if (notes.includes(pitch)) targetLabels.push(lbl);
  }
  setChordHighlight(targetLabels, active, playable);
}

// Pure pitch -> handpan-label resolution, in input order. No audio, no side
// effects — for callers that need the labels (e.g. to write into the grid)
// without playing the chord.
export function notesToLabels(notes) {
  const scale = getScale();
  const labelToPitch = scale ? scale.map : null;
  const dingPitch = scale ? scale.ding : null;
  if (!labelToPitch) return [];

  const targetLabels = [];
  notes.forEach((pitch) => {
    let targetLabel = null;
    if (pitch === dingPitch) targetLabel = 'D';
    else {
      for (const [lbl, p] of Object.entries(labelToPitch)) {
        if (p === pitch) { targetLabel = lbl; break; }
      }
    }
    if (targetLabel) targetLabels.push(targetLabel);
  });
  return targetLabels;
}

// Plays each note in input order; returns the resolved labels. No grid side effects —
// callers decide whether to also write into the Studio grid.
export function playChordNotes(notes) {
  const labels = notesToLabels(notes);
  labels.forEach(playNoteByLabel);
  return labels;
}
