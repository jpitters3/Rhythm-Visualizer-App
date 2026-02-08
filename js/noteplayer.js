/* ==== Audio and musical functionality including scales ==== */
import { activeGrid, gridA, gridB } from './grid-context.js';
import { setTimeSignatureState } from './rhythm-core.js';
import { supabase } from './supabase-client.js';

/* Scale Selector */

export const SCALES = {
  "D Kurd": {
    ding: "D3",
    map: { "1": "A3", "2": "Bb3", "3": "C4", "4": "D4", "5": "E4", "6": "F4", "7": "G4", "8": "A4" }
  },
  "D Major": {
    ding: "D3",
    map: { "1": "G3", "2": "A3", "3": "B3", "4": "Cs4", "5": "D4", "6": "E4", "7": "Fs4", "8": "A4" }
  },
  "D Amara": {
    ding: "D3",
    map: { "1": "A3", "2": "C4", "3": "D4", "4": "E4", "5": "F4", "6": "G4", "7": "A4", "8": "C5" }
  },
  "B Celtic": {
    ding: "B3",
    map: { "1": "Fs3", "2": "A3", "3": "B3", "4": "Cs4", "5": "D4", "6": "E4", "7": "Fs4", "8": "B4" }
  }
};

const SOUND_TAK = 'Tak';
const SOUND_SLAP = 'Slap';

const SCALE_KEY_LOCAL = 'groovepan_scale';            // for non-logged-in users
const SCALE_KEY_REMOTE = 'handpan_scale';             // for logged-in users in Supabase profile

// State Management
let selectedScaleName = null;
let highlighterFn = null;
let tickObservers = [];

export function getSelectedScaleName() { return selectedScaleName; }
export function setSelectedScaleName(n) { selectedScaleName = n; }
export function registerHighlighter(fn) { highlighterFn = fn; }
export function addTickObserver(fn) { tickObservers.push(fn); }


// UNIFIED SCALE STATE
let currentScale = {
  ding: "D3",
  map: { "1": "A3", "2": "Bb3", "3": "C4", "4": "D4", "5": "E4", "6": "F4", "7": "G4", "8": "A4" }
};

const scaleSelect = document.getElementById('scaleSelect');
const scaleStatus = document.getElementById('scaleStatus');

let countdownRemaining = 0;
const COUNTDOWN_LENGTH = 4; // 4 steps

function buildScaleSelect() {
  if (!scaleSelect) return;
  scaleSelect.innerHTML = '';
  for (const name of Object.keys(SCALES)) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    scaleSelect.appendChild(opt);
  }
}

// Call init logic if element exists (can be moved to init function)
buildScaleSelect();

export function setCurrentScale(scaleObj) {
  if (!scaleObj) return;
  currentScale = scaleObj;
}

export function getScale() {
  return currentScale;
}

export function noteForLabel(label) {
  // 1. Common Sounds
  if (label === 'T') return SOUND_TAK;
  if (label === 'S') return SOUND_SLAP;

  // 2. Look up in current scale (Unified)
  if (label === 'D') return `${currentScale.ding}_ding`;

  // Return Pitch if found in map (e.g. "1" -> "A3")
  if (currentScale.map[label]) return currentScale.map[label];

  // 3. Absolute Pitch Fallback (for MIDI songs)
  if (label.match(/^[A-G][#b]?[0-9]$/)) {
    return label;
  }

  return null;
}

function noteToFile(note) {
  // "C#3" -> "Cs3.wav", "F#3" -> "Fs3.wav", "Bb3" -> "Bb3.wav"
  if (!note) return '';
  return note.replace('#', 's') + '.wav';
}

/* ==== Save and load scales locally and in db ==== */

export function saveScaleLocal(name) {
  localStorage.setItem(SCALE_KEY_LOCAL, name);
}
export function loadScaleLocal() {
  return localStorage.getItem(SCALE_KEY_LOCAL);
}

export async function saveScaleRemote(name) {
  if (typeof window.currentUser === 'undefined' || !window.currentUser) return;
  if (!supabase) return;

  await supabase.from('profiles').upsert(
    { user_id: window.currentUser.id, handpan_scale: name },
    { onConflict: 'user_id' }
  );
}

export async function loadScaleRemote() {
  if (typeof window.currentUser === 'undefined' || !window.currentUser) return null;
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('handpan_scale')
    .eq('user_id', window.currentUser.id)
    .maybeSingle();
  if (error) return null;
  return data?.handpan_scale || null;
}


/* Player Functionality */

// Metronome
let audioCtx = null;
let audioUnlocked = false;
let samplesPreloaded = false;

// const AUDIO_DELAY = 0.3; // 300ms delay to sync audio with visual pulse expansion

export function unlockAudio() {
  audioUnlocked = true;
  ensureAudio();
  preloadAudioSamples();
}

// ===== HANDPAN SAMPLE BUFFERS =====
const samples = {};

export function intervalMs(ctx) {
  const c = ctx || activeGrid;
  const bpm = c.bpm;
  const base = (c.mode === '16') ? 16 : 8;
  return (60000 / bpm) / (base / 4);
}

export function ensureAudio() {
  // Don’t create/resume AudioContext until a real user gesture has happened
  if (!audioUnlocked) return;

  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) audioCtx = new Ctx();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => { });
  }
}

// Preload note samples once audio is unlocked
export async function preloadScaleSamples() {
  const s = getScale();
  const notes = new Set([(s.ding || 'D3') + '_ding', ...Object.values(s.map)]);
  for (const n of notes) {
    let note = noteToFile(n); // includes .wav extension
    try { await loadSample(n, `./assets/audio/${note}`); }
    catch (e) {
      // console.log(`Error loading sample [${note}]: ${e}`); 
    }
  }
}

// Preload all audio samples
function preloadAudioSamples() {
  if (!samplesPreloaded && audioCtx) {
    samplesPreloaded = true;
    loadSample(SOUND_TAK, './assets/audio/dkurd_tak.wav');
    loadSample(SOUND_SLAP, './assets/audio/dkurd_slap.wav');
    preloadScaleSamples();
  }
}
async function loadSample(key, url) {
  ensureAudio();
  if (!audioCtx) return;

  const res = await fetch(url);
  const arrayBuffer = await res.arrayBuffer();
  samples[key] = await audioCtx.decodeAudioData(arrayBuffer);
}

function metroClick(kind, delay = 0) {
  ensureAudio();
  if (!audioCtx) return;

  const t = audioCtx.currentTime + (delay || 0);
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = 'square';
  const freq = (kind === 'downbeat') ? 1600 : (kind === 'beat' ? 1300 : 1000);
  const level = (kind === 'downbeat') ? 0.28 : (kind === 'beat' ? 0.20 : 0.12);

  osc.frequency.setValueAtTime(freq, t);

  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(level, t + 0.001);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);

  osc.connect(gain);
  gain.connect(audioCtx.destination);

  osc.start(t);
  osc.stop(t + 0.04);
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
    text.style.animation = 'none';
    void text.offsetWidth;
    text.style.animation = null;
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

export function tick(ctx) {
  const c = ctx || activeGrid;
  if (!c.playing || c.isMuted) return;

  const currentData = c.innerLabels[c.step];
  const currentHandsData = c.innerHands[c.step];
  const stepNotes = [];
  const stepHands = [];

  const AUDIO_DELAY = 0.05;

  // CALIBRATION COUNTDOWN LOGIC //

  if (countdownRemaining > 0) {
    showCountdown(countdownRemaining);
    if (c.metronomeOn) metroClick(getMetroClickKind('beat', c), AUDIO_DELAY);
    countdownRemaining--;
    return;
  }

  if (document.getElementById('countdownOverlay').style.display !== 'none') {
    hideCountdown();
  }

  // Only highlight handpan for Grid A
  const shouldHighlight = (c.id === 'A');

  // Play and Highlight Multiple Notes
  // Dynamic check or assume array
  if (Array.isArray(currentData)) {
    currentData.forEach((label, subIdx) => {
      if (label) {
        // Resolve hand first
        const hand = resolveHand(c.step, currentHandsData, subIdx, true, c.mode);

        playNoteByLabel(label, c.step, AUDIO_DELAY);
        if (shouldHighlight) {
          if (typeof highlighterFn === 'function') {
            highlighterFn(label, c.step, hand);
          }
        }
        stepNotes.push(label);
        stepHands.push(hand);
      }
    });
  } else if (currentData) {
    // Resolve hand first
    const hand = resolveHand(c.step, currentHandsData, 0, false, c.mode);

    playNoteByLabel(currentData, c.step, AUDIO_DELAY);
    if (shouldHighlight) {
      if (typeof highlighterFn === 'function') {
        highlighterFn(currentData, c.step, hand); // Pass resolved hand
      }
    }
    stepNotes.push(currentData);
    stepHands.push(hand);
  }

  // Notify Observers (e.g. Virtual Hands)
  if (tickObservers.length > 0) {
    tickObservers.forEach(fn => fn(c, stepNotes, stepHands));
  }

  // Update Visuals (Play Class)
  try {
    c.cells.forEach(el => el.classList.remove('play'));
    const cell = c.cells[c.step];
    if (cell) cell.classList.add('play');
  } catch (e) { /* ignore reflow issues */ }

  // Metronome click
  if (c.metronomeOn) {
    metroClick(getMetroClickKind(c), AUDIO_DELAY);
  }

  // Since transcription happens after tick(), 
  // we need to use the index before we increment 'step'
  if (c.id === 'A') {
    window.transcriptionIndex = c.step;
    // Update Presentation View if active
    if (typeof window.updatePresentationView === 'function') {
      window.updatePresentationView(c.step, c);
    }
  }

  c.step = (c.step + 1) % c.cells.length;
}

function getMetroClickKind(ctx) {
  const c = ctx || activeGrid;
  const beatStride = (c.mode === '8') ? 2 : 4;
  const isQuarter = (c.step % beatStride === 0);
  const isDownbeat = (c.step === 0);
  return isDownbeat ? 'downbeat' : (isQuarter ? 'beat' : 'sub');
}

export function playNoteByLabel(label, step, delay = 0) {
  const note = noteForLabel(label); // e.g. "C#", "D3_ding"
  if (note) { playNoteSample(note, delay); }
}

const tsNumInput = document.getElementById('tsNum');
const tsDenInput = document.getElementById('tsDen');

export function updateTimeSignatureFromInputs() {
  if (window.HistoryManager) window.HistoryManager.pushState();
  if (!tsNumInput || !tsDenInput) return;
  const num = Math.max(1, parseInt(tsNumInput.value) || 4);
  const den = Math.max(1, parseInt(tsDenInput.value) || 4);
  const ts = `${num}/${den}`;
  setTimeSignature(ts);
}

tsNumInput?.addEventListener('change', updateTimeSignatureFromInputs);
tsDenInput?.addEventListener('change', updateTimeSignatureFromInputs);

export function setTimeSignature(ts) {
  if (!ts) return;
  if (!ts.includes('/')) return;

  // 1. Update Core State
  setTimeSignatureState(ts);

  // 2. Update UI Inputs
  const [num, den] = ts.split('/');
  if (tsNumInput) tsNumInput.value = num;
  if (tsDenInput) tsDenInput.value = den;

  // 3. Re-render Grids
  import('./notegrid.js').then(({ renderAllMeasures }) => {
    renderAllMeasures(gridA);
    if (gridB) renderAllMeasures(gridB);
  });
}

export function setMode(nextMode, ctx) {
  const c = ctx || activeGrid;
  if (nextMode === c.mode) return;
  const wasPlaying = c.playing;
  if (wasPlaying) stop(c);

  c.mode = nextMode;

  if (c.id === 'A') {
    if (typeof gridBtn !== 'undefined' && gridBtn) {
      gridBtn.textContent = (nextMode === '8') ? '8ths' : '16ths';
    }
  }

  import('./notegrid.js').then(({ renderAllMeasures }) => {
    renderAllMeasures(c);
  });

  if (wasPlaying) start(c);
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
  const t = audioCtx.currentTime;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(1.0, t + 0.005);

  // Tiny fade out (prevents click)
  const dur = src.buffer.duration;
  gain.gain.setValueAtTime(1.0, t + Math.max(0, dur - 0.02));
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

  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.20, t + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);

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

  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  src.connect(audioCtx.destination);
  src.start(audioCtx.currentTime + delay);
}


export function start(ctx, isSync = true) {
  const c = ctx || activeGrid;
  unlockAudio();
  if (c.playing || c.timers.length) return;

  if (typeof window.isListening !== 'undefined' && window.isListening) {
    countdownRemaining = COUNTDOWN_LENGTH;
  } else {
    countdownRemaining = 0;
  }

  ensureAudio();

  if (c.caretIndex !== null && c.caretIndex >= 0) {
    c.step = c.caretIndex;
  }

  tick(c);
  const id = setInterval(() => tick(c), intervalMs(c));
  c.timers.push(id);

  c.playing = true;
  if (c.playBtn) {
    c.playBtn.textContent = '⏹';
    c.playBtn.classList.add('active');
    c.playBtn.classList.add('playing');
  }

  // A -> B Sync
  if (isSync && c === gridA && gridB) {
    const isDual = document.getElementById('dualModeBtn')?.classList.contains('active');
    if (isDual) {
      stop(gridB, false);
      start(gridB, false);
      if (window.TransportRegistry) window.TransportRegistry.updateAll(gridB);
    }
  }
}

export function stop(ctx, isSync = true) {
  const c = ctx || activeGrid;
  for (const id of c.timers) clearInterval(id);
  c.timers = [];

  c.playing = false;
  c.step = 0;
  if (c.playBtn) {
    c.playBtn.textContent = '►';
    c.playBtn.classList.remove('active');
    c.playBtn.classList.remove('playing');
  }
  c.cells.forEach(cell => cell.classList.remove('play'));
  if (c.id === 'A' && typeof window.syncVirtualHandpanControls === 'function') {
    window.syncVirtualHandpanControls();
  }

  // A -> B Sync
  if (isSync && c === gridA && gridB) {
    stop(gridB, false);
    if (window.TransportRegistry) window.TransportRegistry.updateAll(gridB);
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