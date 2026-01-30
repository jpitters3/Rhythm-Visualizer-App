/* ==== Audio and musical functionality including scales ==== */


/* Scale Selector */

const SCALES = {
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

window.SCALES = SCALES;

const SOUND_TAK = 'Tak';
const SOUND_SLAP = 'Slap';

const SCALE_KEY_LOCAL = 'groovepan_scale';            // for non-logged-in users
const SCALE_KEY_REMOTE = 'handpan_scale';             // for logged-in users in Supabase profile
let selectedScaleName = null;

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

buildScaleSelect();

function setCurrentScale(scaleObj) {
  if (!scaleObj) return;
  currentScale = scaleObj;
}

function getScale() {
  return currentScale;
}

function noteForLabel(label) {
  // 1. Common Sounds
  if (label === 'T') return SOUND_TAK;
  if (label === 'S') return SOUND_SLAP;

  // 2. Look up in current scale (Unified)
  if (label === 'D') return `${currentScale.ding}_ding`;

  // Return Pitch if found in map (e.g. "1" -> "A3")
  if (currentScale.map[label]) return currentScale.map[label];

  // 3. Absolute Pitch Fallback (for MIDI songs)
  // If label looks like "C#4", "Bb3" etc. return it as the note name.
  // Regex: [A-G] followed by optional [#s] (we use 's' internally but label might be #), then digit
  // Our system expects "Cs4" for file loading, but here we return the 'Note Name' which noteToFile converts.
  // Actually, noteToFile handles 'C#4' -> 'Cs4.wav'. So we just need to pass it through.
  if (label.match(/^[A-G][#b]?[0-9]$/)) {
    return label;
  }

  return null;
}

function noteToFile(note) {
  // "C#3" -> "Cs3.wav", "F#3" -> "Fs3.wav", "Bb3" -> "Bb3.wav"
  // TODO Map flats/sharps here
  if (!note) return '';
  return note.replace('#', 's') + '.wav';
}

// Expose
window.setCurrentScale = setCurrentScale;
window.getScale = getScale;

/* ==== Save and load scales locally and in db ==== */

function saveScaleLocal(name) {
  localStorage.setItem(SCALE_KEY_LOCAL, name);
}
function loadScaleLocal() {
  return localStorage.getItem(SCALE_KEY_LOCAL);
}

async function saveScaleRemote(name) {
  if (!currentUser) return;
  await supabase1.from('profiles').upsert(
    { user_id: currentUser.id, handpan_scale: name },
    { onConflict: 'user_id' }
  );
}

async function loadScaleRemote() {
  if (!currentUser) return null;
  const { data, error } = await supabase1
    .from('profiles')
    .select('handpan_scale')
    .eq('user_id', currentUser.id)
    .maybeSingle();
  if (error) return null;
  return data?.handpan_scale || null;
}

// Expose persistence
window.saveScaleLocal = saveScaleLocal;
window.loadScaleLocal = loadScaleLocal;
window.saveScaleRemote = saveScaleRemote;
window.loadScaleRemote = loadScaleRemote;


/* Player Functionality */

let step = 0;
let transcriptionIndex = 0;

// Use an array of timers to prevent accidental stacking (double-clicks, race conditions)
let timers = [];
let playing = false;

// Metronome
let metronomeOn = false;
let audioCtx = null;

let audioUnlocked = false;
let samplesPreloaded = false;

const AUDIO_DELAY = 0.3; // 300ms delay to sync audio with visual pulse expansion

function unlockAudio() {
  audioUnlocked = true;
  ensureAudio();
  preloadAudioSamples();
}

// ===== HANDPAN SAMPLE BUFFERS =====
const samples = {};

function intervalMs(ctx = window.activeGrid) {
  const bpm = ctx.bpm;
  const base = (ctx.mode === '16') ? 16 : 8;
  return (60000 / bpm) / (base / 4);
}

function ensureAudio() {
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
async function preloadScaleSamples() {
  const s = getScale();
  const notes = new Set([(s.ding || 'D3') + '_ding', ...Object.values(s.map)]);
  for (const n of notes) {
    let note = noteToFile(n); // includes .wav extension
    try { await loadSample(n, `./assets/audio/${note}`); }
    catch (e) { console.log(`Error loading sample [${note}]: ${e}`); }
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

function isDownbeatStep(stepIndex, mode) {
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

    // THE REFLOW TRICK:
    // 1. Remove the animation
    text.style.animation = 'none';

    // 2. Trigger a reflow (this is the magic bit)
    void text.offsetWidth;

    // 3. Re-apply the animation
    text.style.animation = null;
  }
}

function hideCountdown() {
  const overlay = document.getElementById('countdownOverlay');
  if (overlay) overlay.style.display = 'none';
}

function tick(ctx = window.activeGrid) {
  if (!ctx.playing || ctx.isMuted) return;

  const all = ctx.cells;
  const currentData = ctx.innerLabels[ctx.step];
  const currentHandsData = ctx.innerHands[ctx.step];
  const stepNotes = [];
  const stepHands = [];

  const AUDIO_DELAY = 0.05;

  // Helper for Sticking Logic
  function resolveHand(stepIdx, handData, subIdx = 0, isChord = false) {
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
    // If it's a chord (array), we follow the convention:
    // Index 0, 1 -> Left Hand
    // Index 2, 3 -> Right Hand
    if (isChord) {
      return (subIdx <= 1) ? 'L' : 'R';
    }

    // 3. Default Time-Based Logic (for single notes)
    return isDownbeatStep(stepIdx, ctx.mode) ? 'R' : 'L';
  }

  // CALIBRATION COUNTDOWN LOGIC //

  if (countdownRemaining > 0) {
    // Show the CURRENT number (4, 3, 2, 1)
    showCountdown(countdownRemaining);

    // Play metronome click (Low pitch for count-in)
    if (ctx.metronomeOn) metroClick(getMetroClickKind('beat', ctx), AUDIO_DELAY);

    // Decrement for the NEXT tick
    countdownRemaining--;

    // If we just finished 1, the next tick will be the actual start
    return;
  }

  if (document.getElementById('countdownOverlay').style.display !== 'none') {
    hideCountdown();
  }

  // PLAY & HIGHLIGHT SUB-DOTS or SINGLE-NOTE //

  // Play and Highlight Multiple Notes
  if (window.checkCellIsMultiMode(currentData)) {
    currentData.forEach((label, subIdx) => {
      if (label) {
        // Resolve hand first
        const hand = resolveHand(ctx.step, currentHandsData, subIdx, true);

        playNoteByLabel(label, ctx.step, AUDIO_DELAY);
        highlightHandpan(label, ctx.step, hand); // Pass resolved hand
        stepNotes.push(label);
        stepHands.push(hand);
      }
    });
  } else if (currentData) {
    // Resolve hand first
    const hand = resolveHand(ctx.step, currentHandsData, 0, false);

    playNoteByLabel(currentData, ctx.step, AUDIO_DELAY);
    highlightHandpan(currentData, ctx.step, hand); // Pass resolved hand
    stepNotes.push(currentData);
    stepHands.push(hand);
  }

  // --- LOOKAHEAD FOR VIRTUAL HANDS ---
  let nextL = null;
  let nextR = null;

  if (window.virtualHands && window.virtualHands.enabled) {
    // Limit lookahead to ~2 beats (8 sub-steps) to prevent moving too early
    const maxLookahead = 8;
    const totalSteps = all.length;

    for (let i = 1; i <= maxLookahead; i++) {
      if (nextL && nextR) break;

      const futureStep = (ctx.step + i) % totalSteps;
      const futureData = ctx.innerLabels[futureStep];
      const futureHands = ctx.innerHands[futureStep];

      if (!futureData) continue;

      const labels = Array.isArray(futureData) ? futureData : [futureData];
      const isChord = window.checkCellIsMultiMode(futureData);

      labels.forEach((lbl, sIdx) => {
        if (!lbl) return;
        const h = resolveHand(futureStep, futureHands, sIdx, isChord);
        if (h === 'L' && !nextL) nextL = lbl;
        if (h === 'R' && !nextR) nextR = lbl;
      });
    }
  }

  // Update Visual Hands
  if (window.virtualHands) {
    virtualHands.update(stepNotes, stepHands, nextL, nextR);
  }

  // Remove styles of previously played steps
  all.forEach(c => c.classList.remove('play'));

  // Add style to current steps
  const cell = all[ctx.step];
  if (cell !== undefined) cell.classList.add('play');

  // Metronome click
  if (ctx.metronomeOn) {
    metroClick(getMetroClickKind(ctx), AUDIO_DELAY);
  }

  // Since transcription happens after tick(), 
  // we need to use the index before we increment 'step'
  if (ctx.id === 'A') {
    window.transcriptionIndex = ctx.step;
    // Update Presentation View if active
    if (typeof updatePresentationView === 'function') {
      updatePresentationView(ctx.step, ctx);
    }
  }

  ctx.step = (ctx.step + 1) % all.length;
}

function getMetroClickKind(ctx = window.activeGrid) {
  const beatStride = (ctx.mode === '8') ? 2 : 4;
  const isQuarter = (ctx.step % beatStride === 0);
  const isDownbeat = (ctx.step === 0);
  return isDownbeat ? 'downbeat' : (isQuarter ? 'beat' : 'sub');
}

function playNoteByLabel(label, step, delay = 0) {
  const note = noteForLabel(label); // e.g. "C#", "D3_ding"
  if (note) { playNoteSample(note, delay); }

}

let timeSignature = localStorage.getItem('defaultTimeSignature') || '4/4';

const tsNumInput = document.getElementById('tsNum');
const tsDenInput = document.getElementById('tsDen');

function updateTimeSignatureFromInputs() {
  if (window.HistoryManager) window.HistoryManager.pushState();
  if (!tsNumInput || !tsDenInput) return;
  const num = Math.max(1, parseInt(tsNumInput.value) || 4);
  const den = Math.max(1, parseInt(tsDenInput.value) || 4);
  const ts = `${num}/${den}`;
  setTimeSignature(ts);
}

tsNumInput?.addEventListener('change', updateTimeSignatureFromInputs);
tsDenInput?.addEventListener('change', updateTimeSignatureFromInputs);

function calculateSteps(ts, currentMode) {
  const parts = ts.split('/');
  const num = parseInt(parts[0]);
  const den = parseInt(parts[1]);

  const base = (currentMode === '16') ? 16 : 8;
  const mult = base / den;
  return num * mult;
}

function setTimeSignature(ts) {
  if (!ts) return;
  if (!ts.includes('/')) return;

  timeSignature = ts;
  localStorage.setItem('defaultTimeSignature', ts);

  const [n, d] = ts.split('/');
  if (tsNumInput && tsNumInput.value != n) tsNumInput.value = n;
  if (tsDenInput && tsDenInput.value != d) tsDenInput.value = d;

  // Update global STEPS for backward compatibility (matches Grid A)
  window.STEPS = calculateSteps(timeSignature, window.gridA.mode);

  // Update both grids
  renderAllMeasures(window.gridA);
  renderAllMeasures(window.gridB);

  restartIfPlaying(window.gridA);
  restartIfPlaying(window.gridB);
}

// Expose for other modules
window.setTimeSignature = setTimeSignature;
window.getTimeSignature = () => timeSignature;

// Initialize
if (timeSignature) setTimeSignature(timeSignature);

function setMode(nextMode, ctx = window.activeGrid) {
  if (nextMode === ctx.mode) return;
  const wasPlaying = ctx.playing;
  if (wasPlaying) stop(ctx);

  ctx.mode = nextMode;

  // Sync global mode and STEPS if Grid A is updated (for backward compatibility)
  if (ctx.id === 'A') {
    window.mode = nextMode;
    window.STEPS = calculateSteps(timeSignature, nextMode);
    if (typeof gridBtn !== 'undefined' && gridBtn) {
      gridBtn.textContent = (nextMode === '8') ? '8ths' : '16ths';
    }
  }

  renderAllMeasures(ctx);

  if (wasPlaying) start(ctx);
}


// ==== PLAY HANDPAN SOUNDS ====
function playSample(key) {
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

function playTone() {
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

function playSlap() {
  ensureAudio();
  if (!audioCtx) return;

  const t = audioCtx.currentTime;

  // Noise burst
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

function playHandpanSoundForLabel(label) {
  if (samples[label]) playSample(label);
}

// ===== PLAY NOTES BY PITCH =====
const noteSamples = {};

async function loadNoteSample(n) {
  if (!audioCtx || samples[n]) return;

  try {
    const res = await fetch(`./assets/audio/${n}.wav`);
    const buf = await res.arrayBuffer();
    noteSamples[n] = await audioCtx.decodeAudioData(buf);
  } catch (e) {
    console.warn(`Could not load ${n}.wav`, e);
  }
}

function playNoteSample(n, delay = 0) {
  ensureAudio();
  const buffer = samples[n];
  if (!audioCtx || !buffer) return;

  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  src.connect(audioCtx.destination);
  src.start(audioCtx.currentTime + delay);
}



function start(ctx = window.activeGrid, isSync = true) {
  unlockAudio();
  if (ctx.playing || ctx.timers.length) return;

  if (typeof isListening !== 'undefined' && isListening) {
    countdownRemaining = COUNTDOWN_LENGTH;
  } else {
    countdownRemaining = 0;
  }

  ensureAudio();

  if (ctx.caretIndex !== null && ctx.caretIndex >= 0) {
    ctx.step = ctx.caretIndex;
  }

  tick(ctx);
  const id = setInterval(() => tick(ctx), intervalMs(ctx));
  ctx.timers.push(id);

  ctx.playing = true;
  if (ctx.playBtn) {
    ctx.playBtn.textContent = '⏹';
    ctx.playBtn.classList.add('active');
    ctx.playBtn.classList.add('playing');
  }

  // A -> B Sync
  if (isSync && ctx === window.gridA && window.gridB) {
    const isDual = document.getElementById('dualModeBtn')?.classList.contains('active');
    if (isDual) {
      stop(window.gridB, false);
      start(window.gridB, false);
      if (window.TransportRegistry) window.TransportRegistry.updateAll(window.gridB);
    }
  }
}

function stop(ctx = window.activeGrid, isSync = true) {
  for (const id of ctx.timers) clearInterval(id);
  ctx.timers = [];

  ctx.playing = false;
  ctx.step = 0;
  if (ctx.playBtn) {
    ctx.playBtn.textContent = '►';
    ctx.playBtn.classList.remove('active');
    ctx.playBtn.classList.remove('playing');
  }
  ctx.cells.forEach(c => c.classList.remove('play'));
  if (window.syncVirtualHandpanControls) window.syncVirtualHandpanControls();

  // A -> B Sync
  if (isSync && ctx === window.gridA && window.gridB) {
    stop(window.gridB, false);
    if (window.TransportRegistry) window.TransportRegistry.updateAll(window.gridB);
  }
}

function restartIfPlaying(ctx = window.activeGrid) {
  if (ctx.playing) {
    stop(ctx, true); // keep sync when restarting A
    start(ctx, true);
  }
}