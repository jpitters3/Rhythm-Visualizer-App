// Places notes heard in real time onto a beat grid for a Studio phrase. Notes
// are captured at their exact times; the grid is chosen afterwards, beat by
// beat, so nothing is lost to an early guess and triplets can be told apart
// from 16ths. Pure: no DOM or audio.

// Steps per beat the Studio offers: ♩ ♪ ♩³ ♬ (preferred in this order)
export const GRIDS = [1, 2, 3, 4];

const TOLERANCE_MS = 45; // how far off a step a note may land and still be on it
const MAX_TOLERANCE = 0.1; // …but never more than this share of a beat (16ths are 0.25 apart)
const EARLY_SHARE = 0.15; // a note this early belongs to the next beat
const NEAR_BEAT = 0.2; // notes this close to a beat show how early or late the player sits
const MAX_OFFSET = 0.2;

const lcm = (a, b) => { let x = a; while (x % b) x += a; return x; };

// How consistently early or late notes on the beat land (in beats, + is late):
// a player's feel, or the mic and speakers' delay. Taken out before placing.
export function findOffset(positions) {
  const nearBeat = positions.map(x => x - Math.round(x)).filter(d => Math.abs(d) <= NEAR_BEAT).sort((a, b) => a - b);
  if (nearBeat.length < 3) return 0;
  const median = nearBeat[Math.floor(nearBeat.length / 2)];
  return Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, median));
}

// The coarsest grid that puts every note of one beat on a step, or null
function gridForBeat(fracs, tolerance) {
  return GRIDS.find(s => fracs.every(f => Math.abs(f * s - Math.round(f * s)) / s <= tolerance)) ?? null;
}

// notes: [{ label, at }] in ms on the same clock as downbeat (the count-in's "1").
// grid: 'auto' or a steps-per-beat from GRIDS.
// Returns { subdivision, measures, steps, offset, beatGrids, rounded, dropped }:
// steps is one entry per grid step: '' or a label or [labels] (notes together).
export function quantize(notes, { bpm, beatsPerBar, downbeat, grid = 'auto' }) {
  const beatMs = 60000 / bpm;
  const tolerance = Math.min(MAX_TOLERANCE, TOLERANCE_MS / beatMs);
  const raw = notes.map(n => ({ label: n.label, x: (n.at - downbeat) / beatMs }));
  const offset = findOffset(raw.map(n => n.x));
  const placed = raw.map(n => ({ ...n, x: n.x - offset }));
  // Before the count-in's "1": a pickup we don't place yet
  const kept = placed.filter(n => n.x >= -EARLY_SHARE);
  const dropped = placed.length - kept.length;

  // Each beat's own grid
  const byBeat = new Map();
  kept.forEach((n) => {
    const beat = Math.max(0, Math.floor(n.x + EARLY_SHARE));
    if (!byBeat.has(beat)) byBeat.set(beat, []);
    byBeat.get(beat).push(n.x - beat);
  });
  const beatGrids = new Map();
  byBeat.forEach((fracs, beat) => beatGrids.set(beat, grid === 'auto' ? gridForBeat(fracs, tolerance) : grid));

  // One grid for the phrase (the Studio has one per phrase): every beat's if
  // they agree (8ths and 16ths do), else the one most notes were played in
  let subdivision = grid === 'auto' ? 1 : grid;
  if (grid === 'auto') {
    const straight = [...beatGrids.values()].filter(s => s === 2 || s === 4);
    const triplet = [...beatGrids.values()].filter(s => s === 3);
    const notesIn = list => [...byBeat].filter(([b]) => list(beatGrids.get(b))).reduce((n, [, f]) => n + f.length, 0);
    const straightNotes = notesIn(s => s === 2 || s === 4);
    const tripletNotes = notesIn(s => s === 3);
    const unsure = [...beatGrids.values()].some(s => s === null);
    if (triplet.length && (!straight.length || tripletNotes > straightNotes)) subdivision = 3;
    else subdivision = straight.reduce(lcm, 1);
    if (unsure && subdivision === 1) subdivision = 4; // notes off every grid: the finest
  }

  // Onto steps; notes landing together become one chord step
  const steps = [];
  let rounded = 0;
  kept.forEach((n) => {
    const step = Math.max(0, Math.round(n.x * subdivision));
    if (Math.abs(n.x * subdivision - step) / subdivision > tolerance) rounded++;
    const was = steps[step];
    if (!was) steps[step] = n.label;
    else if (Array.isArray(was)) { if (!was.includes(n.label)) was.push(n.label); }
    else if (was !== n.label) steps[step] = [was, n.label];
  });
  const stepsPerBar = beatsPerBar * subdivision;
  const measures = Math.max(1, Math.ceil(steps.length / stepsPerBar));
  const filled = Array.from({ length: measures * stepsPerBar }, (_, i) => steps[i] ?? '');
  return { subdivision, measures, steps: filled, offset, beatGrids, rounded, dropped };
}
