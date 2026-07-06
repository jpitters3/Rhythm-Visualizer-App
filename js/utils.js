// Semitone lookup (uppercase key)
const NOTE_SEMITONES = {
  'C':0,'C#':1,'DB':1,'D':2,'D#':3,'EB':3,
  'E':4,'F':5,'F#':6,'GB':6,'G':7,'G#':8,'AB':8,
  'A':9,'A#':10,'BB':10,'B':11
};

// [accidental semitone, natural-below semitone, sharp spelling, flat spelling]
const ENHARMONIC_PAIRS = [
  [1,  0, 'C#', 'Db'],
  [3,  2, 'D#', 'Eb'],
  [6,  5, 'F#', 'Gb'],
  [8,  7, 'G#', 'Ab'],
  [10, 9, 'A#', 'Bb'],
];

/**
 * Return the correctly-spelled note name (no octave) for a pitch string,
 * given the other pitches present in the scale.
 *
 * Rule: if the natural note below an accidental is already in the scale,
 * use the flat spelling (A in scale → Bb, not A#).
 *
 * Handles s-shorthand (As3 → A#), sharps (#), and flats (b).
 */
export function spellNote(pitchStr, scalePitches = []) {
  // Normalise s-shorthand → #  (As3 → A#3)
  const norm = String(pitchStr).replace(/^([A-G])s(\d)/i, '$1#$2');
  const match = norm.match(/^([A-G][#b]?)(\d*)$/i);
  if (!match) return norm.replace(/\d+$/, '');

  const rawName = match[1].toUpperCase();

  // Natural notes are unambiguous
  if (!rawName.includes('#') && !rawName.includes('B') || rawName === 'B') {
    return match[1]; // preserve original casing
  }

  const semitone = NOTE_SEMITONES[rawName];
  if (semitone === undefined) return match[1];

  // Collect natural pitch classes from the scale
  const naturalPCs = new Set();
  for (const p of scalePitches) {
    const n = String(p).replace(/^([A-G])s(\d)/i, '$1#$2');
    const m = n.match(/^([A-G])(\d+)$/i);
    if (m) {
      const pc = NOTE_SEMITONES[m[1].toUpperCase()];
      if (pc !== undefined) naturalPCs.add(pc);
    }
  }

  for (const [acc, natural, sharp, flat] of ENHARMONIC_PAIRS) {
    if (semitone === acc) return naturalPCs.has(natural) ? flat : sharp;
  }

  return match[1];
}

export function extractYouTubeId(url) {
  const regExp = /^.*(youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=|shorts\/)([^#&?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

export function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
