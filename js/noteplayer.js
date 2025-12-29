/* ==== Audio and musical functionality including scales ==== */


/* Scale Selector */

const SCALES = {
  "D Kurd": {
    ding: "D3",
    map: { "1":"A3", "2":"Bb3", "3":"C4", "4":"D4", "5":"E4", "6":"F4", "7":"G4", "8":"A4" }
  },
  "D Major": {
    ding: "D3",
    map: { "1":"G3", "2":"A3", "3":"B3", "4":"Cs4", "5":"D4", "6":"E4", "7":"Fs4", "8":"A4" }
  },
  "D Amara": {
    ding: "D3",
    map: { "1":"A3", "2":"C4", "3":"D4", "4":"E4", "5":"F4", "6":"G4", "7":"A4", "8":"C5" }
  },
  "B Celtic": {
    ding: "B3",
    map: { "1":"Fs3", "2":"A3", "3":"B3", "4":"Cs4", "5":"D4", "6":"E4", "7":"Fs4", "8":"B4" }
  }
};

const SOUND_TAK = 'Tak';
const SOUND_SLAP = 'Slap';

const SCALE_KEY_LOCAL = 'groovepan_scale';            // for non-logged-in users
const SCALE_KEY_REMOTE = 'handpan_scale';             // for logged-in users in Supabase profile
let selectedScaleName = null;

const scaleSelect = document.getElementById('scaleSelect');
const scaleStatus = document.getElementById('scaleStatus');

function buildScaleSelect(){
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

function getScale(){
  return SCALES[selectedScaleName] || SCALES[Object.keys(SCALES)[0]];
}

function noteForLabel(label){
  const s = getScale();
  if (label === 'D') return `${s.ding}_ding`;     // ding note name like "D3"
  else if (label === 'T') return SOUND_TAK;
  else if (label === 'S') return SOUND_SLAP;
  if (/^[1-8]$/.test(label)) return s.map[label]; // e.g. "Cs3"
  return null; // ghosts notes
}

function noteToFile(note){
  // "C#3" -> "Cs3.wav", "F#3" -> "Fs3.wav", "Bb3" -> "Bb3.wav"
  // TODO Map flats to sharps here
  return note.replace('#','s') + '.wav';
}

/* ==== Save and load scales locally and in db ==== */

function saveScaleLocal(name){
  localStorage.setItem(SCALE_KEY_LOCAL, name);
}
function loadScaleLocal(){
  return localStorage.getItem(SCALE_KEY_LOCAL);
}

async function saveScaleRemote(name){
  if (!currentUser) return;
  await supabase1.from('profiles').upsert(
    { user_id: currentUser.id, handpan_scale: name },
    { onConflict: 'user_id' }
  );
}

async function loadScaleRemote(){
  if (!currentUser) return null;
  const { data, error } = await supabase1
    .from('profiles')
    .select('handpan_scale')
    .eq('user_id', currentUser.id)
    .maybeSingle();
  if (error) return null;
  return data?.handpan_scale || null;
}


/* Player Functionality */

let step = 0;

// Use an array of timers to prevent accidental stacking (double-clicks, race conditions)
let timers = [];
let playing = false;

// Metronome
let metronomeOn = false;
let audioCtx = null;

let audioUnlocked = false;
let samplesPreloaded = false;

function unlockAudio() {
  audioUnlocked = true;
  ensureAudio();
  preloadAudioSamples();
}

// ===== HANDPAN SAMPLE BUFFERS =====
const samples = {};

function intervalMs() {
  const perBeat = (mode === '8') ? 2 : 4;
  return (60 / Number(bpmInput.value)) * 1000 / perBeat;
}

function ensureAudio() {
  // Don’t create/resume AudioContext until a real user gesture has happened
  if (!audioUnlocked) return;

  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) audioCtx = new Ctx();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
}

// Preload note samples once audio is unlocked
async function preloadScaleSamples(){
  const s = getScale();
  const notes = new Set([s.ding+'_ding', ...Object.values(s.map)]);
  for (const n of notes) {
    let note = noteToFile(n); // includes .wav extension
    await loadSample(n, `./assets/audio/${note}`);
  }
}

// Preload all audio samples
function preloadAudioSamples()
{
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

function metroClick(kind) {
  ensureAudio();
  if (!audioCtx) return;

  const t = audioCtx.currentTime;
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

function isDownbeatStep(stepIndex){
  if (mode === '8') return stepIndex % 2 === 0;     // 1,2,3,4
  return stepIndex % 4 === 0;                       // 1,2,3,4 on 16ths
}

function tick() {
  const all = cells();
  if (!all.length) return;

  all.forEach(c => c.classList.remove('play'));
  const cell = all[step];
  cell.classList.add('play');

  if (metronomeOn) {
    const beatStride = (mode === '8') ? 2 : 4;
    const isQuarter = (step % beatStride === 0);
    const isDownbeat = (step === 0);
    metroClick(isDownbeat ? 'downbeat' : (isQuarter ? 'beat' : 'sub'));
  }

  // Play the sound that corresponds to the beat label
  const label = innerLabels[step];
  playNoteByLabel(label, step);
  
  highlightHandpan(label, step);
  
  const totalSteps = measures * STEPS;
  step = (step + 1) % totalSteps;
}

function playNoteByLabel(label, step)
{
  const note = noteForLabel(label); // e.g. "C#", "D3_ding"
  if (note) { playNoteSample(note); }
}
function setMode(nextMode) {
  measures = 1;
  
  if (nextMode === mode) return;
  const wasPlaying = playing;
  if (wasPlaying) stop();

  mode = nextMode;
  STEPS = (mode === '8') ? 8 : 16;
  gridBtn.textContent = (mode === '8') ? '8ths' : '16ths';

  buildGrid();

  if (wasPlaying) start();
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

function playNoteSample(n) {
  ensureAudio();
  const buffer = samples[n];
  if (!audioCtx || !buffer) return;

  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  src.connect(audioCtx.destination);
  src.start();
}

function start() {
  // Unlock audio
  unlockAudio();
  
  // Guard: never allow multiple intervals to stack (can freeze the tab)
  if (playing || timers.length) return;

  ensureAudio();
  const id = setInterval(tick, intervalMs());
  timers.push(id);

  playing = true;
  playBtn.textContent = 'Stop';
  playBtn.classList.add('active');
}

function stop() {
  // Clear ALL timers (in case stacking ever happened)
  for (const id of timers) clearInterval(id);
  timers = [];

  playing = false;
  step = 0;
  playBtn.textContent = 'Play';
  playBtn.classList.remove('active');
  cells().forEach(c => c.classList.remove('play'));
}

function restartIfPlaying() {
  if (playing) {
    // Stop clears all timers; start guard prevents stacking
    stop();
    start();
  }
}