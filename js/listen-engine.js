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
import { getScale } from './state.js';
import { parseNoteName } from './voice-commands.js';

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
const SPECTRUM_SIZE = 8192; // fine enough to tell neighbouring low pan notes apart
const BAND = 0.025; // a note's band: ±2.5% around its pitch
const STRUCK_RISE_DB = 6; // a note struck in this strike rose at least this much
const CHORD_RANGE_DB = 18; // and is within this of the loudest note struck
const STRUCK_FLOOR_DB = -80; // below this it's the noise floor wobbling, not a note
const STRUCK_BELOW_PEAK_DB = 40; // …or this far under the loudest sound in the spectrum
const OVERTONE_MARGIN_DB = 4; // an octave/twelfth this much weaker than its root is its overtone
const SPECTRA_KEPT = 4; // a strike shows as a rise against the spectrum ~50 ms before
const RESTRUCK_MS = 250; // a note found in a strike isn't found again this soon
const CLEAR_TIE = 0.04; // 'clearest': this close in clarity counts as a tie (the higher note wins)

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
let choice = 'strongest'; // 'strongest' (clarity × loudness) or 'clearest'
let octaveGuard = false; // with multiNote: still ignore other octaves of a held note
let spectral = false; // with multiNote: find a strike's notes in the spectrum
let spectrumAnalyser = null;
let spectrumBuf = null;
let spectra = []; // the last few spectra, newest last (spectral mode)
const lastStruck = new Map(); // label -> when a strike last found it

// Multi-note (beta): count every note heard in a strike, octaves included
export function setMultiNote(on) {
  multiNote = !!on;
}

// How a strike's note is chosen. 'clearest': the clearest pitch, and of two
// about as clear, the higher (a melody over a bassline). octaveGuard keeps a
// held note's other octaves out even when several notes count.
// spectralChords: notes struck together are found in the spectrum (one pitch
// detector alone hears two notes as one, sometimes a note in between).
export function setNoteChoice({ pick = 'strongest', guardOctaves = false, spectralChords = false } = {}) {
  choice = pick;
  octaveGuard = guardOctaves;
  spectral = spectralChords;
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
  if (multiNote && spectral && v.pre) {
    const struck = freshlyStruck(struckNotes(v.pre, readSpectrum()), v.at);
    if (struck.length) {
      struck.forEach((n) => {
        lastStruck.set(n.label, v.at);
        emitNote({ label: n.label, at: v.at - DETECTION_LATENCY_MS });
      });
      focus = { label: struck[0].label, pc: struck[0].pc, at: v.at };
      return;
    }
  }
  // In spectral mode the spectrum has the last word: a pitch with no strike
  // behind it (a ringing note's sub-octave, say) is not a note
  if (!v.scores.size || (multiNote && spectral && v.pre)) return;
  const ranked = [...v.scores.entries()].sort((a, b) => b[1].score - a[1].score);
  const [winner, best] = choice === 'clearest' ? clearestOf(ranked) : ranked[0];
  emitNote({ label: winner, at: v.at - DETECTION_LATENCY_MS });
  focus = { label: winner, pc: best.pc, at: v.at };
  if (!multiNote) return;
  ranked
    .filter(([label, r]) => label !== winner && r.score >= best.score * MULTI_MIN_SHARE)
    .filter(([, r]) => !(octaveGuard && r.pc === best.pc)) // its overtone, not a second note
    .forEach(([label]) => emitNote({ label, at: v.at - DETECTION_LATENCY_MS }));
}

// --- Notes struck together, from the spectrum ---

// Each pan note and its pitch, for the scale in use
function panPitches() {
  const scale = getScale();
  if (!scale) return [];
  return [['Ding', scale.ding], ...Object.entries(scale.map || {})]
    .map(([label, name]) => {
      const p = parseNoteName(name);
      return p && { label, pc: p.pc, freq: 440 * 2 ** ((p.midi - 69) / 12) };
    })
    .filter(Boolean);
}

function readSpectrum() {
  if (!spectrumAnalyser) return null;
  spectrumAnalyser.getFloatFrequencyData(spectrumBuf);
  return Float32Array.from(spectrumBuf);
}

// The loudest bin (dB) in a note's band, and whether it's a peak of its own
// rather than the slope of a louder note a semitone away
function band(spectrum, freq) {
  const binHz = getAudioCtx().sampleRate / SPECTRUM_SIZE;
  const lo = Math.max(1, Math.floor((freq * (1 - BAND)) / binHz));
  const hi = Math.min(spectrum.length - 2, Math.ceil((freq * (1 + BAND)) / binHz));
  let at = lo;
  for (let i = lo; i <= hi; i++) if (spectrum[i] > spectrum[at]) at = i;
  const peak = spectrum[at] >= spectrum[at - 1] && spectrum[at] >= spectrum[at + 1]
    && spectrum[at] >= spectrum[Math.max(0, at - 2)] && spectrum[at] >= spectrum[Math.min(spectrum.length - 1, at + 2)];
  return { level: spectrum[at], peak, hz: at * binHz };
}

// The pan notes this strike sounded: their band jumped since just before it,
// they're near the loudest one, and aren't just an overtone (octave or twelfth)
// of a stronger note struck with them. Loudest first.
function struckNotes(before, after) {
  if (!before || !after) return [];
  const pitches = panPitches();
  // A peak belongs to the pan note it's nearest: a semitone neighbour's band can
  // catch the edge of a louder note's peak
  const nearest = hz => pitches.reduce((best, p) => (Math.abs(Math.log(hz / p.freq)) < Math.abs(Math.log(hz / best.freq)) ? p : best));
  const notes = pitches.map((n) => {
    const now = band(after, n.freq);
    const own = now.peak && nearest(now.hz) === n;
    return { ...n, level: now.level, peak: own, rise: now.level - band(before, n.freq).level };
  });
  let loudestBin = -Infinity;
  for (let i = 0; i < after.length; i++) if (after[i] > loudestBin) loudestBin = after[i];
  const floor = Math.max(STRUCK_FLOOR_DB, loudestBin - STRUCK_BELOW_PEAK_DB);
  const struck = notes.filter(n => n.peak && n.level >= floor && n.rise >= STRUCK_RISE_DB).sort((a, b) => b.level - a.level);
  if (!struck.length) return [];
  const loudest = struck[0].level;
  const near = struck.filter(n => n.level >= loudest - CHORD_RANGE_DB);
  const isOvertone = n => near.some(root => root !== n
    && [2, 3, 4].some(h => Math.abs(n.freq / (root.freq * h) - 1) < BAND)
    && n.level < root.level - OVERTONE_MARGIN_DB);
  return near.filter(n => !isOvertone(n));
}

// A strike under notes still ringing barely changes the overall level, but its
// own band jumps: open a vote for it even when the pitch detector hears no change
function watchSpectrum(nowMs) {
  const now = readSpectrum();
  if (!now) return;
  spectra.push(now);
  if (spectra.length > SPECTRA_KEPT) spectra.shift();
  if (vote || spectra.length < SPECTRA_KEPT) return;
  if (freshlyStruck(struckNotes(spectra[0], now), nowMs).length) vote = { at: nowMs, scores: new Map(), pre: spectra[0] };
}

const freshlyStruck = (notes, at) => notes.filter(n => !(at - (lastStruck.get(n.label) ?? -Infinity) < RESTRUCK_MS));

// The clearest pitch heard; of two about as clear, the higher one
function clearestOf(ranked) {
  const byClarity = [...ranked].sort((a, b) => b[1].clarity - a[1].clarity);
  const top = byClarity[0];
  const tie = byClarity.filter(([, r]) => top[1].clarity - r.clarity <= CLEAR_TIE);
  return tie.sort((a, b) => b[1].freq - a[1].freq)[0];
}

// Another octave of the note in focus, with no fresh attack: its partial, not a strike
function octaveOfFocus(label, pc, nowMs) {
  return (!multiNote || octaveGuard) && focus && label !== focus.label && pc === focus.pc
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

  if (spectral && multiNote) watchSpectrum(nowMs);
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
        const r = vote.scores.get(label) || { score: 0, pc, clarity: 0, freq: pitch.freq };
        r.score += weight;
        r.clarity = Math.max(r.clarity, pitch.clarity);
        vote.scores.set(label, r);
      } else if (!vote && !ringing && !octaveOfFocus(label, pc, nowMs)) {
        vote = { at: nowMs, scores: new Map([[label, { score: weight, pc, clarity: pitch.clarity, freq: pitch.freq }]]), pre: spectra[0] };
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
  spectrumAnalyser = audioCtx.createAnalyser();
  spectrumAnalyser.fftSize = SPECTRUM_SIZE;
  spectrumAnalyser.smoothingTimeConstant = 0;
  source.connect(spectrumAnalyser);
  spectrumBuf = new Float32Array(spectrumAnalyser.frequencyBinCount);
  spectra = [];
  lastStruck.clear();
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
    try { sourceNode.disconnect(spectrumAnalyser); } catch { /* already apart */ }
  }
  spectrumAnalyser = null;
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
