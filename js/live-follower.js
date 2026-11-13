// Follows a chord progression played in time (Chord listen's Live mode): which
// of the candidate chords is being played, when each change happened, and the
// tempo and metre. Pure: notes in, changes out, no DOM or audio.
//
//   const f = startFollowing([{ labels: ['1', '4', '6'] }, …]);
//   hearNote(f, '3', ms)  // true when that note started a new chord
//   f.changes             // [{ idx, at }] — idx into the candidates
import { detectBpm, detectBeatsPerBar } from './tempo-detect.js';

const WINDOW_MIN_MS = 1500;
const HEARD_KEEP = 16;
const WAIT = -1;

export function startFollowing(candidates) {
  return { candidates, heard: [], onsets: [], changes: [], current: null, bpm: null, endedAt: null };
}

export function beatMs(f) {
  return f?.bpm ? 60000 / f.bpm : null;
}

// Playing stopped at nowMs: the last chord ends on the last beat that started,
// so a stop mid-bar doesn't add one
export function stopFollowing(f, nowMs) {
  const ms = beatMs(f);
  const last = f.changes.at(-1);
  // (+0.001: stopping right on a beat mustn't lose it to rounding)
  if (ms && last) f.endedAt = last.at + Math.max(1, Math.floor((nowMs - last.at) / ms + 0.001)) * ms;
}

// Each chord's length in beats: until the next change, the last one until stopped
export function chordLengths(f) {
  const ms = beatMs(f);
  if (!ms) return [];
  const ends = [...f.changes.slice(1).map(c => c.at), f.endedAt].filter(t => t != null);
  return ends.map((end, i) => Math.max(1, Math.round((end - f.changes[i].at) / ms)));
}

// The last chord ends where playing stopped, not at a change: not a measure
export function beatsPerBar(f) {
  return detectBeatsPerBar(chordLengths(f).slice(0, f.changes.length - 1));
}

// recent: [{ label, weight }], one per note, newer notes weigh more
function scoreCandidate(entry, recent) {
  const set = new Set(entry.labels);
  let score = 0;
  let hit = 0;
  recent.forEach(({ label, weight }) => {
    if (set.has(label)) { score += weight; hit++; } else score -= weight * 0.5;
  });
  return { score, hit, size: set.size };
}

// Which chord the newest notes point to. A change starts at the first note
// outside the current chord; it's settled once the notes since then fit one
// chord only (or three of them pick the closest), so an arpeggio passing
// through shared notes doesn't flicker through in-between chords.
// Returns a candidate index, WAIT while several chords still fit, or null when
// none fit (passing notes: the weighted fallback decides).
function chordFromFreshNotes(f, fresh) {
  const labels = [...new Set(fresh.map(h => h.label))];
  const fits = f.candidates
    .map((entry, idx) => ({ idx, size: entry.labels.length, all: labels.every(l => entry.labels.includes(l)) }))
    .filter(c => c.all && c.idx !== f.current);
  if (fits.length === 1 && labels.length >= Math.min(2, fits[0].size)) return fits[0].idx;
  if (fits.length > 1 && labels.length >= 3) return fits.sort((a, b) => a.size - b.size)[0].idx;
  return fits.length ? WAIT : null;
}

// Fallback for melodies with passing notes: newer notes weigh more
function chordFromWeightedNotes(f, at, recent) {
  const newest = new Map();
  recent.forEach(h => newest.set(h.label, h.at));
  const fade = beatMs(f) || 600;
  const labels = [...newest].map(([label, t]) => ({ label, weight: Math.exp(-(at - t) / fade) }));
  let best = null;
  f.candidates.forEach((entry, idx) => {
    const s = scoreCandidate(entry, labels);
    if (!best || s.score > best.score || (s.score === best.score && idx === f.current)) best = { ...s, idx };
  });
  if (!best || best.idx === f.current) return null;
  const cur = f.current == null ? null : scoreCandidate(f.candidates[f.current], labels);
  if (best.hit < Math.min(2, best.size) || (cur && best.score <= cur.score + 1)) return null;
  return best.idx;
}

// A note was heard (label, ms). True when it settled a new chord.
export function hearNote(f, label, at) {
  f.onsets.push(at);
  f.heard.push({ label, at });
  if (f.heard.length > HEARD_KEEP) f.heard.shift();
  f.bpm = detectBpm(f.onsets) || f.bpm;

  const windowMs = Math.max(WINDOW_MIN_MS, (beatMs(f) || 0) * 2);
  const recent = f.heard.filter(h => at - h.at <= windowMs);
  const curLabels = f.current == null ? null : f.candidates[f.current].labels;
  // The notes from the first one since the last change that isn't in the current chord
  let breakAt = -1;
  if (curLabels) {
    const since = f.changes.at(-1).at;
    breakAt = recent.findIndex(h => h.at > since && !curLabels.includes(h.label));
    if (breakAt === -1) return false; // still the same chord
  }
  const fresh = curLabels ? recent.slice(breakAt) : recent;
  let next = chordFromFreshNotes(f, fresh);
  let start = fresh[0]?.at ?? at;
  if (next === WAIT) return false;
  if (next == null) {
    next = chordFromWeightedNotes(f, at, recent);
    if (next == null) return false;
    // It began at the first of the newest run of notes in the new chord
    const set = new Set(f.candidates[next].labels);
    start = at;
    for (let i = recent.length - 1; i >= 0 && set.has(recent[i].label); i--) start = recent[i].at;
  }
  f.current = next;
  f.changes.push({ idx: next, at: start });
  return true;
}
