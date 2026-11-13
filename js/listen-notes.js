// Chord listen: pan notes, their names and the chords they make.
import { ChordAnalyzer, NOTE_MAP } from './chord-analyzer.js';
import { getAllCurrentNotes } from './chord-playback.js';
import { chordShortLabel } from './progression-to-grid.js';
import { getScale, getSelectedScaleName } from './state.js';
import { parseNoteName, pcName } from './voice-commands.js';

export function normLabel(label) {
  return label === 'D' ? 'Ding' : String(label);
}

export function labelToNote(label) {
  const scale = getScale();
  if (!scale) return null;
  return label === 'Ding' ? scale.ding : scale.map?.[label] || null;
}

const midi = note => parseNoteName(note)?.midi ?? 0;

// "Cs4" (the scales' spelling) reads as C#
export const pitchName = note => note.replace(/-?\d+$/, '').replace(/^([A-G])s$/, '$1#');

export const noteName = note => pitchName(note) + (parseNoteName(note)?.octave ?? '');

// Every note on the pan, low to high
function panNotes() {
  const scale = getScale();
  if (!scale) return [];
  const entries = [['Ding', scale.ding], ...Object.entries(scale.map || {})];
  return entries
    .map(([label, name]) => ({ label, name, ...parseNoteName(name) }))
    .filter(n => n.midi != null)
    .sort((a, b) => a.midi - b.midi);
}

export function scalePrefersFlats() {
  return panNotes().some(n => /^[A-G]b/.test(n.name));
}

// Extra notes over a triad, by interval from its root
const EXTENSIONS = { 10: '7', 11: 'maj7', 2: 'add9', 5: 'add11', 9: '6' };

// The chord a set of pan notes makes: the triad it contains (lowest note as root
// if it can be), plus any extension; otherwise its notes.
export function describeChord(labels) {
  const notes = labels.map(labelToNote).filter(Boolean).sort((a, b) => midi(a) - midi(b));
  if (!notes.length) return null;
  const pcs = new Set(notes.map(n => midi(n) % 12));
  const triads = ChordAnalyzer.analyze(getAllCurrentNotes())
    .filter(t => t.notes.every(n => pcs.has(midi(n) % 12)));
  const bassPc = midi(notes[0]) % 12;
  const triad = triads.find(t => NOTE_MAP[t.root.toUpperCase()] === bassPc)
    || triads.find(t => !t.inversion) || triads[0];

  if (triad) {
    const rootPc = NOTE_MAP[triad.root.toUpperCase()];
    const triadPcs = new Set(triad.notes.map(n => midi(n) % 12));
    const ext = [...pcs].filter(pc => !triadPcs.has(pc))
      .map(pc => EXTENSIONS[(pc - rootPc + 12) % 12]).filter(Boolean).join('');
    const inversion = triad.root.toUpperCase() === pitchName(notes[0]).toUpperCase() ? 0 : triad.inversion;
    const chord = { root: triad.root, quality: triad.quality, name: triad.name, inversion, notes, playable: true };
    return { ...chord, short: chordShortLabel({ ...chord, inversion: 0 }) + ext };
  }
  const names = [...new Set(notes.map(pitchName))];
  const fifth = names.length === 2 && (midi(notes.at(-1)) - midi(notes[0])) % 12 === 7;
  const short = fifth ? `${names[0]}5` : names.join(' ');
  return { root: names[0], quality: 'Custom', name: short, inversion: 0, notes, playable: true, short };
}

// Said back the way it was said: "F sharp" stays F#, even on a pan spelled in flats
export const say = n => pcName(n.pc, n.acc ? n.acc < 0 : scalePrefersFlats()) + (n.octave ?? '');

export const listText = items => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

export const byPitch = labels => [...labels].sort((a, b) => midiOf(a) - midiOf(b));

export const labelName = label => noteName(labelToNote(label) || '');

export const midiOf = label => midi(labelToNote(label));

export const pickBy = (list, qual) => (qual === 'low' ? list[0] : list.at(-1));

// The pan's notes matching a spoken note, low to high
export function panMatches(note) {
  return panNotes().filter(n => n.pc === note.pc && (note.octave == null || n.octave === note.octave));
}

export function chordMatches(labels, note) {
  return labels
    .filter(l => {
      const p = parseNoteName(labelToNote(l));
      return p && p.pc === note.pc && (note.octave == null || p.octave === note.octave);
    })
    .sort((a, b) => midiOf(a) - midiOf(b));
}

export function scaleLabel() {
  const main = document.getElementById('scaleSelect');
  return main?.options[main.selectedIndex]?.textContent?.trim() || getSelectedScaleName() || 'this scale';
}
