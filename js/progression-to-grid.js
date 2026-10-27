// Shared "Send to Studio" for chord progressions (Chord Wheel + Chords panel):
// one measure per chord, chord on each measure's first step.
import { getInversionLabel } from './chord-analyzer.js';
import { notesToLabels } from './chord-playback.js';
import { assignChordToSelectedCell, applySelection, renderAllMeasures } from './notegrid.js';
import { measureRange } from './measure-actions.js';
import { activeGrid } from './state.js';
import { guardBeforeReplacingGrid } from './lesson-settings.js';
import { HistoryManager } from './history.js';
import { updateCurrentPhraseName } from './controls.js';

// "G Minor" -> "Gm", "F Major" -> "F"
export function abbreviateChord(chord) {
  if (chord.quality === 'Minor') return `${chord.root}m`;
  if (chord.quality === 'Diminished') return `${chord.root}°`;
  return chord.root;
}

// "Dm II" — inversion spelled out for single-line labels.
export function chordShortLabel(chord) {
  return chord.inversion ? `${abbreviateChord(chord)} ${getInversionLabel(chord.inversion)}` : abbreviateChord(chord);
}

// Writes into the existing measures (no resize) — the rhythm hand-off case.
export function writeChordsOverMeasures(chords, ctx = activeGrid) {
  HistoryManager?.pushState();
  chords.forEach((chord, i) => {
    const { start } = measureRange(i, ctx);
    applySelection(start, ctx);
    assignChordToSelectedCell(notesToLabels(chord.notes), ctx);
  });
  renderAllMeasures(ctx);
}

// Replaces the grid with one cleared measure per chord. Resolves false if
// the player cancelled the unsaved-changes prompt.
export async function sendChordsToStudio(chords, phraseName) {
  if (!await guardBeforeReplacingGrid('You have unsaved changes. Discard them and replace the grid with this progression?')) return false;

  const ctx = activeGrid;
  HistoryManager?.pushState();
  ctx.setMeasures(chords.length);
  ctx.step = 0;
  chords.forEach((chord, i) => {
    const { start } = measureRange(i, ctx);
    applySelection(start, ctx);
    assignChordToSelectedCell(notesToLabels(chord.notes), ctx); // silent — no audio
  });
  renderAllMeasures(ctx);
  updateCurrentPhraseName(phraseName || `Chords ${chords.map(chordShortLabel).join(' ')}`);
  return true;
}
