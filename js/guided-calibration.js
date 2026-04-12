// guided-calibration.js
// Guides the user through mapping their handpan notes via mic pitch detection + tap-to-place.
// Called for new handpans immediately after the image is uploaded.

import { supabase } from './supabase-client.js';

// ── State ──────────────────────────────────────────────────────────────────────
let handpanData    = null;
let onComplete     = null;
let placedNotes    = [];   // [{ freq, note, octave, x, y, isDing }]
let currentDetected = null;
let isListeningForDing = true;

// Audio
let micStream     = null;
let audioCtx      = null;
let analyser      = null;
let rafId         = null;

// Detection stability
let stableKey   = null;
let stableStart = null;
const STABLE_MS = 1200; // ms of same note before confirming

// DOM refs
let overlay, imageEl, dotsLayer, statusEl, pitchEl, actionsEl, imageWrap;

// ── Public API ─────────────────────────────────────────────────────────────────

export function startGuidedCalibration(data, onCompleteCallback) {
  handpanData   = data;
  onComplete    = onCompleteCallback;
  placedNotes   = [];
  isListeningForDing = true;
  currentDetected    = null;

  grabDOM();
  imageEl.src = data.top_image_url;
  overlay.style.display = 'flex';
  overlay.setAttribute('aria-hidden', 'false');

  showWelcome();
}

// ── DOM ────────────────────────────────────────────────────────────────────────

function grabDOM() {
  overlay    = document.getElementById('guidedCalOverlay');
  imageEl    = document.getElementById('guidedCalImage');
  dotsLayer  = document.getElementById('guidedCalDotsLayer');
  statusEl   = document.getElementById('guidedCalStatus');
  pitchEl    = document.getElementById('guidedCalPitchDisplay');
  actionsEl  = document.getElementById('guidedCalActions');
  imageWrap  = document.getElementById('guidedCalImageWrap');
}

function closeOverlay() {
  stopMic();
  overlay.style.display = 'none';
  overlay.setAttribute('aria-hidden', 'true');
  dotsLayer.innerHTML = '';
  stableKey = null;
  stableStart = null;
}

// ── Screens ────────────────────────────────────────────────────────────────────

function showWelcome() {
  setStatus(
    `<h2>Let's map your handpan! 🎵</h2>
     <p>We'll listen to each note you play and place it right on your instrument.<br>It only takes a minute — let's do this!</p>`
  );
  pitchEl.innerHTML = '';
  setActions(`<button class="gcal-btn-primary" id="gcalStartBtn">Let's go! →</button>`);
  document.getElementById('gcalStartBtn').addEventListener('click', async () => {
    const ok = await startMic();
    if (ok) promptDing();
  });
}

function promptDing() {
  isListeningForDing = true;
  setStatus(
    `<h2>Play your Ding 🎶</h2>
     <p>This is the big center note — the deepest, richest note on your handpan.</p>`
  );
  pitchEl.innerHTML = `<span class="gcal-listening">Listening…</span>`;
  setActions('');
  startDetection();
}

function promptNextNote() {
  const count = placedNotes.filter(n => !n.isDing).length;
  setStatus(
    `<h2>Play another note ✨</h2>
     <p>${count === 0 ? 'Play any other note on your handpan.' : `${count} note${count > 1 ? 's' : ''} added — keep going!`}</p>`
  );
  pitchEl.innerHTML = `<span class="gcal-listening">Listening…</span>`;
  setActions(`<button class="gcal-btn-secondary" id="gcalDoneBtn">All done →</button>`);
  document.getElementById('gcalDoneBtn').addEventListener('click', showSummary);
  startDetection();
}

function onNoteDetected() {
  const { note, octave } = currentDetected;
  const label = isListeningForDing ? 'Ding' : `${note}${octave}`;

  setStatus(
    `<h2>Got it! 🎉</h2>
     <p>Your ${isListeningForDing ? 'Ding' : 'note'} is tuned to <strong>${note}${octave}</strong>.<br>
     Now <strong>tap where it is</strong> on your handpan.</p>`
  );
  pitchEl.innerHTML = `<span class="gcal-note-confirmed">${note}${octave}</span>`;
  setActions(`<button class="gcal-btn-secondary" id="gcalRetryBtn">Try again</button>`);
  document.getElementById('gcalRetryBtn').addEventListener('click', () => {
    if (isListeningForDing) promptDing(); else promptNextNote();
  });

  // Enable tap on image
  imageWrap.classList.add('gcal-tappable');
  imageWrap.addEventListener('pointerup', handleTap, { once: true });
}

function onNotePlaced(x, y) {
  const note = { ...currentDetected, x, y, isDing: isListeningForDing };
  placedNotes.push(note);
  renderDot(note, placedNotes.length - 1);

  imageWrap.classList.remove('gcal-tappable');

  const label = isListeningForDing ? 'Ding' : `${note.note}${note.octave}`;
  setStatus(`<h2>${isListeningForDing ? 'Ding placed! 🥁' : `${label} placed! ✅`}</h2><p>Nice one!</p>`);
  pitchEl.innerHTML = '';
  setActions('');

  setTimeout(() => {
    isListeningForDing = false;
    // Brief cooldown before next detection so the ringing note doesn't re-trigger
    setTimeout(promptNextNote, 400);
  }, 700);
}

function showSummary() {
  stopDetection();

  if (placedNotes.length === 0) {
    setStatus(`<h2>No notes added yet</h2><p>Play at least your Ding before finishing.</p>`);
    setActions(`<button class="gcal-btn-primary" id="gcalBackBtn">← Back</button>`);
    document.getElementById('gcalBackBtn').addEventListener('click', promptDing);
    return;
  }

  // Sort non-Ding notes by frequency and assign numbers
  const ding = placedNotes.find(n => n.isDing);
  const rest = placedNotes.filter(n => !n.isDing).sort((a, b) => a.freq - b.freq);

  const rows = [];
  if (ding) rows.push(`<li><strong>Ding</strong> — ${ding.note}${ding.octave}</li>`);
  rest.forEach((n, i) => rows.push(`<li><strong>${i + 1}</strong> — ${n.note}${n.octave}</li>`));

  setStatus(
    `<h2>Looking great! 🙌</h2>
     <p>Here's what we found:</p>
     <ul class="gcal-note-list">${rows.join('')}</ul>
     <p class="gcal-hint">You can fine-tune positions and sizes after saving.</p>`
  );
  pitchEl.innerHTML = '';
  setActions(`
    <button class="gcal-btn-secondary" id="gcalAddMoreBtn">← Add more</button>
    <button class="gcal-btn-primary" id="gcalSaveBtn">Save &amp; Fine-tune →</button>
  `);
  document.getElementById('gcalAddMoreBtn').addEventListener('click', promptNextNote);
  document.getElementById('gcalSaveBtn').addEventListener('click', () => saveAndFinish(ding, rest));
}

async function saveAndFinish(ding, rest) {
  const noteMap = buildNoteMap(ding, rest);

  const { error } = await supabase
    .from('user_handpans')
    .update({ note_map: noteMap })
    .eq('id', handpanData.id);

  if (error) {
    setStatus(`<h2>Save failed</h2><p>${error.message}</p>`);
    return;
  }

  closeOverlay();
  onComplete?.({ ...handpanData, note_map: noteMap });
}

// ── Tonefield builder ──────────────────────────────────────────────────────────

function buildNoteMap(ding, rest) {
  const noteMap = [];
  const defaultSize = 11; // percent

  if (ding) {
    noteMap.push({
      id:             Date.now(),
      x:              ding.x,
      y:              ding.y,
      width:          defaultSize,
      height:         defaultSize,
      rotation:       0,
      note:           ding.note,
      octave:         ding.octave,
      assignedNumber: 'Ding',
      side:           'top',
    });
  }

  rest.forEach((n, i) => {
    noteMap.push({
      id:             Date.now() + i + 1,
      x:              n.x,
      y:              n.y,
      width:          defaultSize,
      height:         defaultSize,
      rotation:       0,
      note:           n.note,
      octave:         n.octave,
      assignedNumber: String(i + 1),
      side:           'top',
    });
  });

  return noteMap;
}

// ── Tap handling ───────────────────────────────────────────────────────────────

function handleTap(e) {
  e.preventDefault();
  const coords = tapToImagePercent(e, imageEl);
  if (!coords) {
    // Tapped outside image bounds — re-attach listener
    imageWrap.addEventListener('pointerup', handleTap, { once: true });
    return;
  }
  onNotePlaced(coords.x, coords.y);
}

function tapToImagePercent(e, img) {
  const rect = img.getBoundingClientRect();
  const clientX = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
  const clientY = e.changedTouches ? e.changedTouches[0].clientY : e.clientY;
  const tapX = clientX - rect.left;
  const tapY = clientY - rect.top;

  const containerW = rect.width;
  const containerH = rect.height;
  const imgRatio   = img.naturalWidth / img.naturalHeight;
  const conRatio   = containerW / containerH;

  let renderedW, renderedH, offsetX, offsetY;
  if (imgRatio > conRatio) {
    renderedW = containerW;
    renderedH = containerW / imgRatio;
    offsetX   = 0;
    offsetY   = (containerH - renderedH) / 2;
  } else {
    renderedH = containerH;
    renderedW = containerH * imgRatio;
    offsetX   = (containerW - renderedW) / 2;
    offsetY   = 0;
  }

  const x = ((tapX - offsetX) / renderedW) * 100;
  const y = ((tapY - offsetY) / renderedH) * 100;

  if (x < 0 || x > 100 || y < 0 || y > 100) return null;
  return { x, y };
}

// ── Dot rendering ──────────────────────────────────────────────────────────────

function renderDot(note, index) {
  const ding  = note.isDing;
  const label = ding ? 'D' : String(index); // index here is array index, reassigned after sort
  const dot   = document.createElement('div');
  dot.className = `gcal-dot${ding ? ' gcal-dot-ding' : ''}`;
  dot.style.left = `${note.x}%`;
  dot.style.top  = `${note.y}%`;
  dot.textContent = ding ? 'D' : `${note.note}${note.octave}`;
  dotsLayer.appendChild(dot);
}

// ── Pitch detection ────────────────────────────────────────────────────────────

async function startMic() {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    audioCtx  = new AudioContext();
    const source = audioCtx.createMediaStreamSource(micStream);
    analyser  = audioCtx.createAnalyser();
    analyser.fftSize = 4096; // More bins = better frequency resolution
    source.connect(analyser);
    return true;
  } catch (err) {
    alert('Could not access microphone: ' + err.message);
    return false;
  }
}

function stopMic() {
  stopDetection();
  micStream?.getTracks().forEach(t => t.stop());
  audioCtx?.close();
  micStream = null;
  audioCtx  = null;
  analyser  = null;
}

function startDetection() {
  stopDetection();
  stableKey   = null;
  stableStart = null;

  const freqBuf = new Float32Array(analyser.frequencyBinCount);

  function frame() {
    analyser.getFloatFrequencyData(freqBuf);
    const freq = detectDominantFreq(freqBuf, audioCtx.sampleRate, analyser.fftSize);

    if (freq) {
      const { note, octave } = freqToNote(freq);
      const key = `${note}${octave}`;

      if (key !== stableKey) {
        stableKey   = key;
        stableStart = Date.now();
        pitchEl.innerHTML = `<span class="gcal-note-live">${key}</span>`;
      } else if (Date.now() - stableStart >= STABLE_MS) {
        stopDetection();
        currentDetected = { freq, note, octave };
        onNoteDetected();
        return;
      }
    } else {
      if (stableKey) {
        stableKey   = null;
        stableStart = null;
        pitchEl.innerHTML = `<span class="gcal-listening">Listening…</span>`;
      }
    }

    rafId = requestAnimationFrame(frame);
  }

  rafId = requestAnimationFrame(frame);
}

function stopDetection() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
}

// ── Pitch maths ────────────────────────────────────────────────────────────────

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

function freqToNote(freq) {
  const semitones = Math.round(12 * Math.log2(freq / 440));
  const midi      = 69 + semitones;
  return {
    note:   NOTE_NAMES[((midi % 12) + 12) % 12],
    octave: Math.floor(midi / 12) - 1,
  };
}

function detectDominantFreq(freqData, sampleRate, fftSize) {
  const binWidth = sampleRate / fftSize;
  const minBin   = Math.floor(60  / binWidth); // 60Hz  (very low Ding)
  const maxBin   = Math.ceil(1400 / binWidth); // 1400Hz (high notes)

  let maxDb = -Infinity, peakBin = -1;
  for (let i = minBin; i <= maxBin && i < freqData.length; i++) {
    if (freqData[i] > maxDb) { maxDb = freqData[i]; peakBin = i; }
  }

  if (peakBin < 0 || maxDb < -45) return null; // too quiet

  // Quadratic interpolation for sub-bin accuracy
  const prev = freqData[peakBin - 1] ?? maxDb;
  const next = freqData[peakBin + 1] ?? maxDb;
  const denom = prev - 2 * maxDb + next;
  const delta = denom !== 0 ? 0.5 * (prev - next) / denom : 0;

  return (peakBin + delta) * binWidth;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function setStatus(html)  { statusEl.innerHTML  = html; }
function setActions(html) { actionsEl.innerHTML = html; }
