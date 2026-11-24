// Play Along mode's view of the grid: who plays what on each step, the
// count to show, and chord names. Pure: no DOM or audio.

import { ChordAnalyzer } from './chord-analyzer.js';

// Notes on step i as [{ label, hand }], or null for a rest. Chord slots 0-1
// are the left hand and 2-3 the right, as in the Studio grid; a single note
// uses handFor(i).
export function stepNotes(raw, i, handFor) {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    const notes = [];
    raw.forEach((label, slot) => {
      if (label) notes.push({ label: String(label), hand: slot <= 1 ? 'L' : 'R' });
    });
    return notes.length ? notes : null;
  }
  return [{ label: String(raw), hand: handFor(i) }];
}

export function soundKind(label) {
  if (label === 'T') return 'tak';
  if (label === 'S') return 'slap';
  if (label === 'Ding' || label === 'D' || label === '0') return 'ding';
  return 'tone';
}

export function chipText(label) {
  const kind = soundKind(label);
  if (kind === 'ding') return 'D';
  if (kind === 'tak') return 'T';
  if (kind === 'slap') return 'S';
  return label;
}

const SUB_COUNTS = { 2: ['+'], 3: ['+', 'a'], 4: ['e', '+', 'a'] };

// "1 + 2 +" style count for step i; { text, onBeat }.
export function countFor(i, beats, subdivision) {
  const sub = Math.max(1, subdivision);
  const inMeasure = i % (beats * sub);
  const k = inMeasure % sub;
  if (k === 0) return { text: String(inMeasure / sub + 1), onBeat: true };
  return { text: SUB_COUNTS[sub]?.[k - 1] ?? '·', onBeat: false };
}

const QUALITY_SUFFIX = { Major: '', Minor: 'm', Diminished: '°' };

// Short name ("Dm", "F") for exactly three distinct pitches forming a
// triad, else ''. Pitches look like "D4"; a Ding's "D3_ding" is accepted.
export function chordName(pitches) {
  const clean = [...new Set(pitches
    .map(p => String(p || '').replace(/_ding$/, ''))
    .filter(p => /^[A-G][#b]?\d$/.test(p)))];
  if (clean.length !== 3) return '';
  const found = ChordAnalyzer.analyze(clean)[0];
  if (!found) return '';
  return found.root + (QUALITY_SUFFIX[found.quality] ?? ` ${found.quality}`);
}
