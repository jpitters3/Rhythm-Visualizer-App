/**
 * Chord Analyzer
 * 
 * Analyzes a given set of notes (the handpan scale + Ding) 
 * and identifies all available Major and Minor triads that can be played.
 */

// Note to MIDI map (0 = C, 11 = B)
const NOTE_MAP = {
  'C': 0, 'C#': 1, 'DB': 1, 'D': 2, 'D#': 3, 'EB': 3,
  'E': 4, 'F': 5, 'F#': 6, 'GB': 6, 'G': 7, 'G#': 8, 'AB': 8,
  'A': 9, 'A#': 10, 'BB': 10, 'B': 11
};

const REVERSE_NOTE_MAP = [
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'
];

const REVERSE_NOTE_MAP_FLAT = [
  'C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'
];

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

/**
 * Check if 3 notes form a chord
 * Returns { root: "D", quality: "Minor", name: "D Minor" } or null
 */
function identifyTriad(notesObjArr, useFlats) {
  // Sort by pitch
  const sorted = [...notesObjArr].sort((a, b) => a.midi - b.midi);
  const [n1, n2, n3] = sorted;

  // Calculate intervals relative to root logic
  // But the notes might be inverted! (e.g. A3, D4, F4 is D Minor inversed)
  // We need to check pitch classes, not just absolute intervals.

  const pc1 = n1.midi % 12;
  const pc2 = n2.midi % 12;
  const pc3 = n3.midi % 12;

  const pcs = [pc1, pc2, pc3].sort((a, b) => a - b);
  const map = useFlats ? REVERSE_NOTE_MAP_FLAT : REVERSE_NOTE_MAP;

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
        name: map[root] + ' Major'
      };
    }

    const minorThird = (root + 3) % 12;
    if (pcs.includes(minorThird) && pcs.includes(fifth)) {
      return {
        root: map[root],
        quality: 'Minor',
        name: map[root] + ' Minor'
      };
    }

    // Bonus: Diminished (0, 3, 6)
    const dimFifth = (root + 6) % 12;
    if (pcs.includes(minorThird) && pcs.includes(dimFifth)) {
      return {
        root: map[root],
        quality: 'Diminished',
        name: map[root] + ' Dim'
      };
    }
  }
  return null; // No triad found
}

// Public API
export const ChordAnalyzer = {
  analyze: function (scaleNotes) {
    // scaleNotes is array of strings e.g. ["D3", "A3", ...]
    const parsedNotes = scaleNotes.map(parseNote).filter(n => n !== null);

    // Determine if context is "Flat" based on input notes
    const useFlats = scaleNotes.some(s => s.match(/[A-G]b/i));

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
      const result = identifyTriad(combo, useFlats);
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
