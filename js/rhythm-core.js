/**
 * Core Rhythm Logic & State
 *
 * Extracted to resolve circular dependencies.
 * This file must be loaded BEFORE grid-context.js or noteplayer.js.
 *
 * Model: beats (per measure) × subdivision (steps per beat) = stepsPerMeasure
 * BPM always refers to beats per minute — what the user taps, what the metronome clicks.
 */

// Global defaults (used before any grid is instantiated)
let beats = Number(localStorage.getItem('defaultBeats')) || 4;
let subdivision = Number(localStorage.getItem('defaultSubdivision')) || 2;

export let STEPS = beats * subdivision; // e.g. 4 × 2 = 8

export function getBeats() { return beats; }
export function getSubdivision() { return subdivision; }

export function setBeatsState(b) {
  beats = Math.max(1, Math.round(b));
  localStorage.setItem('defaultBeats', beats);
  STEPS = beats * subdivision;
}

export function setSubdivisionState(s) {
  subdivision = Math.max(1, Math.round(s));
  localStorage.setItem('defaultSubdivision', subdivision);
  STEPS = beats * subdivision;
}

// ---------------------------------------------------------------------------
// Migration helper — converts old { mode, timeSignature } → { beats, subdivision }
// ---------------------------------------------------------------------------
export function migratePatternState(state) {
  if (!state) return;
  if (state.subdivision !== undefined) return; // already new format

  const base = state.mode === '16' ? 16 : 8;
  const ts = state.timeSignature || '4/4';
  const parts = ts.split('/');
  const num = parseInt(parts[0]) || 4;
  const den = parseInt(parts[1]) || 4;

  state.beats = num;
  state.subdivision = Math.max(1, Math.round(base / den));
}
