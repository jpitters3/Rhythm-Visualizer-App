// ==== PLAY HANDPAN SOUNDS ====
function playSample(key) {
  if (!handpanSoundsOn) return;
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
    if (!handpanSoundsOn) return;
    if (samples[label]) playSample(label);
}

// ===== PLAY NOTES (BY NUMBER) =====
const numberSamples = {};

async function loadNumberSample(n) {
  if (!audioCtx || numberSamples[n]) return;

  try {
    const res = await fetch(`./assets/audio/${n}.wav`);
    const buf = await res.arrayBuffer();
    numberSamples[n] = await audioCtx.decodeAudioData(buf);
  } catch (e) {
    console.warn(`Could not load ${n}.wav`, e);
  }
}

function playNumberSample(n) {
  ensureAudio();
  const buffer = numberSamples[n];
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