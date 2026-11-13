// One mic, two things heard: handpan notes (onNote) and clap/snap cues (onCue).
// A handpan strike rings on with a clear pitch; a clap or snap is a short burst
// with no stable pitch that dies away within ~100 ms. Notes heard during a burst
// that turns out to be a cue are dropped, so a clap never adds a stray note.
// Own mic stream, like js/pitch-detector.js, so it can't fight transcription.js.
//
// One note per strike: a handpan note's octave partial is loud, so for a moment
// after a strike every pitch heard gets a vote, and only the strongest counts.
// While it rings, its other octaves are ignored unless clearly struck. Multi-note
// (beta) instead counts everything heard in the strike.
import { getAudioCtx } from './noteplayer.js';
import { autoCorrelate, findClosestScaleNote } from './transcription.js';

const BUFSIZE = 2048;
const buf = new Float32Array(BUFSIZE);

const MIN_CLARITY = 0.6;
const DETECTION_LATENCY_MS = 32; // autoCorrelate needs a few cycles (same value as pitch-detector.js)
const RESTRIKE_FLUX = 1.3; // RMS jump that counts as the same note struck again
const RING_MS = 3000; // a note heard within this is still ringing unless struck again
const STRIKE_MIN_MS = 120; // an attack still swelling on the next frames isn't a second strike
const ONSET_FLUX = 1.8;
const ONSET_MIN_RMS = 0.02;
const ONSET_REFRACTORY_MS = 90;
const CUE_WINDOW_MS = 130; // how long a burst is watched before deciding
const CUE_DECAY = 0.4; // a cue falls below this share of its peak (above the floor) by the end
const CUE_MAX_PITCHED_FRAMES = 1;
const SOUND_MIN_GAP_MS = 120;
const SOUND_SETTLE_MS = 40; // skip the attack: its pitch isn't the note yet
const SOUND_LISTEN_MS = 600;
const SOUND_MIN_FRAMES = 4;
const SOUND_MIN_CLARITY = 0.5; // looser than for notes: a sound we can't name is still worth hearing
const VOTE_MS = 100; // how long a strike's pitches are weighed before one is chosen
const OCTAVE_HOLD_MS = 1500; // other octaves of the chosen note are ignored this long…
const ATTACK_GRACE_MS = 90; // …unless they arrive this soon after a fresh attack
const MULTI_MIN_SHARE = 0.3; // Multi-note: notes this strong next to the strongest count too

let micStream = null;
let sourceNode = null;
let analyser = null;
let rafId = null;
let handlers = {};
let prevRms = 0;
let floorRms = 0; // the level just before the latest onset (ringing notes, room)
let lastOnsetAt = -Infinity;
let candidate = null; // { at, peak, floor, pitched, held: [] } — a burst being judged
const noteGate = new Map(); // label -> { seen, rms, struck }: last heard, how loud, last counted as a strike
let sound = null; // the strike being measured: { at, freqs, label }
let lastSound = null; // the last finished one: { at, freq, label }
let vote = null; // a strike being weighed: { at, scores: Map label -> { score, pc } }
let focus = null; // the note chosen last: { label, pc, at }, holding off its other octaves
let lastAttackAt = -Infinity;
let multiNote = false;

// Multi-note (beta): count every note heard in a strike, octaves included
export function setMultiNote(on) {
  multiNote = !!on;
}

const pitchClass = freq => ((Math.round(12 * Math.log2(freq / 440)) % 12) + 12 + 9) % 12;

async function openMic(audioCtx) {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { sampleRate: audioCtx.sampleRate, echoCancellation: false, autoGainControl: false, noiseSuppression: false },
    });
  } catch {
    return navigator.mediaDevices.getUserMedia({ audio: true });
  }
}

function frameRms() {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

const median = list => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];

// Each strike's own pitch, named or not, so it can be taught ("that was a G")
function trackSound(nowMs, rms, flux, pitch) {
  if (flux > RESTRIKE_FLUX && rms > ONSET_MIN_RMS && (!sound || nowMs - sound.at > SOUND_MIN_GAP_MS)) {
    finishSound();
    sound = { at: nowMs, freqs: [], label: null };
  }
  if (!sound) return;
  const age = nowMs - sound.at;
  if (age > SOUND_SETTLE_MS && pitch && pitch !== -1 && pitch.clarity >= SOUND_MIN_CLARITY) sound.freqs.push(pitch.freq);
  if (age > SOUND_LISTEN_MS) finishSound();
}

function finishSound() {
  const s = sound;
  sound = null;
  if (!s || s.freqs.length < SOUND_MIN_FRAMES) return;
  lastSound = { at: s.at, freq: median(s.freqs), label: s.label };
  handlers.onSound?.(lastSound);
}

function emitNote(note) {
  if (sound && !sound.label) sound.label = note.label;
  if (candidate) candidate.held.push(note);
  else handlers.onNote?.(note.label, note.at);
}

// The strike's strongest pitch counts; the rest (in Multi-note, the strong ones) too
function closeVote() {
  const v = vote;
  vote = null;
  const ranked = [...v.scores.entries()].sort((a, b) => b[1].score - a[1].score);
  const [winner, best] = ranked[0];
  emitNote({ label: winner, at: v.at - DETECTION_LATENCY_MS });
  focus = { label: winner, pc: best.pc, at: v.at };
  if (!multiNote) return;
  ranked.slice(1)
    .filter(([, r]) => r.score >= best.score * MULTI_MIN_SHARE)
    .forEach(([label]) => emitNote({ label, at: v.at - DETECTION_LATENCY_MS }));
}

// Another octave of the note in focus, with no fresh attack: its partial, not a strike
function octaveOfFocus(label, pc, nowMs) {
  return !multiNote && focus && label !== focus.label && pc === focus.pc
    && nowMs - focus.at < OCTAVE_HOLD_MS && nowMs - lastAttackAt > ATTACK_GRACE_MS;
}

function judgeCandidate(nowMs, rms) {
  const c = candidate;
  if (nowMs - c.at < CUE_WINDOW_MS) return;
  candidate = null;
  const decayed = rms - c.floor < CUE_DECAY * (c.peak - c.floor);
  if (decayed && c.pitched <= CUE_MAX_PITCHED_FRAMES) {
    handlers.onCue?.(c.at);
  } else {
    c.held.forEach(n => handlers.onNote?.(n.label, n.at));
  }
}

function loop() {
  if (!analyser) return;
  const audioCtx = getAudioCtx();
  analyser.getFloatTimeDomainData(buf);
  const nowMs = audioCtx.currentTime * 1000;
  const rms = frameRms();
  const flux = prevRms > 0 ? rms / prevRms : 0;

  // A sudden burst: watch it for a moment to tell a clap from a strike
  if (flux > ONSET_FLUX && rms > ONSET_MIN_RMS && nowMs - lastOnsetAt > ONSET_REFRACTORY_MS && !candidate) {
    lastOnsetAt = nowMs;
    candidate = { at: nowMs, peak: rms, floor: floorRms, pitched: 0, held: [] };
  }
  if (candidate) candidate.peak = Math.max(candidate.peak, rms);
  else floorRms = floorRms * 0.8 + rms * 0.2;

  const pitch = autoCorrelate(buf, audioCtx.sampleRate);
  trackSound(nowMs, rms, flux, pitch); // before naming notes, so a strike knows its note
  if (flux > RESTRIKE_FLUX && rms > ONSET_MIN_RMS) lastAttackAt = nowMs;
  if (pitch && pitch !== -1 && pitch.clarity >= MIN_CLARITY) {
    const label = findClosestScaleNote(pitch.freq);
    if (label) {
      if (candidate) candidate.pitched += 1;
      const pc = pitchClass(pitch.freq);
      const gate = noteGate.get(label);
      const ringing = gate && (nowMs - gate.struck < STRIKE_MIN_MS
        || (nowMs - gate.seen < RING_MS && rms / gate.rms < RESTRIKE_FLUX));
      const weight = pitch.clarity * rms;
      if (vote && (!ringing || vote.scores.has(label))) {
        const r = vote.scores.get(label) || { score: 0, pc };
        r.score += weight;
        vote.scores.set(label, r);
      } else if (!vote && !ringing && !octaveOfFocus(label, pc, nowMs)) {
        vote = { at: nowMs, scores: new Map([[label, { score: weight, pc }]]) };
      }
      // rms follows the decay, so a new strike stands out
      noteGate.set(label, { seen: nowMs, rms, struck: ringing ? gate.struck : nowMs });
    }
  }
  if (vote && nowMs - vote.at >= VOTE_MS) closeVote();

  if (candidate) judgeCandidate(nowMs, rms);
  prevRms = rms;
  handlers.onLevel?.(rms);
  rafId = requestAnimationFrame(loop);
}

// handlers: { onNote(label, ms), onCue(ms), onLevel(rms), onSound({ at, freq, label }) }; times are on the
// AudioContext clock (ms). Resolves false if the mic can't be opened.
function attach(source, nextHandlers) {
  const audioCtx = getAudioCtx();
  sourceNode = source;
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = BUFSIZE;
  source.connect(analyser);
  handlers = nextHandlers || {};
  prevRms = 0;
  floorRms = 0;
  candidate = null;
  sound = null;
  lastSound = null;
  vote = null;
  focus = null;
  noteGate.clear();
  rafId = requestAnimationFrame(loop);
}

export async function startListening(nextHandlers) {
  const audioCtx = getAudioCtx();
  if (!audioCtx) return false;
  if (audioCtx.state === 'suspended') await audioCtx.resume();
  stopListening();
  try {
    micStream = await openMic(audioCtx);
  } catch (err) {
    console.error('[ListenEngine] Microphone error:', err);
    return false;
  }
  attach(audioCtx.createMediaStreamSource(micStream), nextHandlers);
  return true;
}

// Listens to a recording as it plays (and lets it be heard), instead of the mic.
// An element can only be wired into the audio graph once, so its node is kept.
const clipNodes = new WeakMap();

export async function startListeningToClip(mediaEl, nextHandlers) {
  const audioCtx = getAudioCtx();
  if (!audioCtx) return false;
  if (audioCtx.state === 'suspended') await audioCtx.resume();
  stopListening();
  let node = clipNodes.get(mediaEl);
  if (!node) {
    node = audioCtx.createMediaElementSource(mediaEl);
    node.connect(audioCtx.destination);
    clipNodes.set(mediaEl, node);
  }
  attach(node, nextHandlers);
  return true;
}

export function stopListening() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  handlers = {};
  candidate = null;
  if (sourceNode && analyser) {
    try { sourceNode.disconnect(analyser); } catch { /* already apart */ }
  }
  sourceNode = null;
  micStream?.getTracks().forEach(t => t.stop());
  micStream = null;
  analyser = null;
}

// The open mic stream, for recording exactly what's being listened to
export function getMicStream() {
  return micStream;
}

// The last strike heard, named or not: { at, freq, label }. One still ringing
// counts once it's been heard clearly enough.
export function getLastSound() {
  if (sound && sound.freqs.length >= SOUND_MIN_FRAMES) return { at: sound.at, freq: median(sound.freqs), label: sound.label };
  return lastSound;
}
