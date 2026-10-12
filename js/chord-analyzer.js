/**
 * Chord Analyzer
 * 
 * Analyzes a given set of notes (the handpan scale + Ding) 
 * and identifies all available Major and Minor triads that can be played.
 */

// Note to MIDI map (0 = C, 11 = B)
export const NOTE_MAP = {
  'C': 0, 'C#': 1, 'DB': 1, 'D': 2, 'D#': 3, 'EB': 3,
  'E': 4, 'F': 5, 'F#': 6, 'GB': 6, 'G': 7, 'G#': 8, 'AB': 8,
  'A': 9, 'A#': 10, 'BB': 10, 'B': 11
};

// Root+quality identity, independent of inversion/voicing.
export function rootQualitySignature(root, quality) {
  return `${NOTE_MAP[root.toUpperCase()]}-${quality}`;
}

// Includes inversion — "Am" root position and "Am I" are distinct identities.
export function chordSignature(c) {
  return `${rootQualitySignature(c.root, c.quality)}-${c.inversion || 0}`;
}

// 0 = root position, 1 = first inversion, 2 = second inversion.
const INVERSION_LABEL = ['', 'I', 'II'];
export function getInversionLabel(inversion) {
  return INVERSION_LABEL[inversion] || '';
}

// Pairs: [accidental semitone, natural-below semitone, sharp spelling, flat spelling]
const ACCIDENTAL_PAIRS = [
  [1,  0, 'C#', 'Db'],
  [3,  2, 'D#', 'Eb'],
  [6,  5, 'F#', 'Gb'],
  [8,  7, 'G#', 'Ab'],
  [10, 9, 'A#', 'Bb'],
];

// Build a 12-element name array where each accidental is spelled by whether
// its natural lower neighbour is already present in the scale.
function buildSpellingMap(pitchClassSet) {
  const map = ['C', null, 'D', null, 'E', 'F', null, 'G', null, 'A', null, 'B'];
  for (const [acc, natural, sharpName, flatName] of ACCIDENTAL_PAIRS) {
    map[acc] = pitchClassSet.has(natural) ? flatName : sharpName;
  }
  return map;
}

/**
 * Parse "D3" or "F#4" into { note: "D", octave: 3, midi: 50, original: "D3" }
 */
function parseNote(noteStr) {
  if (!noteStr) return null;
  // Accept #, b/B (flat), or s (sharp shorthand e.g. "Cs4", "Fs4")
  const match = noteStr.match(/^([A-G][#bBs]?)(-?\d+)$/i);
  if (!match) return null;

  let noteName = match[1].toUpperCase();
  const octave = parseInt(match[2], 10);

  // Normalize 's' (sharp shorthand) → '#'
  if (noteName.endsWith('S')) noteName = noteName[0] + '#';
  // Normalize flat 'B' suffix → keep as 'B' for NOTE_MAP lookup (e.g. 'AB', 'BB')
  // Note: single-letter note 'B' does NOT end with a modifier, so this is safe.

  const semitone = NOTE_MAP[noteName];
  if (semitone === undefined) return null;

  return {
    name: noteName,
    octave: octave,
    midi: (octave + 1) * 12 + semitone, // Standard MIDI (C4 = 60)
    original: noteStr
  };
}

/**
 * Get all unique 3-note combinations from the list
 */
function getCombinations(arr, k) {
  const results = [];
  function helper(start, combo) {
    if (combo.length === k) {
      results.push([...combo]);
      return;
    }
    for (let i = start; i < arr.length; i++) {
      combo.push(arr[i]);
      helper(i + 1, combo);
      combo.pop();
    }
  }
  helper(0, []);
  return results;
}

// 0 = root position (bass = root), 1 = first inversion (bass = third),
// 2 = second inversion (bass = fifth).
function inversionOf(bassPc, rootPc, thirdPc, fifthPc) {
  if (bassPc === thirdPc) return 1;
  if (bassPc === fifthPc) return 2;
  return 0;
}

/**
 * Check if 3 notes form a chord
 * Returns { root: "D", quality: "Minor", name: "D Minor", inversion: 0 } or null
 */
function identifyTriad(notesObjArr, spellingMap) {
  const sorted = [...notesObjArr].sort((a, b) => a.midi - b.midi);
  const [n1, n2, n3] = sorted;

  const pc1 = n1.midi % 12; // bass note's pitch class — decides the inversion
  const pc2 = n2.midi % 12;
  const pc3 = n3.midi % 12;

  const pcs = [pc1, pc2, pc3].sort((a, b) => a - b);
  const map = spellingMap;

  // Check for Root Position shapes in Pitch Class space
  // Try each note as potential root
  for (let i = 0; i < 3; i++) {
    const root = pcs[i];
    const third = (root + 4) % 12;
    const fifth = (root + 7) % 12;
    if (pcs.includes(third) && pcs.includes(fifth)) {
      return {
        root: map[root],
        quality: 'Major',
        name: map[root] + ' Major',
        inversion: inversionOf(pc1, root, third, fifth)
      };
    }

    const minorThird = (root + 3) % 12;
    if (pcs.includes(minorThird) && pcs.includes(fifth)) {
      return {
        root: map[root],
        quality: 'Minor',
        name: map[root] + ' Minor',
        inversion: inversionOf(pc1, root, minorThird, fifth)
      };
    }

    // Bonus: Diminished (0, 3, 6)
    const dimFifth = (root + 6) % 12;
    if (pcs.includes(minorThird) && pcs.includes(dimFifth)) {
      return {
        root: map[root],
        quality: 'Diminished',
        name: map[root] + ' Dim',
        inversion: inversionOf(pc1, root, minorThird, dimFifth)
      };
    }
  }
  return null; // No triad found
}

/**
 * The diatonic triad at a given 1-based scale degree, found by stacking
 * thirds directly from the scale's own note content (degree, degree+2,
 * degree+4 — classic tertian stacking), independent of which octave each
 * pitch class happens to occur on the physical handpan.
 *
 * scaleNotes is e.g. getAllCurrentNotes()'s output — Ding first, then
 * tonefields. A 9-tonefield handpan's physical layout is NOT a simple
 * one-octave ascending run: it commonly spans more than an octave while
 * skipping some pitch classes in the low octave entirely (e.g. D Kurd has
 * Ding=D3 then jumps straight to A3 — no E3/F3/G3 tonefields exist, those
 * pitch classes only appear up in the D4-A4 range). So the degree order
 * can't be found by walking notes in ascending absolute pitch and deduping
 * — that reconstructs the physical tonefield layout, not the musical
 * scale. Instead: collect every unique pitch class present (any octave),
 * then sort them by semitone distance from the tonic (scaleNotes[0], i.e.
 * Ding) — that's the actual scale shape, regardless of octave layout.
 *
 * Returns { root, quality, name, degree }, or null if that degree's stack
 * isn't a clean Major/Minor/Diminished triad (e.g. a gapped exotic scale).
 */
export function diatonicTriadAtDegree(scaleNotes, degree) {
  const parsed = scaleNotes.map(parseNote).filter(n => n !== null);
  if (!parsed.length) return null;

  const tonicPc = parsed[0].midi % 12;
  const uniquePcs = [...new Set(parsed.map(n => n.midi % 12))];
  const degreePcs = uniquePcs
    .map(pc => ({ pc, fromTonic: (pc - tonicPc + 12) % 12 }))
    .sort((a, b) => a.fromTonic - b.fromTonic)
    .map(({ pc }) => pc);

  const n = degreePcs.length;
  if (n < 3) return null;

  const spellingMap = buildSpellingMap(new Set(degreePcs));
  const idx = ((degree - 1) % n + n) % n; // 1-based degree -> 0-based index, wraps past the octave
  const stack = [degreePcs[idx], degreePcs[(idx + 2) % n], degreePcs[(idx + 4) % n]]
    .map(pc => ({ midi: pc })); // only pitch-class (mod 12) math matters for quality/root naming here

  const result = identifyTriad(stack, spellingMap);
  return result ? { root: result.root, quality: result.quality, name: result.name, degree } : null;
}

// Public API
export const ChordAnalyzer = {
  analyze: function (scaleNotes) {
    // scaleNotes is array of strings e.g. ["D3", "A3", ...]
    const parsedNotes = scaleNotes.map(parseNote).filter(n => n !== null);

    // Build a set of natural pitch classes present in the scale so we can
    // determine per-accidental spelling: if A is in the scale, use Bb not A#.
    const naturalPCs = new Set(parsedNotes.map(n => n.midi % 12));
    const spellingMap = buildSpellingMap(naturalPCs);

    // Deduplicate by strict name+octave to avoid double counting same note
    // Handpans rarely have duplicates, but if so, ignore.
    const uniqueNotes = [];
    const seen = new Set();
    parsedNotes.forEach(n => {
      if (!seen.has(n.original)) {
        seen.add(n.original);
        uniqueNotes.push(n);
      }
    });

    if (uniqueNotes.length < 3) return [];

    const combos = getCombinations(uniqueNotes, 3);
    const chords = [];
    const chordSignatures = new Set(); // To avoid duplicates like "D Minor" appearing twice if multiple inversions exist 
    // If I have Dm (low) and Dm (high), maybe show both.
    // "Highlight notes on Handpan" -> Usually pulsing the specific notes makes sense.
    // Let's return individual voicings for now. We can group them in UI.

    combos.forEach(combo => {
      const result = identifyTriad(combo, spellingMap);
      if (result) {
        // Create unique ID for this specific voicing
        const noteIds = combo.map(n => n.original).sort().join(',');

        chords.push({
          ...result,
          notes: combo.map(n => n.original), // ["D3", "F3", "A3"]
          id: noteIds
        });
      }
    });

    // Sort chords: Major first, then Minor. Within that, alphabetical or root pitch?
    // Let's sort by Root Name alphabetical for now.
    chords.sort((a, b) => {
      if (a.root !== b.root) return a.root.localeCompare(b.root);
      return a.quality.localeCompare(b.quality);
    });

    return chords;
  }
};
