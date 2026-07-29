// guided-calibration.js
// Guides the user through mapping their handpan notes via mic pitch detection + tap-to-place.
// Called for new handpans immediately after the image is uploaded.

import { supabase } from './supabase-client.js';

// ── State ──────────────────────────────────────────────────────────────────────
let handpanData    = null;
let onComplete     = null;
let onCancel       = null;
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
let lastSeenAt  = null; // last frame stableKey was actually read (even a frame late)
const STABLE_MS = 700;  // total ms of (mostly) the same note before confirming
const GRACE_MS  = 220;  // brief dropouts/blips shorter than this don't reset the streak —
                         // a real note's natural volume decay and harmonic wobble means a
                         // perfectly unbroken reading is unrealistic to ever require

// DOM refs
let overlay, imageEl, dotsLayer, statusEl, pitchEl, actionsEl, canvasContainer, closeBtn;

// ── Public API ─────────────────────────────────────────────────────────────────

export function startGuidedCalibration(data, onCompleteCallback, onCancelCallback) {
  handpanData   = data;
  onComplete    = onCompleteCallback;
  onCancel      = onCancelCallback;
  placedNotes   = [];
  isListeningForDing = true;
  currentDetected    = null;

  grabDOM();

  // Lock the container to the image's own aspect ratio — identical technique
  // to calibration.js's loadCalibrationImage(), so this is the same fixed
  // box (not a stretch-to-fill area) as the Save & Fine-tune screen, and
  // tap coordinates never need letterbox-offset correction.
  imageEl.onload = () => {
    if (imageEl.naturalWidth) {
      canvasContainer.style.aspectRatio = `${imageEl.naturalWidth} / ${imageEl.naturalHeight}`;
    }
  };
  imageEl.src = data.top_image_url;

  overlay.style.display = 'flex';
  overlay.setAttribute('aria-hidden', 'false');

  // Direct assignment (not addEventListener) so re-starting calibration
  // doesn't stack duplicate handlers on this persistent button.
  closeBtn.onclick = () => {
    closeOverlay();
    onCancel?.();
  };

  showWelcome();
}

// ── DOM ────────────────────────────────────────────────────────────────────────

function grabDOM() {
  overlay         = document.getElementById('guidedCalOverlay');
  imageEl         = document.getElementById('guidedCalImage');
  dotsLayer       = document.getElementById('guidedCalDotsLayer');
  statusEl        = document.getElementById('guidedCalStatus');
  pitchEl         = document.getElementById('guidedCalPitchDisplay');
  actionsEl       = document.getElementById('guidedCalActions');
  canvasContainer = document.getElementById('guidedCalCanvasContainer');
  closeBtn        = document.getElementById('guidedCalCloseBtn');
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
  renderManualEntry();
  startDetection();
}

function promptNextNote() {
  const count = placedNotes.filter(n => !n.isDing).length;
  setStatus(
    `<h2>Play another note ✨</h2>
     <p>${count === 0 ? 'Play any other note on your handpan.' : `${count} note${count > 1 ? 's' : ''} added — keep going!`}</p>`
  );
  pitchEl.innerHTML = `<span class="gcal-listening">Listening…</span>`;
  renderManualEntry(`<button class="gcal-btn-secondary" id="gcalDoneBtn">All done →</button>`);
  document.getElementById('gcalDoneBtn').addEventListener('click', showSummary);
  startDetection();
}

// Fallback for when the mic can't get a stable read (background noise,
// sustain/decay confusing the detector, etc.) — lets the user pick the note
// they know they just played instead of being stuck re-playing it forever.
function renderManualEntry(extraActionsHtml = '') {
  const noteOptions = NOTE_NAMES.map(n => `<option value="${n}">${n}</option>`).join('');
  const octaveOptions = [1, 2, 3, 4, 5, 6].map(o => `<option value="${o}" ${o === 3 ? 'selected' : ''}>${o}</option>`).join('');

  setActions(`
    <button type="button" class="gcal-manual-toggle" id="gcalManualToggle">Can't hear it? Enter manually</button>
    <div class="gcal-manual-entry" id="gcalManualEntry" hidden>
      <select id="gcalManualNote" aria-label="Note">${noteOptions}</select>
      <select id="gcalManualOctave" aria-label="Octave">${octaveOptions}</select>
      <button type="button" class="gcal-btn-primary" id="gcalManualUseBtn">Use this note</button>
    </div>
    ${extraActionsHtml}
  `);

  document.getElementById('gcalManualToggle').addEventListener('click', () => {
    document.getElementById('gcalManualEntry').hidden = false;
    document.getElementById('gcalManualToggle').hidden = true;
  });

  document.getElementById('gcalManualUseBtn').addEventListener('click', () => {
    const note = document.getElementById('gcalManualNote').value;
    const octave = Number(document.getElementById('gcalManualOctave').value);
    stopDetection();
    currentDetected = { freq: noteToFreq(note, octave), note, octave };
    onNoteDetected();
  });
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

  // Enable tap on the canvas container
  canvasContainer.classList.add('gcal-tappable');
  canvasContainer.addEventListener('pointerup', handleTap, { once: true });
}

function onNotePlaced(x, y) {
  const note = { ...currentDetected, x, y, isDing: isListeningForDing };
  placedNotes.push(note);
  renderDot(note, placedNotes.length - 1);

  canvasContainer.classList.remove('gcal-tappable');

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
  const coords = tapToContainerPercent(e, canvasContainer);
  if (!coords) {
    // Tapped outside container bounds — re-attach listener
    canvasContainer.addEventListener('pointerup', handleTap, { once: true });
    return;
  }
  onNotePlaced(coords.x, coords.y);
}

// canvasContainer's aspect-ratio is locked to the image's natural size (see
// startGuidedCalibration), so the container *is* the image's content box —
// no object-fit:contain letterboxing to correct for, unlike before. Same
// simple math the fine-tune screen's own tonefield placement relies on.
function tapToContainerPercent(e, container) {
  const rect = container.getBoundingClientRect();
  const clientX = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
  const clientY = e.changedTouches ? e.changedTouches[0].clientY : e.clientY;

  const x = ((clientX - rect.left) / rect.width) * 100;
  const y = ((clientY - rect.top) / rect.height) * 100;

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
  lastSeenAt  = null;

  const freqBuf = new Float32Array(analyser.frequencyBinCount);

  function frame() {
    analyser.getFloatFrequencyData(freqBuf);
    const freq = detectDominantFreq(freqBuf, audioCtx.sampleRate, analyser.fftSize);
    const now = Date.now();
    const withinGrace = stableKey && lastSeenAt && (now - lastSeenAt) <= GRACE_MS;

    if (freq) {
      const { note, octave } = freqToNote(freq);
      const key = `${note}${octave}`;

      if (key === stableKey) {
        lastSeenAt = now;
        if (now - stableStart >= STABLE_MS) {
          stopDetection();
          currentDetected = { freq, note, octave };
          onNoteDetected();
          return;
        }
      } else if (withinGrace) {
        // Brief blip to a different reading — most likely a harmonic/
        // octave misread, not a real note change. Ignore this frame and
        // keep the existing streak going rather than resetting it.
      } else {
        // Either the first reading, or the mismatch has lasted longer than
        // the grace window — treat it as a genuine new note and start over.
        stableKey   = key;
        stableStart = now;
        lastSeenAt  = now;
        pitchEl.innerHTML = `<span class="gcal-note-live">${key}</span>`;
      }
    } else if (!withinGrace) {
      // Too quiet for longer than the grace window — actually gone silent.
      stableKey   = null;
      stableStart = null;
      lastSeenAt  = null;
      pitchEl.innerHTML = `<span class="gcal-listening">Listening…</span>`;
    }
    // else: a brief quiet frame within grace — wait it out without resetting.

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

// Inverse of freqToNote — used for manually-entered notes, so they still
// sort correctly alongside mic-detected ones (showSummary sorts by freq).
function noteToFreq(note, octave) {
  const midi = NOTE_NAMES.indexOf(note) + (octave + 1) * 12;
  return 440 * Math.pow(2, (midi - 69) / 12);
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
