// Chord Play Along's internal mechanism for sequencing chords coherently —
// pure scale-degree sequences, no quality baked in. The same template
// sounds right on any scale: js/chord-analyzer.js's diatonicTriadAtDegree()
// derives each degree's actual quality (major/minor/diminished) live from
// whatever scale is currently loaded.
export const PROGRESSION_TEMPLATES = [
  { id: 'I-IV-V', degrees: [1, 4, 5] },
  { id: 'ii-V-I', degrees: [2, 5, 1] },
  { id: 'I-V-vi-IV', degrees: [1, 5, 6, 4] },
  { id: 'I-vi-IV-V', degrees: [1, 6, 4, 5] },
  { id: 'vi-IV-I-V', degrees: [6, 4, 1, 5] },
  { id: 'I-IV-vi-V', degrees: [1, 4, 6, 5] },
];

// Pads a template's degree list to exactly `count` chords by repeating the
// LAST degree — keeps the progression's "arrival" chord as the resting
// point. Templates longer than `count` are simply truncated.
export function padTemplate(degrees, count) {
  if (count <= 0) return [];
  if (degrees.length >= count) return degrees.slice(0, count);

  const padded = [...degrees];
  const last = degrees[degrees.length - 1];
  while (padded.length < count) padded.push(last);
  return padded;
}
