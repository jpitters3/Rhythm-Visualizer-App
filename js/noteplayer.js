/* ==== Audio and musical functionality including scales ==== */
import { gridA, gridB } from './grid-context.js';
import { setBeatsState, setSubdivisionState } from './rhythm-core.js';
import { supabase } from './supabase-client.js';
import { currentUser, activeGrid, setActiveGrid } from './state.js';
import { HistoryManager } from './history.js';
import { TransportRegistry } from './transport-ui.js';
import { isListening, getSelectedScaleName, setSelectedScaleName, getScale, setCurrentScale } from './state.js';
import { SCALE_KEY_LOCAL, SCALE_KEY_REMOTE, AUDIO_DELAY, VISUAL_HEADSTART, BASE_PATH } from './config.js';
import { renderAllMeasures } from './notegrid.js';
import { coachingSession, isCoaching, isReviewing } from './coaching-mode.js';
import { turnOffMic } from './transcription.js';

const SOUND_TAK = 'Tak';
const SOUND_SLAP = 'Slap';

// highlighterFn and observers stay here as they are logic-bound
let highlighterFn = null;
let tickObservers = [];

export function registerHighlighter(fn) { highlighterFn = fn; }
export function addTickObserver(fn) { tickObservers.push(fn); }
export function removeTickObserver(fn) {
  tickObservers = tickObservers.filter(o => o !== fn);
}

let countdownRemaining = 0;
const COUNTDOWN_LENGTH = 4; // 4 steps

export function noteForLabel(label) {
  // 1. Common Sounds
  if (label === 'T') return SOUND_TAK;
  if (label === 'S') return SOUND_SLAP;

  // 2. Look up in current scale (Unified)
  const scale = getScale();
  if (!scale) return null;

  if (label === 'Ding' || label === 'D') return `${scale.ding}_ding`;

  // Return Pitch if found in map (e.g. "1" -> "A3")
  if (scale.map && scale.map[label]) return scale.map[label];

  // 3. Absolute Pitch Fallback (for MIDI songs)
  if (label && String(label).match(/^[A-G][#b]?[0-9]$/)) {
    return label;
  }

  return null;
}

// Build note → filename map from all .wav files in the audio folder.
// Strips any scale-name suffix so "As3-laSirena.wav" maps to the key "As3",
// the same as a plain "As3.wav" would. New files are picked up automatically.
const _audioFilePaths = Object.keys(import.meta.glob('../public/assets/audio/*.wav'));
const NOTE_FILE_MAP = {};
for (const path of _audioFilePaths) {
  const filename = path.split('/').pop();
  const stem = filename.replace(/\.wav$/, '');
  const noteKey = stem.split('-')[0];
  NOTE_FILE_MAP[noteKey] = filename;
}

function noteToFile(note) {
  if (!note) return '';
  const base = note.replace('#', 's');
  return NOTE_FILE_MAP[base] ?? (base + '.wav');
}

/* Player Functionality */

// Metronome
let audioCtx = null;
let audioUnlocked = false;
let samplesPreloaded = false;
// Safari requires a silent buffer playback to force audio hardware initialization.
// Without it, the hardware starts up 500–800ms after the first scheduled note,
// causing visuals to appear before any sound is heard.
let audioHardwareReady = false;

// Volume State (persisted with sanitization)
const getStoredVol = (key) => {
  const val = parseFloat(localStorage.getItem(key));
  return isFinite(val) ? Math.max(0, Math.min(1, val)) : 1.0;
};
let volInstrument = getStoredVol('gp_vol_inst');
let volMetronome = getStoredVol('gp_vol_metro');

export function getVolume(type) {
  if (type === 'metronome') return volMetronome;
  return volInstrument;
}

export function setVolume(type, val) {
  const sanitizedVal = isFinite(val) ? Math.max(0, Math.min(1, val)) : 1.0;
  if (type === 'metronome') {
    volMetronome = sanitizedVal;
    localStorage.setItem('gp_vol_metro', volMetronome);
    console.log('[Audio] Metronome volume set to:', volMetronome);
  } else {
    volInstrument = sanitizedVal;
    localStorage.setItem('gp_vol_inst', volInstrument);
    console.log('[Audio] Instrument volume set to:', volInstrument);
  }
}

export async function unlockAudio() {
  console.log('[Audio] unlockAudio called');
  audioUnlocked = true;
  await ensureAudio();
  return preloadAudioSamples();
}

// ===== HANDPAN SAMPLE BUFFERS =====
export const samples = {};

export function intervalMs(ctx) {
  const c = ctx || activeGrid;
  const bpm = Math.max(1, c.bpm || 120);
  // ms per step = ms per beat ÷ subdivision
  return (60000 / bpm) / (c.subdivision || 2);
}

export async function ensureAudio() {
  // Don’t create/resume AudioContext until a real user gesture has happened
  if (!audioUnlocked) {
    console.warn('[Audio] ensureAudio called but audioUnlocked is false - returning early');
    return Promise.resolve();
  }

  if (!audioCtx) {
    console.log('[Audio] Creating new AudioContext');
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) {
      audioCtx = new Ctx();
      console.log('[Audio] AudioContext created:', audioCtx?.state);
      // Safari aggressively auto-suspends AudioContexts after inactivity.
      // Re-resume immediately so the next note plays without a 1-2s delay.
      audioCtx.addEventListener('statechange', () => {
        if (audioCtx.state === 'suspended' && audioUnlocked) {
          audioCtx.resume().catch(() => {});
          // Hardware will need to re-initialize on next play after a suspend.
          audioHardwareReady = false;
        }
      });
    }
  }

  // Resume if suspended (including newly created contexts)
  if (audioCtx && audioCtx.state === 'suspended') {
    console.log('[Audio] Resuming suspended AudioContext');
    return audioCtx.resume()
      .then(() => console.log('[Audio] AudioContext resumed successfully, state:', audioCtx.state))
      .catch((err) => console.error('[Audio] Failed to resume AudioContext:', err));
  }

  return Promise.resolve();
}

// Safari's audio hardware can take 500–800ms to initialize after AudioContext.resume()
// resolves. Playing a silent single-sample buffer forces the hardware to start up
// immediately, so by the time the scheduler runs, audio output is already live.
async function warmUpAudioHardware() {
  if (audioHardwareReady || !audioCtx || audioCtx.state !== 'running') return;
  try {
    const buf = audioCtx.createBuffer(1, 1, audioCtx.sampleRate);
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    src.connect(audioCtx.destination);
    src.start(0);
  } catch (_) {}
  // Give the hardware time to come up before the real scheduler starts.
  await new Promise(r => setTimeout(r, 100));
  audioHardwareReady = true;
}

// Preload note samples once audio is unlocked
export async function preloadScaleSamples() {
  const s = getScale();
  const notes = new Set([(s.ding || 'D3') + '_ding', ...Object.values(s.map)]);
  for (const n of notes) {
    let note = noteToFile(n); // includes .wav extension
    try { await loadSample(n, `${BASE_PATH}assets/audio/${note}`); }
    catch (e) {
      // console.log(`Error loading sample [${note}]: ${e}`); 
    }
  }
}

export async function preloadAudioSamples() {
  if (!samplesPreloaded && audioCtx) {
    samplesPreloaded = true;
    const loads = [
      loadSample(SOUND_TAK, `${BASE_PATH}assets/audio/dkurd_tak.wav`),
      loadSample(SOUND_SLAP, `${BASE_PATH}assets/audio/dkurd_slap.wav`),
      preloadScaleSamples()
    ];
    return Promise.all(loads);
  }
  return Promise.resolve();
}
async function loadSample(key, url) {
  ensureAudio();
  if (!audioCtx) return;

  const res = await fetch(url);
  const arrayBuffer = await res.arrayBuffer();
  samples[key] = await audioCtx.decodeAudioData(arrayBuffer);
}

let currentMetroSound = localStorage.getItem('metronomeSoundPref') || 'Click';

export function getMetronomeSound() {
  return currentMetroSound;
}

export function setMetronomeSound(sound) {
  currentMetroSound = sound;
  localStorage.setItem('metronomeSoundPref', sound);
}

function metroClick(kind, delay = 0) {
  ensureAudio();
  if (!audioCtx) return;

  const t = audioCtx.currentTime + (isFinite(delay) ? delay : 0);
  if (!isFinite(t)) return;

  if (currentMetroSound === 'Shaker') {
    // Shaker Synthesis (Filtered White Noise)
    const bufferSize = audioCtx.sampleRate * 0.1; // 100ms noise buffer
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noiseSource = audioCtx.createBufferSource();
    noiseSource.buffer = buffer;

    // Bandpass to focus on the 'tsss' frequencies (7kHz - 10kHz)
    const bandpass = audioCtx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.setValueAtTime(8000, t);
    bandpass.Q.setValueAtTime(1.5, t);

    const gain = audioCtx.createGain();
    const peakVol = (kind === 'downbeat') ? 0.35 : (kind === 'beat' ? 0.25 : 0.15);
    const targetLevel = Math.max(0.0001, peakVol * volMetronome);

    // Shaker Envelope: fast attack, smooth decay
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(targetLevel, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);

    noiseSource.connect(bandpass);
    bandpass.connect(gain);
    gain.connect(audioCtx.destination);

    noiseSource.start(t);
    noiseSource.stop(t + 0.1);
  } else {
    // Classic Square Click
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'square';
    const freq = (kind === 'downbeat') ? 1600 : (kind === 'beat' ? 1300 : 1000);
    const level = (kind === 'downbeat') ? 0.28 : (kind === 'beat' ? 0.20 : 0.12);

    osc.frequency.setValueAtTime(freq, t);

    // Click Envelope (with volume control)
    const targetLevel = Math.max(0.0001, level * volMetronome);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(targetLevel, t + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start(t);
    osc.stop(t + 0.04);
  }
}

export function isDownbeatStep(stepIndex, mode) {
  // Grid uses a simple index % 2 check for colors (R-L-R-L)
  // regardless of 8th/16th note mode.
  return stepIndex % 2 === 0;
}

// Helpers for the Countdown UI
function showCountdown(num) {
  const overlay = document.getElementById('countdownOverlay');
  const text = document.getElementById('countdownNumber');

  if (overlay && text) {
    overlay.style.display = 'flex';
    text.textContent = num;

    // Use WAAPI to pulse the number without forcing a reflow
    text.animate([
      { transform: 'scale(1.5)', opacity: 0 },
      { transform: 'scale(1)', opacity: 1 }
    ], {
      duration: 300,
      easing: 'ease-out'
    });
  }
}

function hideCountdown() {
  const overlay = document.getElementById('countdownOverlay');
  if (overlay) overlay.style.display = 'none';
}

// Helper for Sticking Logic - Exported for Virtual Hands
export function resolveHand(stepIdx, handData, subIdx = 0, isChord = false, mode = '16') {
  // 1. Explicit Sticking (manual override)
  let explicit = null;
  if (Array.isArray(handData)) {
    explicit = handData[subIdx];
  } else if (typeof handData === 'string') {
    explicit = handData;
  }

  if (explicit === 'L') return 'L';
  if (explicit === 'R') return 'R';

  // 2. Chord / Slot Logic
  if (isChord) {
    return (subIdx <= 1) ? 'L' : 'R';
  }

  // 3. Default Time-Based Logic (for single notes)
  return isDownbeatStep(stepIdx, mode) ? 'R' : 'L';
}

// === LOOKAHEAD SCHEDULER ===
let nextNoteTime = 0.0;
const scheduleAheadTime = 0.1; // 100ms looks ahead
const visualQueue = []; // { time, step, ctx }

function nextNote(c) {
  const secondsPerBeat = intervalMs(c) / 1000;
  nextNoteTime += secondsPerBeat;
  c.audioStep++;

  // Transition from Countdown end (-1 -> 0) to Start Step
  // If we were counting down, audioStep just hit 0.
  // If we have a target start (e.g. caret at 5), jump there now.
  if (c.audioStep === 0 && typeof c.targetAudioStart === 'number') {
    c.audioStep = c.targetAudioStart;
    c.targetAudioStart = null;
  }

  // Wrap around for looping (only if positive)
  if (c.audioStep >= c.cells.length) {
    // Shifting audioStartTime forward by one full pattern length
    // ensures getPlaybackPosition stays perfectly synced across loops.
    const patternDuration = (c.cells.length * intervalMs(c)) / 1000;
    c.audioStartTime += patternDuration;
    c.audioStep = 0;
    c.loopCount = (c.loopCount || 0) + 1;
  }
}

function scheduleAudio(c, step, time) {
  // Capture output latency on the first scheduled note of each playback session.
  // audioCtx is guaranteed non-null here since the scheduler is already running.
  if (c.outputLatency === undefined) {
    c.outputLatency = audioCtx.outputLatency ?? audioCtx.baseLatency ?? 0;
  }

  // Store the time and step of the note being scheduled for visual sync
  c.lastScheduledTime = time;
  c.lastScheduledStep = step;

  // Fire the visual when the sound is actually heard: scheduled audio time
  // (time + AUDIO_DELAY) plus the hardware output buffer delay (outputLatency).
  // VISUAL_HEADSTART shifts this earlier if you want visuals to lead the sound.
  visualQueue.push({
    time: time + AUDIO_DELAY + (c.outputLatency || 0) - (VISUAL_HEADSTART || 0),
    step: step,
    ctx: c,
    audioStartTime: c.audioStartTime
  });

  // Delay relative to AudioContext time
  const delay = Math.max(0, time - audioCtx.currentTime + AUDIO_DELAY);

  // 1. COUNTDOWN
  if (step < 0) {
    const countNum = Math.abs(step);
    // Audio Click for countdown
    if (c.metronomeOn) metroClick('beat', delay);
    return;
  }

  // 2. PATTERN
  const realStep = step % c.cells.length;
  const currentData = c.innerLabels[realStep];

  if (Array.isArray(currentData)) {
    currentData.forEach((label) => {
      if (label) playNoteByLabel(label, realStep, delay);
    });
  } else if (currentData) {
    playNoteByLabel(currentData, realStep, delay);
  }

  // 3. METRONOME
  if (c.metronomeOn) {
    const sub = c.subdivision || 2;
    const isBeat = (realStep % sub === 0);
    if (isBeat) {
      const stepsPerMeasure = c.stepsPerMeasure || 8;
      const isDownbeat = (realStep % stepsPerMeasure === 0);
      metroClick(isDownbeat ? 'downbeat' : 'beat', delay);
    } else if (c.metronomeSubdiv) {
      metroClick('subdiv', delay);
    }
  }
}

function scheduler(c) {
  if (!c.playing) return;

  // Schedule Audio
  while (nextNoteTime < audioCtx.currentTime + scheduleAheadTime) {
    scheduleAudio(c, c.audioStep, nextNoteTime);
    nextNote(c);
  }

  // Visual Queue Processing
  const currentTime = audioCtx.currentTime;

  while (visualQueue.length > 0 && visualQueue[0].time <= currentTime) {
    const job = visualQueue.shift();
    tick(job.ctx, job.step, job.time, job.audioStartTime);
  }

  c.timerID = requestAnimationFrame(() => scheduler(c));
}

export function tick(ctx, overrideStep = null, audioTime = null, audioStartTime = null) {
  const c = ctx || activeGrid;
  c.lastTickTime = performance.now(); // Track time for smooth animations

  if (audioTime !== null) {
    c.lastTickAudioTime = audioTime;
  } else if (audioCtx) {
    c.lastTickAudioTime = audioCtx.currentTime;
  }

  if (audioStartTime !== null) {
    c.audioStartTime = audioStartTime;
  }

  // Calculate rendering latency: How late did this visual tick fire compared to its intended scheduled audio time?
  // VISUAL_HEADSTART is already subtracted in scheduleAudio, so `audioTime` is exactly when this visual should have fired.
  let latency = 0;
  if (audioCtx && audioTime !== null) {
    latency = Math.max(0, audioCtx.currentTime - audioTime);
  }

  // If called by scheduler, overrideStep is passed.
  // If called manually or by old code, use c.step (but likely deprecated usage)
  const isScheduler = (overrideStep !== null);

  // If scheduler sets step, use it. Otherwise use c.step
  if (isScheduler) c.step = overrideStep;

  if (!c.playing && !isScheduler) return; // Guard for manual calls
  if (c.isMuted && !isScheduler) return;

  // COUNTDOWN VISUALS
  if (c.step < 0) {
    showCountdown(Math.abs(c.step));
    return;
  } else {
    // Hide if done
    if (document.getElementById('countdownOverlay').style.display !== 'none') {
      hideCountdown();
      if (isCoaching() && !coachingSession.actualStartTime) {
        coachingSession.actualStartTime = Date.now();
      }
    }
  }

  const currentData = c.innerLabels[c.step];
  const currentHandsData = c.innerHands[c.step];
  const stepNotes = [];
  const stepHands = [];

  // Only highlight handpan for Grid A
  const shouldHighlight = (c.id === 'A');

  // Highlight Multiple Notes (Visual Only)
  if (Array.isArray(currentData)) {
    currentData.forEach((label, subIdx) => {
      if (label) {
        const hand = resolveHand(c.step, currentHandsData, subIdx, true, c.subdivision);
        if (shouldHighlight) {
          if (typeof highlighterFn === 'function') {
            highlighterFn(label, c.step, hand, latency);
          }
        }
        stepNotes.push(label);
        stepHands.push(hand);
      }
    });
  } else if (currentData) {
    const hand = resolveHand(c.step, currentHandsData, 0, false, c.subdivision);
    if (shouldHighlight) {
      if (typeof highlighterFn === 'function') {
        highlighterFn(currentData, c.step, hand, latency);
      }
    }
    stepNotes.push(currentData);
    stepHands.push(hand);
  }

  // Notify Observers (e.g. Virtual Hands, Presentation Mode, Transcription)
  if (tickObservers.length > 0) {
    tickObservers.forEach(fn => fn(c, stepNotes, stepHands));
  }

  // Update Visuals (Play Class)
  const allCells = c.cells;
  const prev = c.container?.querySelector('.cell.play');
  if (prev) {
    prev.classList.remove('play');
    prev.style.animationDelay = '';
    prev.style.transitionDelay = '';
  }

  const cell = allCells[c.step];
  if (cell) {
    // Apply negative animation/transition delay so CSS perfectly snaps to the audio reality
    if (latency > 0) {
      const offset = `-${latency.toFixed(3)}s`;
      cell.style.animationDelay = offset;
      cell.style.transitionDelay = offset;
    } else {
      cell.style.animationDelay = '';
      cell.style.transitionDelay = '';
    }
    cell.classList.add('play');
  }

  c.transcriptionIndex = c.step;

  // If NOT scheduler (legacy), advance step manually??
  // No, we assume scheduler drives this now. 
  // If isScheduler is false, we might want to advance? 
  // Let's assume tick is ONLY visual now.
}

function getMetroClickKind(ctx) {
  const c = ctx || activeGrid;
  const sub = c.subdivision || 2;
  const isBeat = (c.step % sub === 0);
  const isDownbeat = (c.step === 0);
  return isDownbeat ? 'downbeat' : (isBeat ? 'beat' : 'sub');
}

export function playNoteByLabel(label, step, delay = 0) {
  let note = noteForLabel(label); // e.g. "C#", "D3_ding"

  // Simon Fallback: If label doesn't exist in current scale, try handpan defaults
  if (!note && (label === 'Ding' || label.match(/^[1-8]$/))) {
    const handpanDefaults = {
      'Ding': 'D3_ding',
      '1': 'A3', '2': 'Bb3', '3': 'C4', '4': 'D4', '5': 'E4', '6': 'F4', '7': 'G4', '8': 'A4'
    };
    note = handpanDefaults[label];
    console.log(`[Audio] Simon Fallback applied for "${label}" -> Note: "${note}"`);
  }

  console.log(`[Audio] playNoteByLabel: "${label}" -> Note: "${note}" (Step: ${step})`);
  if (note) { playNoteSample(note, delay); }
}

export function setBeats(b, ctx) {
  const c = ctx || activeGrid;
  const val = Math.max(1, Math.round(b));
  if (val === c.beats) return;
  const wasPlaying = c.playing;
  if (wasPlaying) stop(c);

  c.beats = val;

  // Keep both grids in sync when editing Grid A's global settings
  if (c === gridA) {
    setBeatsState(val);
    gridB.beats = val;
    const sel = document.getElementById('tsBeats');
    if (sel) sel.value = val;
  }

  renderAllMeasures(c);
  if (wasPlaying) start(c);
}

export function setSubdivision(s, ctx) {
  const c = ctx || activeGrid;
  const val = Math.max(1, Math.round(s));
  if (val === c.subdivision) return;
  const wasPlaying = c.playing;
  if (wasPlaying) stop(c);

  c.subdivision = val;

  if (c === gridA) {
    setSubdivisionState(val);
    gridB.subdivision = val;
    const sel = document.getElementById('tsSub');
    if (sel) sel.value = val;
  }

  renderAllMeasures(c);
  if (wasPlaying) start(c);
}

// ---------------------------------------------------------------------------
// Back-compat shims — old callers that still use setMode / setTimeSignature
// ---------------------------------------------------------------------------
export function setMode(nextMode, ctx) {
  // '8' → subdivision 2, '16' → subdivision 4
  setSubdivision(nextMode === '16' ? 4 : 2, ctx);
}

export function setTimeSignature(ts, ctx) {
  if (!ts || !ts.includes('/')) return;
  const [num, den] = ts.split('/').map(Number);
  // beats = numerator, subdivision derived from denominator (base 8)
  setBeats(num || 4, ctx);
  setSubdivision(Math.max(1, Math.round(8 / (den || 4))), ctx);
}

// ==== PLAY HANDPAN SOUNDS ====
export function playSample(key) {
  ensureAudio();
  if (!audioCtx) return;

  const buffer = samples[key];
  if (!buffer) return; // not loaded yet

  const src = audioCtx.createBufferSource();
  const gain = audioCtx.createGain();

  src.buffer = buffer;

  // Tiny fade-in only (prevents click)
  // Note: exponentialRampToValueAtTime cannot use 0, must use small positive value
  const t = audioCtx.currentTime;
  const targetVol = Math.max(0.0001, volInstrument);
  console.log('[Audio] playSample using volInstrument:', volInstrument, 'targetVol:', targetVol);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(targetVol, t + 0.005);

  // Tiny fade out (prevents click)
  const dur = src.buffer.duration;
  gain.gain.setValueAtTime(targetVol, t + Math.max(0, dur - 0.02));
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  src.connect(gain);
  gain.connect(audioCtx.destination);

  src.start(t);
}

export function playTone() {
  ensureAudio();
  if (!audioCtx) return;

  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = 'triangle';
  osc.frequency.setValueAtTime(330, t);

  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.18, t + 0.003);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.20);

  osc.connect(gain);
  gain.connect(audioCtx.destination);

  osc.start(t);
  osc.stop(t + 0.22);
}

export function playSlap() {
  ensureAudio();
  if (!audioCtx) return;

  const t = audioCtx.currentTime;
  const bufferSize = Math.floor(audioCtx.sampleRate * 0.05);
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1);

  const noise = audioCtx.createBufferSource();
  noise.buffer = buffer;

  const hp = audioCtx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.setValueAtTime(800, t);

  const gain = audioCtx.createGain();  // Click Envelope
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(1.0 * volMetronome, t + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);

  noise.connect(hp);
  hp.connect(gain);
  gain.connect(audioCtx.destination);

  noise.start(t);
  noise.stop(t + 0.06);
}

export function playHandpanSoundForLabel(label) {
  if (samples[label]) playSample(label);
}

// ===== PLAY NOTES BY PITCH =====
const noteSamples = {};

export function playNoteSample(n, delay = 0) {
  ensureAudio();
  const buffer = samples[n];
  if (!audioCtx || !buffer) return;

  // Safari fix: if still suspended after ensureAudio(), defer scheduling until
  // after the resume resolves so the note plays at the correct current time.
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().then(() => scheduleNoteSample(n, buffer, 0)).catch(() => {});
    return;
  }

  scheduleNoteSample(n, buffer, delay);
}

function scheduleNoteSample(n, buffer, delay) {
  const src = audioCtx.createBufferSource();
  const gain = audioCtx.createGain();

  src.buffer = buffer;

  const targetVol = Math.max(0.0001, volInstrument || 1.0);
  const startTime = audioCtx.currentTime + (isFinite(delay) ? delay : 0);

  if (!isFinite(targetVol) || !isFinite(startTime)) {
    console.error('[Audio] Non-finite value in scheduleNoteSample:', { targetVol, startTime, delay });
    return;
  }

  gain.gain.setValueAtTime(targetVol, startTime);

  src.connect(gain);
  gain.connect(audioCtx.destination);
  src.start(startTime);
}


export async function start(ctx, isSync = true, skipCountdown = false) {
  const c = ctx || activeGrid;

  if (c.playing) return;

  await unlockAudio();
  await warmUpAudioHardware();

  c.playing = true;
  c.loopCount = 0; // Reset visual loop counter
  const targetStart = (c.caretIndex !== null && c.caretIndex >= 0) ? c.caretIndex : 0;

  // COUNTDOWN SETUP
  const isGravity = document.body.classList.contains('mode-gravity') && document.body.classList.contains('present');
  const useCountdown = (isListening || isReviewing() || isGravity || c.countdownEnabled) && !skipCountdown;
  if (useCountdown) {
    c.audioStep = -4;
    c.targetAudioStart = targetStart;
  } else {
    c.audioStep = targetStart;
    c.targetAudioStart = null;
  }

  // Init Scheduler
  const secondsPerBeat = intervalMs(c) / 1000;
  nextNoteTime = audioCtx.currentTime;

  // If counting down, audioStartTime represents when the actual pattern (Step 0) starts.
  // This ensures visuals (Highway) are synced to the audio pattern start.
  if (useCountdown) {
    c.audioStartTime = nextNoteTime + (4 * secondsPerBeat);
  } else {
    c.audioStartTime = nextNoteTime;
  }

  c.lastTickAudioTime = nextNoteTime;

  visualQueue.length = 0;
  c.cells.forEach(el => el.classList.remove('play'));

  scheduler(c);

  if (c.id === 'A') {
    window.dispatchEvent(new CustomEvent('playbackStateChange', { detail: { grid: c } }));
  }

  // A -> B Sync
  if (isSync && c === gridA && gridB) {
    const isDual = document.getElementById('dualModeBtn')?.classList.contains('active');
    if (isDual) {
      stop(gridB, false);
      start(gridB, false);
      if (TransportRegistry) TransportRegistry.updateAll(gridB);
    }
  }
}

export function getPlaybackPosition(ctx) {
  const c = ctx || activeGrid;
  if (!c.playing || !audioCtx || typeof c.audioStartTime === 'undefined') {
    return { step: c.step || 0, fraction: 0 };
  }

  const now = audioCtx.currentTime;
  const beatDuration = intervalMs(c) / 1000;

  // Apply latency compensation (moves visuals ahead of audio engine)
  const adjustedNow = now + (VISUAL_HEADSTART || 0);

  // Calculate total steps since playback start
  const totalSteps = (adjustedNow - c.audioStartTime) / beatDuration;

  // Return the continuous step index (including loops)
  const step = Math.floor(totalSteps);
  const fraction = totalSteps - step;
  const loopOffset = (c.loopCount || 0) * c.cells.length;

  return {
    step: step + loopOffset,
    fraction: fraction
  };
}

export function stop(ctx, isSync = true) {
  turnOffMic();
  hideCountdown();

  const c = ctx || activeGrid;

  c.playing = false;
  c.outputLatency = undefined;
  if (c.timerID) cancelAnimationFrame(c.timerID);
  c.timerID = null;
  visualQueue.length = 0;

  c.step = 0;
  c.transcriptionIndex = 0;

  c.cells.forEach(cell => {
    cell.classList.remove('play');
    cell.style.animationDelay = '';
    cell.style.transitionDelay = '';
  });
  if (c.id === 'A') {
    window.dispatchEvent(new CustomEvent('playbackStateChange', { detail: { grid: c } }));
  }

  // A -> B Sync
  if (isSync && c === gridA && gridB) {
    stop(gridB, false);
    if (TransportRegistry) TransportRegistry.updateAll(gridB);
  }
}

export function restartIfPlaying(ctx) {
  const c = ctx || activeGrid;
  if (c.playing) {
    stop(c, true); // keep sync when restarting A
    start(c, true);
  }
}

export function getAudioCtx() { return audioCtx; }

// ===== INITIALIZATION =====
export function initNotePlayer() {
  // Attach beats / subdivision listeners
  const tsBeatsEl = document.getElementById('tsBeats');
  const tsSubEl = document.getElementById('tsSub');

  tsBeatsEl?.addEventListener('change', () => {
    if (HistoryManager) HistoryManager.pushState();
    setBeats(parseInt(tsBeatsEl.value) || 4);
  });
  tsSubEl?.addEventListener('change', () => {
    if (HistoryManager) HistoryManager.pushState();
    setSubdivision(parseInt(tsSubEl.value) || 2);
  });

  // Attempt to unlock audio on ANY user interaction (Click, Key, Touch)
  const unlockEvents = ['click', 'keydown', 'touchstart'];
  function unlockHandler() {
    unlockAudio();
    unlockEvents.forEach(evt => document.removeEventListener(evt, unlockHandler));
  }
  unlockEvents.forEach(evt => document.addEventListener(evt, unlockHandler, { once: true }));
}