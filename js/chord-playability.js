/**
 * Determines whether chords are physically playable on a handpan with two hands.
 *
 * Two notes are "one-hand playable" if:
 *   1. They are neighbours (the 2 closest notes to each other on the same shell), OR
 *   2. Their distance (in % of image dimensions) is within PROXIMITY_THRESHOLD
 *
 * A 3-note chord is "2-hand playable" if at least one of the 3 possible splits
 * (A+B|C, A+C|B, B+C|A) has the 2-note hand passing the one-hand test.
 * Notes on different shells are never one-hand playable.
 */

const NEIGHBOR_COUNT       = 2;
const PROXIMITY_THRESHOLD  = 25; // % distance; tune if needed

function buildAdjacencyMap(posMap) {
  const adj     = new Map();
  const pitches = Object.keys(posMap);

  for (const pitch of pitches) {
    const pos = posMap[pitch];

    const sorted = pitches
      .filter(p => {
        if (p === pitch) return false;
        const other = posMap[p];
        // Cross-shell notes are never adjacent
        if (pos.side && other.side && pos.side !== other.side) return false;
        return true;
      })
      .map(p => ({ p, d: Math.hypot(posMap[p].x - pos.x, posMap[p].y - pos.y) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, NEIGHBOR_COUNT)
      .map(({ p }) => p);

    adj.set(pitch, new Set(sorted));
  }

  return adj;
}

function oneHandOk(a, b, posMap, adj) {
  const pa = posMap[a];
  const pb = posMap[b];
  if (!pa || !pb) return false;

  // Cross-shell → always requires separate hands
  if (pa.side && pb.side && pa.side !== pb.side) return false;

  // Adjacent neighbours → always one-hand reachable
  if (adj.get(a)?.has(b) || adj.get(b)?.has(a)) return true;

  // Proximity fallback
  return Math.hypot(pb.x - pa.x, pb.y - pa.y) <= PROXIMITY_THRESHOLD;
}

/**
 * Annotate each chord with a `playable` boolean.
 *
 * @param {Array}  chords   Result of ChordAnalyzer.analyze()
 * @param {Object} posMap   { pitchString: { x, y, side } } from getPitchPositionMap()
 * @returns {Array} same chord objects with .playable set
 */
export function annotatePlayability(chords, posMap) {
  if (!posMap || !Object.keys(posMap).length) {
    return chords.map(c => ({ ...c, playable: true }));
  }

  const adj = buildAdjacencyMap(posMap);

  return chords.map(chord => {
    const { notes } = chord;
    if (!notes || notes.length !== 3) return { ...chord, playable: true };

    const [a, b, c] = notes;

    // One hand plays 2 notes, the other plays 1 (single note is always fine).
    // Chord is playable if any of the three splits works.
    const playable =
      oneHandOk(a, b, posMap, adj) ||
      oneHandOk(a, c, posMap, adj) ||
      oneHandOk(b, c, posMap, adj);

    return { ...chord, playable };
  });
}
