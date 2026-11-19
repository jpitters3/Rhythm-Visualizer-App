// Rhythm by Ear categories, level rules, named rhythms and phrase generation.
// Pure: no DOM or audio. Beat numbers are 1-indexed; 8 beats per measure.

export const BEATS_PER_MEASURE = 8;

// Each level: a Ding on beat 1 plus `notes` more, on `where` beats ('odd' |
// 'any'). sounds: 'dings' = every note a Ding; 'mix' = each note Ding, Tak or
// Slap, with at least one Tak or Slap. Ladder: js/rhythm-ear-game.js.
const lvl = (notes, where, sounds) => ({ notes, where, sounds });

export const CATEGORIES = [
  {
    id: 'one-measure',
    name: 'One Measure',
    blurb: '8 beats.',
    measures: 1,
    levels: [
      lvl(1, 'odd', 'dings'),
      lvl(1, 'any', 'dings'),
      lvl(2, 'odd', 'dings'),
      lvl(2, 'any', 'dings'),
      lvl(1, 'any', 'mix'),
      lvl(2, 'any', 'mix'),
      lvl(3, 'any', 'dings'),
      lvl(3, 'any', 'mix'),
      lvl(4, 'any', 'dings'),
      lvl(4, 'any', 'mix'),
    ],
  },
  {
    id: 'two-measures',
    name: 'Two Measures',
    blurb: '16 beats.',
    measures: 2,
    levels: [
      lvl(3, 'any', 'dings'),
      lvl(4, 'any', 'dings'),
      lvl(4, 'any', 'mix'),
      lvl(5, 'any', 'mix'),
      lvl(7, 'any', 'dings'),
      lvl(7, 'any', 'mix'),
      lvl(9, 'any', 'mix'),
    ],
  },
];

// Level number across the whole ladder (Two Measures starts at 11).
export function levelNumber(catIndex, levelIndex) {
  return CATEGORIES.slice(0, catIndex).reduce((n, c) => n + c.levels.length, 0) + levelIndex + 1;
}

// Well-known rhythms, as onset beats on an 8- or 16-step grid. 8-step ones
// also fill two measures by repeating. 16-step timelines: Toussaint, "The
// Geometry of Musical Rhythm". `voicing` is the fixed handpan arrangement
// the Rhythm Library uses (one label per onset); levels re-voice them.
const D = 'Ding';
const CLAVE_VOICING = [D, 'T', 'T', D, 'T']; // a Ding opens each side of the clave
export const NAMED_RHYTHMS = [
  { name: 'Two-beat', steps: 8, onsets: [1, 5], voicing: [D, 'T'], about: 'The oom-pah pulse of polka, country and early jazz.' },
  { name: 'Charleston', steps: 8, onsets: [1, 4], voicing: [D, 'T'], about: 'The 1920s dance rhythm: the downbeat, then a push just before the middle.' },
  { name: 'Tresillo', steps: 8, onsets: [1, 4, 7], voicing: [D, 'T', 'T'], about: 'Grouped 3 + 3 + 2. The backbone of Cuban, Latin and a lot of pop music.' },
  { name: 'Habanera', steps: 8, onsets: [1, 4, 5, 7], voicing: [D, 'T', D, 'T'], about: 'Tresillo with one extra note. Heard in tango and in Bizet\'s Carmen.' },
  { name: 'Rock backbeat', steps: 8, onsets: [1, 3, 5, 7], voicing: [D, 'S', D, 'S'], about: 'Bass on 1 and 3, snare on 2 and 4: the heart of rock and pop.' },
  { name: 'Cinquillo', steps: 8, onsets: [1, 3, 4, 6, 7], voicing: [D, 'T', 'S', 'T', 'S'], about: 'A five-note Cuban pattern from danzón and son.' },
  { name: 'Son clave', steps: 16, onsets: [1, 4, 7, 11, 13], voicing: CLAVE_VOICING, about: 'The 3-2 key pattern of Cuban son and salsa.' },
  { name: 'Rumba clave', steps: 16, onsets: [1, 4, 8, 11, 13], voicing: CLAVE_VOICING, about: 'Like son clave, with the third note pushed one step later.' },
  { name: 'Bossa nova', steps: 16, onsets: [1, 4, 7, 11, 14], voicing: CLAVE_VOICING, about: 'The Brazilian clave; its last note lands one step late.' },
  { name: 'Gahu', steps: 16, onsets: [1, 4, 7, 11, 15], voicing: CLAVE_VOICING, about: 'A bell pattern from the Ewe people of Ghana and Togo.' },
  { name: 'Shiko', steps: 16, onsets: [1, 5, 7, 11, 13], voicing: CLAVE_VOICING, about: 'A West African bell pattern, common in Nigeria.' },
  { name: 'Soukous', steps: 16, onsets: [1, 4, 7, 11, 12], voicing: CLAVE_VOICING, about: 'From Congolese dance music; two notes close together near the end.' },
];

// The Rhythm Library mode: every named rhythm, grouped by length.
export const LIBRARY_SETS = [
  { id: 'one-measure', name: 'One-measure rhythms', measures: 1 },
  { id: 'two-measure', name: 'Two-measure rhythms', measures: 2 },
];

export function libraryRhythms(set) {
  return NAMED_RHYTHMS.filter(r => r.steps === set.measures * BEATS_PER_MEASURE);
}

// A named rhythm in its library voicing, as a phrase like generatePhrase's.
export function libraryPhrase(rhythm) {
  const labels = Array(rhythm.steps).fill('');
  rhythm.onsets.forEach((beat, i) => { labels[beat - 1] = rhythm.voicing[i]; });
  return { labels, name: rhythm.name, about: rhythm.about };
}

export function beatsFor(category) {
  return category.measures * BEATS_PER_MEASURE;
}

function oddBeats(beats) {
  return Array.from({ length: beats }, (_, i) => i + 1).filter(b => b % 2 === 1 && b !== 1);
}

function allowedBeats(category, level) {
  const beats = beatsFor(category);
  return level.where === 'odd' ? oddBeats(beats) : Array.from({ length: beats - 1 }, (_, i) => i + 2);
}

// Named rhythms whose onsets satisfy this level: same length (8-step ones
// repeat to fill 16), a note on beat 1, the right note count, and every
// note after beat 1 on an allowed beat.
export function fittingRhythms(category, level) {
  const beats = beatsFor(category);
  const total = 1 + level.notes;
  const allowed = new Set(allowedBeats(category, level));
  const out = [];
  for (const r of NAMED_RHYTHMS) {
    let onsets;
    let name = r.name;
    if (r.steps === beats) onsets = r.onsets;
    else if (r.steps * 2 === beats) {
      onsets = [...r.onsets, ...r.onsets.map(b => b + r.steps)];
      name = `${r.name} ×2`;
    } else continue;
    if (onsets[0] !== 1 || onsets.length !== total) continue;
    if (!onsets.slice(1).every(b => allowed.has(b))) continue;
    out.push({ name, about: r.about, onsets });
  }
  return out;
}

function pick(arr, rand) {
  return arr[Math.floor(rand() * arr.length)];
}

function shuffle(arr, rand) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function combos(arr, k) {
  if (k === 0) return [[]];
  return arr.flatMap((x, i) => combos(arr.slice(i + 1), k - 1).map(c => [x, ...c]));
}

// Identity of a rhythm for "never twice in a level": Ding / accent / rest
// per beat. Tak and Slap count as the same.
export function rhythmKey(labels) {
  return labels.map(l => (l === 'Ding' ? 'D' : (l ? 'A' : '-'))).join('');
}

// How many different rhythms a level can produce (up to `cap`): each fitting
// named rhythm once, plus random patterns that don't copy a named rhythm's
// timing. A Dings-only timing is one rhythm; a mix timing is one per
// Ding/accent split with at least one accent.
export function distinctRhythmCount(category, level, cap = Infinity) {
  const named = fittingRhythms(category, level);
  const namedPositions = new Set(named.map(r => r.onsets.slice(1).join()));
  const perTiming = level.sounds === 'mix' ? 2 ** level.notes - 1 : 1;
  let count = named.length;
  for (const pos of combos(allowedBeats(category, level), level.notes)) {
    if (count >= cap) return cap;
    if (!namedPositions.has(pos.join())) count += perTiming;
  }
  return Math.min(count, cap);
}

// accentMask[i]: whether note i is a Tak/Slap (false = Ding).
function buildLabels(category, positions, accentMask, rand) {
  const labels = Array(beatsFor(category)).fill('');
  labels[0] = 'Ding';
  positions.forEach((beat, i) => {
    labels[beat - 1] = accentMask[i] ? pick(['T', 'S'], rand) : 'Ding';
  });
  return labels;
}

// Mix: each note Ding, Tak or Slap with equal odds, redrawn until at least
// one is an accent.
function randomMask(level, rand) {
  if (level.sounds !== 'mix') return Array(level.notes).fill(false);
  let mask;
  do mask = Array.from({ length: level.notes }, () => rand() < 2 / 3);
  while (!mask.some(Boolean));
  return mask;
}

function allMasks(level) {
  if (level.sounds !== 'mix') return [Array(level.notes).fill(false)];
  return Array.from({ length: 2 ** level.notes - 1 }, (_, m) =>
    Array.from({ length: level.notes }, (__, i) => Boolean((m + 1) & (1 << i))));
}

// One phrase for the next round. Named rhythms not yet used in this level
// come first; then random patterns that neither copy a named rhythm's timing
// nor repeat an earlier round (usedKeys, see rhythmKey). Returns
// { labels, name, about }, or null when the level has nothing new left.
export function generatePhrase(category, level, { rand = Math.random, usedKeys = new Set(), usedNames = new Set() } = {}) {
  const fitting = fittingRhythms(category, level);
  const fresh = fitting.filter(r => !usedNames.has(r.name));
  if (fresh.length) {
    const choice = pick(fresh, rand);
    const labels = buildLabels(category, choice.onsets.slice(1), randomMask(level, rand), rand);
    return { labels, name: choice.name, about: choice.about };
  }

  const namedPositions = new Set(fitting.map(r => r.onsets.slice(1).join()));
  const allowed = allowedBeats(category, level);
  const tryBuild = (positions, mask) => {
    if (namedPositions.has(positions.join())) return null;
    const labels = buildLabels(category, positions, mask, rand);
    return usedKeys.has(rhythmKey(labels)) ? null : { labels, name: null, about: null };
  };

  // Random draws first; small levels fall through to a full search.
  for (let i = 0; i < 200; i++) {
    const positions = shuffle(allowed, rand).slice(0, level.notes).sort((a, b) => a - b);
    const found = tryBuild(positions, randomMask(level, rand));
    if (found) return found;
  }
  const options = [];
  for (const positions of combos(allowed, level.notes)) {
    for (const mask of allMasks(level)) {
      const found = tryBuild(positions, mask);
      if (found) options.push(found);
    }
  }
  return options.length ? pick(options, rand) : null;
}

// Per-round score out of ROUND_MAX: fewer tries and a faster answer score higher.
export const ROUND_MAX = 100;
const TRY_POINTS = [60, 40, 25];
const TRY_FLOOR = 10;
const TIME_POINTS = 40;
const TIME_GRACE_SEC = 15;
const TIME_ZERO_SEC = 75;

export const HINT_PENALTY = 20;
const SCORE_FLOOR = 5; // a correct answer always earns something

export function roundScore(tries, seconds, { hint = false } = {}) {
  const tryPart = TRY_POINTS[tries - 1] ?? TRY_FLOOR;
  const late = Math.min(1, Math.max(0, (seconds - TIME_GRACE_SEC) / (TIME_ZERO_SEC - TIME_GRACE_SEC)));
  const score = tryPart + Math.round(TIME_POINTS * (1 - late)) - (hint ? HINT_PENALTY : 0);
  return Math.max(SCORE_FLOOR, score);
}

export function verdict(total, max) {
  if (total >= max) return 'Perfect ear! 🎉';
  const ratio = total / max;
  if (ratio >= 0.8) return 'Great ear!';
  if (ratio >= 0.6) return 'Good ear!';
  return 'Room for improvement.';
}
