// guided-calibration.js
// Guides the user through mapping their handpan notes via mic pitch detection + tap-to-place.
// Called for new handpans immediately after the image is uploaded.
//
// Two modes, chosen at the start:
//  - 'system' (default, unchanged from before): map notes to the app's
//    shared, built-in pitch-named samples.
//  - 'record': also capture the handpan's own real sound per note, trimmed
//    and uploaded, so it plays back with its own timbre (see
//    js/noteplayer.js's resolveSampleKey() for the playback side).
//
// Progress autosaves after every confirmed note, so closing partway through
// and reopening later resumes instead of restarting.

import { supabase } from './supabase-client.js';

// ── State ──────────────────────────────────────────────────────────────────────
let handpanData    = null;
let onComplete     = null;
let onCancel       = null;
let placedNotes    = [];   // [{ id, freq, note, octave, x, y, isDing, audio_url? }]
let currentDetected = null;
let isListeningForDing = true;

let recordingMode = 'system'; // 'system' | 'record'
let tipsShown     = false;
let pendingClip   = null;     // trimmed WAV Blob awaiting confirm, for the note currently in flight

// Audio
let micStream     = null;
let audioCtx      = null;
let analyser      = null;
let rafId         = null;

// Recording (record mode only)
let mediaRecorder    = null;
let recordedChunks   = [];
let recordingStartTime = 0;
let noteOnsetTime    = null;

// Detection stability
let stableKey   = null;
let stableStart = null;
let lastSeenAt  = null; // last frame stableKey was actually read (even a frame late)
const STABLE_MS = 700;  // total ms of (mostly) the same note before confirming
const GRACE_MS  = 220;  // brief dropouts/blips shorter than this don't reset the streak —
                         // a real note's natural volume decay and harmonic wobble means a
                         // perfectly unbroken reading is unrealistic to ever require

// Recording always runs the full countdown — no early-stop-on-silence.
// Handpan decay/room noise made "is it actually silent yet" unreliable
// enough that a fixed duration is simpler and more predictable to use.
const COUNTDOWN_MS = 8000;

// DOM refs
let overlay, imageEl, dotsLayer, statusEl, pitchEl, actionsEl, canvasContainer, closeBtn;

// ── Public API ─────────────────────────────────────────────────────────────────

export function startGuidedCalibration(data, onCompleteCallback, onCancelCallback) {
  handpanData   = data;
  onComplete    = onCompleteCallback;
  onCancel      = onCancelCallback;
  recordingMode = 'system';
  tipsShown     = false;
  pendingClip   = null;
  currentDetected = null;

  // Resume: seed already-placed notes from a previous session, if any.
  // Only real tonefields (a note + octave) placed by THIS flow — the fixed
  // tap/slap overlay positions (T_R/T_L/S_R/S_L) come from the separate
  // manual fine-tune screen, not here.
  placedNotes = (data.note_map || [])
    .filter(tf => tf.note && typeof tf.octave === 'number' && !['T_R', 'T_L', 'S_R', 'S_L'].includes(tf.assignedNumber))
    .map(tf => ({
      id: tf.id,
      note: tf.note,
      octave: tf.octave,
      x: tf.x,
      y: tf.y,
      isDing: tf.assignedNumber === 'Ding' || tf.assignedNumber === 'D',
      audio_url: tf.audio_url || null,
    }));
  isListeningForDing = !placedNotes.some(n => n.isDing);

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
  // doesn't stack duplicate handlers on this persistent button. Progress is
  // already autosaved per note, so closing here never loses anything.
  closeBtn.onclick = () => {
    closeOverlay();
    onCancel?.();
  };

  showModeChoice();
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

  // Existing dots for already-placed (resumed) notes
  dotsLayer.innerHTML = '';
  placedNotes.forEach((n, i) => renderDot(n, i));
}

function closeOverlay() {
  stopMic();
  stopRecordingIfActive();
  overlay.style.display = 'none';
  overlay.setAttribute('aria-hidden', 'true');
  dotsLayer.innerHTML = '';
  stableKey = null;
  stableStart = null;
}

// ── Screens: mode choice + tips ──────────────────────────────────────────────────

function showModeChoice() {
  setStatus(
    `<h2>How do you want to map your notes? 🎙️</h2>
     <p>Use the app's built-in sounds, or record your own handpan actually making them — you can always come back and do the other one later.</p>`
  );
  pitchEl.innerHTML = '';
  setActions(`
    <button class="gcal-btn-secondary" id="gcalModeSystemBtn">Use system notes</button>
    <button class="gcal-btn-primary" id="gcalModeRecordBtn">Record my own handpan sounds</button>
  `);
  document.getElementById('gcalModeSystemBtn').addEventListener('click', () => {
    recordingMode = 'system';
    showWelcome();
  });
  document.getElementById('gcalModeRecordBtn').addEventListener('click', () => {
    recordingMode = 'record';
    showTipCards();
  });
}

const TIP_CARDS = [
  {
    title: 'Find a quiet room',
    body: 'Background noise makes it much harder to hear your note clearly — a quiet indoor space works best.',
    icon: `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M6 18h8l12-9v30l-12-9H6z"/>
      <path d="M32 16a8 8 0 0 1 0 16" opacity="0.35"/>
      <path d="M36 30l8 8M44 30l-8 8" opacity="0.9"/>
    </svg>`,
  },
  {
    title: 'Hold your phone steady',
    body: 'Keep it about 8–10 inches (≈20–25 cm) from the tonefield you’re playing — close enough to hear it clearly, not so close it distorts.',
    icon: `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="17" y="4" width="14" height="24" rx="3"/>
      <circle cx="24" cy="40" r="6"/>
      <path d="M24 34v-4" opacity="0.6"/>
      <path d="M8 34h4M36 34h4" opacity="0.6"/>
    </svg>`,
  },
  {
    title: 'Play once, then stay silent',
    body: 'Strike the note a single time, then hold still and quiet for about 8 seconds so the full, natural decay gets captured cleanly.',
    icon: `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="24" cy="24" r="18"/>
      <path d="M24 14v10l7 4" />
    </svg>`,
  },
];

let tipIndex = 0;

function showTipCards() {
  tipIndex = 0;
  renderTipCard();
}

function renderTipCard() {
  const tip = TIP_CARDS[tipIndex];
  setStatus(`
    <div class="gcal-tip-card">
      <div class="gcal-tip-icon">${tip.icon}</div>
      <div class="gcal-tip-step">${tipIndex + 1} / ${TIP_CARDS.length}</div>
      <h2>${tip.title}</h2>
      <p>${tip.body}</p>
    </div>
  `);
  pitchEl.innerHTML = '';

  const isLast = tipIndex === TIP_CARDS.length - 1;
  setActions(`
    ${tipIndex > 0 ? '<button class="gcal-btn-secondary" id="gcalTipBackBtn">← Back</button>' : '<div></div>'}
    <button class="gcal-btn-primary" id="gcalTipNextBtn">${isLast ? "I'm ready →" : 'Next →'}</button>
  `);

  document.getElementById('gcalTipBackBtn')?.addEventListener('click', () => {
    tipIndex--;
    renderTipCard();
  });
  document.getElementById('gcalTipNextBtn').addEventListener('click', () => {
    if (isLast) {
      tipsShown = true;
      showWelcome();
    } else {
      tipIndex++;
      renderTipCard();
    }
  });
}

// ── Screens: main flow ────────────────────────────────────────────────────────────

function showWelcome() {
  setStatus(
    `<h2>Let's map your handpan! 🎵</h2>
     <p>We'll listen to each note you play and place it right on your instrument.<br>It only takes a minute — let's do this!</p>`
  );
  pitchEl.innerHTML = '';
  setActions(`<button class="gcal-btn-primary" id="gcalStartBtn">Let's go! →</button>`);
  document.getElementById('gcalStartBtn').addEventListener('click', async () => {
    const ok = await startMic();
    if (!ok) return;
    goToNextPrompt();
  });
}

// Routes to the right prompt for the current mode + resume state.
function goToNextPrompt() {
  if (isListeningForDing) {
    recordingMode === 'record' ? promptDingRecord() : promptDing();
  } else {
    recordingMode === 'record' ? promptNextNoteRecord() : promptNextNote();
  }
}

function promptDing() {
  isListeningForDing = true;
  setStatus(
    `<h2>Play your Ding 🎶</h2>
     <p>This is the big center note — the deepest, richest note on your handpan.</p>`
  );
  pitchEl.innerHTML = `<span class="gcal-listening">Listening…</span>`;
  renderManualEntry();
  startDetection(onNoteDetected);
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
  startDetection(onNoteDetected);
}

// Fallback for when the mic can't get a stable read (background noise,
// sustain/decay confusing the detector, etc.) — lets the user pick the note
// they know they just played instead of being stuck re-playing it forever.
// System-mode only: record-mode always needs a real recorded take, so
// there's no manual-entry escape hatch there.
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
    onNoteDetected({ freq: noteToFreq(note, octave), note, octave });
  });
}

function onNoteDetected(detected) {
  currentDetected = detected;
  const { note, octave } = currentDetected;

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

async function onNotePlaced(x, y) {
  const note = {
    id: currentDetected.id ?? (Date.now() + Math.floor(Math.random() * 1000)),
    freq: currentDetected.freq,
    note: currentDetected.note,
    octave: currentDetected.octave,
    x, y,
    isDing: isListeningForDing,
  };
  if (pendingClip) {
    note.audioBlob = pendingClip;
    pendingClip = null;
  }
  placedNotes.push(note);
  renderDot(note, placedNotes.length - 1);

  canvasContainer.classList.remove('gcal-tappable');

  const label = isListeningForDing ? 'Ding' : `${note.note}${note.octave}`;
  setStatus(`<h2>Saving…</h2>`);
  pitchEl.innerHTML = '';
  setActions('');

  await saveProgress();

  setStatus(`<h2>${isListeningForDing ? 'Ding placed! 🥁' : `${label} placed! ✅`}</h2><p>Nice one!</p>`);

  setTimeout(() => {
    isListeningForDing = false;
    // Brief cooldown before next detection so the ringing note doesn't re-trigger
    setTimeout(goToNextPrompt, 400);
  }, 700);
}

function showSummary() {
  stopDetection();

  if (placedNotes.length === 0) {
    setStatus(`<h2>No notes added yet</h2><p>Play at least your Ding before finishing.</p>`);
    setActions(`<button class="gcal-btn-primary" id="gcalBackBtn">← Back</button>`);
    document.getElementById('gcalBackBtn').addEventListener('click', goToNextPrompt);
    return;
  }

  // Number non-Ding notes in the order they were placed (Ding = first tap,
  // 1/2/3/... = each subsequent tap in sequence) rather than by pitch —
  // matches the manual "Add Tonefield" button's Ding-then-max+1 numbering
  // in js/calibration.js, so nothing needs manual reordering afterward.
  const ding = placedNotes.find(n => n.isDing);
  const rest = placedNotes.filter(n => !n.isDing);

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
  document.getElementById('gcalAddMoreBtn').addEventListener('click', goToNextPrompt);
  document.getElementById('gcalSaveBtn').addEventListener('click', showSharePrompt);
}

// ── Share prompt ───────────────────────────────────────────────────────────────

function showSharePrompt() {
  setStatus(
    `<h2>Share your handpan? 🤝</h2>
     <p>Other players could explore your tuning — and if you recorded your own sounds, hear your actual instrument instead of a generic sample. Sharing is optional, but it genuinely helps.</p>
     <label class="gcal-share-row">
       <input type="checkbox" id="gcalShareScale" checked>
       Share this handpan's scale (tuning &amp; note layout)
     </label>
     <label class="gcal-share-row">
       <input type="checkbox" id="gcalShareAudio" ${recordingMode === 'record' ? 'checked' : 'disabled'}>
       Share my recorded note sounds${recordingMode === 'record' ? '' : ' (nothing recorded this session)'}
     </label>`
  );
  pitchEl.innerHTML = '';
  setActions(`<button class="gcal-btn-primary" id="gcalFinishBtn">Done →</button>`);
  document.getElementById('gcalFinishBtn').addEventListener('click', () => {
    const shareScale = document.getElementById('gcalShareScale').checked;
    const shareAudio = document.getElementById('gcalShareAudio').checked;
    finishAndSave(shareScale, shareAudio);
  });
}

async function finishAndSave(shareScale, shareAudio) {
  const { error } = await supabase
    .from('user_handpans')
    .update({ is_scale_shared: shareScale, is_audio_shared: shareAudio })
    .eq('id', handpanData.id);

  if (error) {
    setStatus(`<h2>Save failed</h2><p>${error.message}</p>`);
    return;
  }

  handpanData = { ...handpanData, is_scale_shared: shareScale, is_audio_shared: shareAudio };
  closeOverlay();
  onComplete?.(handpanData);
}

// ── Tonefield builder ──────────────────────────────────────────────────────────

function buildNoteMap(ding, rest) {
  const noteMap = [];
  const defaultSize = 11; // percent

  if (ding) {
    noteMap.push({
      id:             ding.id,
      x:              ding.x,
      y:              ding.y,
      width:          defaultSize,
      height:         defaultSize,
      rotation:       0,
      note:           ding.note,
      octave:         ding.octave,
      assignedNumber: 'Ding',
      side:           'top',
      ...(ding.audio_url ? { audio_url: ding.audio_url } : {}),
    });
  }

  rest.forEach((n, i) => {
    noteMap.push({
      id:             n.id,
      x:              n.x,
      y:              n.y,
      width:          defaultSize,
      height:         defaultSize,
      rotation:       0,
      note:           n.note,
      octave:         n.octave,
      assignedNumber: String(i + 1),
      side:           'top',
      ...(n.audio_url ? { audio_url: n.audio_url } : {}),
    });
  });

  return noteMap;
}

// Persists the current in-memory state after every confirmed note, so
// closing the overlay early never loses already-placed notes. Uploads any
// not-yet-uploaded recorded clip first.
async function saveProgress() {
  const ding = placedNotes.find(n => n.isDing);
  const rest = placedNotes.filter(n => !n.isDing);

  for (const n of [ding, ...rest].filter(Boolean)) {
    if (n.audioBlob && !n.audio_url) {
      try {
        n.audio_url = await uploadNoteAudio(n);
      } catch (err) {
        console.error('[GuidedCal] Audio upload failed:', err);
      } finally {
        delete n.audioBlob;
      }
    }
  }

  const noteMap = buildNoteMap(ding, rest);
  const { error } = await supabase.from('user_handpans').update({ note_map: noteMap }).eq('id', handpanData.id);
  if (error) {
    console.error('[GuidedCal] Autosave failed:', error);
  } else {
    handpanData = { ...handpanData, note_map: noteMap };
  }
}

function slugify(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// [pitch]_[scale_slug]_[00001].wav — see supabase/migrations/*_handpan_audio_bucket.sql's
// next_handpan_audio_seq() for the race-safe per (pitch, scale) counter this
// numbering comes from. Lets an admin later browse the bucket and, for any
// tuning that's been shared, promote a specific recording into the app's
// own built-in sample library using the same naming shape it already uses.
async function uploadNoteAudio(note) {
  const pitch = `${note.note}${note.octave}`.replace('#', 's');
  const scaleSlug = slugify(handpanData.scale_name || handpanData.name) || 'handpan';
  const handpanIdShort = String(handpanData.id).replace(/-/g, '').slice(0, 8);
  const seqKey = `${pitch}_${scaleSlug}_${handpanIdShort}`;

  const { data: seq, error: seqError } = await supabase.rpc('next_handpan_audio_seq', { p_seq_key: seqKey });
  if (seqError) throw seqError;

  const fileName = `${pitch}_${scaleSlug}_${handpanIdShort}_${String(seq).padStart(5, '0')}.wav`;
  const { error: uploadError } = await supabase.storage
    .from('handpan-audio')
    .upload(fileName, note.audioBlob, { contentType: 'audio/wav' });
  if (uploadError) throw uploadError;

  // handpan-audio is a private bucket — there's no public URL to fetch.
  // Link the file to this handpan so storage RLS knows who's allowed to
  // read it (owner always; everyone else only if is_audio_shared is true),
  // then hand back the storage PATH — noteplayer.js downloads it via an
  // authenticated request, not a plain fetch(url).
  const { error: linkError } = await supabase
    .from('handpan_audio_recordings')
    .insert({ user_handpan_id: handpanData.id, storage_path: fileName });
  if (linkError) throw linkError;

  return fileName;
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
  const dot   = document.createElement('div');
  dot.className = `gcal-dot${ding ? ' gcal-dot-ding' : ''}`;
  dot.style.left = `${note.x}%`;
  dot.style.top  = `${note.y}%`;
  dot.textContent = ding ? 'D' : `${note.note}${note.octave}`;
  dotsLayer.appendChild(dot);
}

// ── Recording (record mode) ──────────────────────────────────────────────────────

function promptDingRecord() {
  isListeningForDing = true;
  setStatus(
    `<h2>Play your Ding 🎶</h2>
     <p>This is the big center note — the deepest, richest note on your handpan. Tap Ready, then play it.</p>`
  );
  pitchEl.innerHTML = '';
  setActions(`<button class="gcal-btn-primary" id="gcalReadyBtn">Ready →</button>`);
  document.getElementById('gcalReadyBtn').addEventListener('click', startNoteRecording);
}

function promptNextNoteRecord() {
  isListeningForDing = false;
  const count = placedNotes.filter(n => !n.isDing).length;
  setStatus(
    `<h2>Play another note ✨</h2>
     <p>${count === 0 ? 'Play any other note on your handpan.' : `${count} note${count > 1 ? 's' : ''} added — keep going!`} Tap Ready, then play it.</p>`
  );
  pitchEl.innerHTML = '';
  setActions(`
    <button class="gcal-btn-primary" id="gcalReadyBtn">Ready →</button>
    <button class="gcal-btn-secondary" id="gcalDoneBtn">All done →</button>
  `);
  document.getElementById('gcalReadyBtn').addEventListener('click', startNoteRecording);
  document.getElementById('gcalDoneBtn').addEventListener('click', showSummary);
}

// High-bitrate opus — MediaRecorder's default bitrate is low enough to
// visibly dull a handpan's harmonics; this is a big step up in fidelity
// for the intermediate compressed capture (before it gets decoded and
// re-encoded as WAV, so this is the one place any lossy loss happens).
const RECORDER_BITS_PER_SECOND = 256000;

function createNoteRecorder() {
  const mimeType = (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm;codecs=opus'))
    ? 'audio/webm;codecs=opus' : '';
  const recorder = new MediaRecorder(micStream, {
    ...(mimeType ? { mimeType } : {}),
    audioBitsPerSecond: RECORDER_BITS_PER_SECOND,
  });
  recordedChunks = [];
  recorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
  recorder.onstop = handleRecordingStopped;
  return recorder;
}

function startNoteRecording() {
  setStatus(`<h2>Listening… 🔴</h2><p>Play the note now.</p>`);
  pitchEl.innerHTML = `<span class="gcal-listening">Waiting for your note…</span>`;
  // Pitch detection can't always get a confident read from a single tap
  // (background noise, a note that's hard to pin down, etc.) — this gets
  // the user unstuck instead of leaving them stranded on "Listening…"
  // forever, by splitting pitch ID and recording into two separate steps.
  setActions(`<button class="gcal-btn-secondary" id="gcalRetryBtn">It's not detecting the note</button>`);
  document.getElementById('gcalRetryBtn').addEventListener('click', () => {
    abortCurrentAttempt();
    promptPhaseOneDetectPitch();
  });

  mediaRecorder = createNoteRecorder();
  recordingStartTime = performance.now();
  noteOnsetTime = null;
  mediaRecorder.start();

  startDetection(onNoteConfirmedForRecording);
}

function onNoteConfirmedForRecording(detected) {
  currentDetected = detected;
  noteOnsetTime = performance.now();
  showCountdownUI();
  runCountdown(noteOnsetTime);
}

function showCountdownUI() {
  const { note, octave } = currentDetected;
  pitchEl.innerHTML = `
    <div class="gcal-record-note">${note}${octave}</div>
    <div class="gcal-countdown" id="gcalCountdown">${Math.ceil(COUNTDOWN_MS / 1000)}</div>
    <div class="gcal-countdown-label">stay quiet for a moment…</div>
  `;
  setActions('');
}

// Always runs the full COUNTDOWN_MS, regardless of when the sound actually
// decays — no early stop.
function runCountdown(anchorTime) {
  function frame() {
    if (!mediaRecorder || mediaRecorder.state !== 'recording') return;

    const elapsed = performance.now() - anchorTime;
    const remainingMs = Math.max(0, COUNTDOWN_MS - elapsed);
    const countdownEl = document.getElementById('gcalCountdown');
    if (countdownEl) countdownEl.textContent = String(Math.ceil(remainingMs / 1000));

    if (elapsed >= COUNTDOWN_MS) {
      mediaRecorder.stop();
      return;
    }

    rafId = requestAnimationFrame(frame);
  }
  rafId = requestAnimationFrame(frame);
}

// Discards whatever attempt is currently in flight (recording and/or pitch
// detection) without processing it — used when Retry is tapped.
function abortCurrentAttempt() {
  stopDetection();
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.onstop = null; // don't run handleRecordingStopped on a discarded attempt
    mediaRecorder.stop();
  }
  mediaRecorder = null;
  recordedChunks = [];
  noteOnsetTime = null;
}

// ── Recovery flow (after Retry): pitch ID and recording split into two
// separate steps, instead of one combined tap-and-hope-it-detects attempt.

function promptPhaseOneDetectPitch() {
  setStatus(
    `<h2>Let's find the pitch first 🎯</h2>
     <p>Go ahead and tap the note a few times — we just need a confident read before we record anything.</p>`
  );
  pitchEl.innerHTML = `<span class="gcal-listening">Listening…</span>`;
  setActions(`<button class="gcal-btn-secondary" id="gcalBackBtn">← Back</button>`);
  document.getElementById('gcalBackBtn').addEventListener('click', () => {
    abortCurrentAttempt();
    isListeningForDing ? promptDingRecord() : promptNextNoteRecord();
  });
  startDetection(onPitchConfirmedPhaseOne);
}

function onPitchConfirmedPhaseOne(detected) {
  currentDetected = detected;
  promptPhaseTwoRecord();
}

function promptPhaseTwoRecord() {
  const { note, octave } = currentDetected;
  setStatus(
    `<h2>Got it — ${note}${octave} 🎉</h2>
     <p>Now play it once more, then stay quiet — we'll record for 8 seconds.</p>`
  );
  pitchEl.innerHTML = '';
  setActions(`<button class="gcal-btn-primary" id="gcalReadyBtn">Ready →</button>`);
  document.getElementById('gcalReadyBtn').addEventListener('click', startFixedRecording);
}

// Phase two of the recovery flow: pitch is already known, so this just
// records for a fixed COUNTDOWN_MS with no detection running alongside it.
function startFixedRecording() {
  setStatus(`<h2>Recording… 🔴</h2><p>Play the note now.</p>`);
  showCountdownUI();

  mediaRecorder = createNoteRecorder();

  recordingStartTime = performance.now();
  mediaRecorder.start();
  runCountdown(recordingStartTime);
}

async function handleRecordingStopped() {
  stopDetection();
  const mimeType = mediaRecorder?.mimeType || 'audio/webm';
  const rawBlob = new Blob(recordedChunks, { type: mimeType });
  mediaRecorder = null;

  setStatus(`<h2>Processing… ⏳</h2>`);
  pitchEl.innerHTML = '';
  setActions('');

  try {
    const trimmedBlob = await trimSilence(rawBlob);
    showConfirmScreen(trimmedBlob);
  } catch (err) {
    console.error('[GuidedCal] Trim/process failed:', err);
    setStatus(`<h2>Recording didn't come through</h2><p>${err.message || 'Please try again.'}</p>`);
    setActions(`<button class="gcal-btn-secondary" id="gcalRetryRecordBtn">Try again</button>`);
    document.getElementById('gcalRetryRecordBtn').addEventListener('click', () => {
      isListeningForDing ? promptDingRecord() : promptNextNoteRecord();
    });
  }
}

function showConfirmScreen(trimmedBlob) {
  pendingClip = trimmedBlob;
  const url = URL.createObjectURL(trimmedBlob);
  const { note, octave } = currentDetected;

  setStatus(
    `<h2>Sounds right? 🎧</h2>
     <p>Your ${isListeningForDing ? 'Ding' : 'note'} is tuned to <strong>${note}${octave}</strong>.</p>
     <audio controls src="${url}" class="gcal-audio-preview"></audio>`
  );
  pitchEl.innerHTML = '';
  setActions(`
    <button class="gcal-btn-secondary" id="gcalRerecordBtn">Re-record</button>
    <button class="gcal-btn-primary" id="gcalConfirmRecordBtn">Yes, sounds right →</button>
  `);

  document.getElementById('gcalRerecordBtn').addEventListener('click', () => {
    URL.revokeObjectURL(url);
    pendingClip = null;
    isListeningForDing ? promptDingRecord() : promptNextNoteRecord();
  });

  document.getElementById('gcalConfirmRecordBtn').addEventListener('click', () => {
    setStatus(
      `<h2>Great! 🎉</h2>
       <p>Now <strong>tap where it is</strong> on your handpan.</p>`
    );
    setActions('');
    canvasContainer.classList.add('gcal-tappable');
    canvasContainer.addEventListener('pointerup', handleTap, { once: true });
  });
}

function stopRecordingIfActive() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.onstop = null; // don't process a clip nobody's waiting on
    mediaRecorder.stop();
  }
  mediaRecorder = null;
}

// ── Pitch detection ────────────────────────────────────────────────────────────

async function startMic() {
  try {
    // Disable voice-call-oriented processing that distorts an instrument's
    // real timbre — but NOT autoGainControl: a phone mic picking up a
    // handpan from ~8-10 inches away often needs that boost just to cross
    // detectDominantFreq()'s "is anything even playing" threshold at all.
    // Without it, pitch detection can go quiet-signal-blind entirely
    // (looks exactly like "not listening"), even though it's fine for a
    // synthetic/fixed-level test signal that doesn't depend on real gain
    // staging the way an actual microphone does.
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, autoGainControl: true, noiseSuppression: false },
      video: false,
    });
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

// onConfirmed(detected) is called once a note reads as stable for STABLE_MS.
// Three different callers: system mode goes straight to tap-to-place
// (onNoteDetected); record mode's combined tap-and-record path starts the
// countdown (onNoteConfirmedForRecording); the post-Retry recovery flow's
// pitch-only phase just captures the pitch before recording separately
// (onPitchConfirmedPhaseOne).
function startDetection(onConfirmed) {
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
          onConfirmed({ freq, note, octave });
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
        if (pitchEl.querySelector('.gcal-listening, .gcal-note-live')) {
          pitchEl.innerHTML = `<span class="gcal-note-live">${key}</span>`;
        }
      }
    } else if (!withinGrace) {
      // Too quiet for longer than the grace window — actually gone silent.
      stableKey   = null;
      stableStart = null;
      lastSeenAt  = null;
      if (pitchEl.querySelector('.gcal-listening, .gcal-note-live')) {
        pitchEl.innerHTML = `<span class="gcal-listening">Listening…</span>`;
      }
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

const MIN_DETECT_FREQ = 60;   // Hz, very low Ding
const MAX_DETECT_FREQ = 1400; // Hz, high notes

function detectDominantFreq(freqData, sampleRate, fftSize) {
  const binWidth = sampleRate / fftSize;
  const minBin   = Math.floor(MIN_DETECT_FREQ / binWidth);
  const maxBin   = Math.ceil(MAX_DETECT_FREQ / binWidth);

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

// Peak dB across the same range detectDominantFreq scans, but without
// requiring a clean single-note read — used during recording to track
// overall loudness decay, independent of pitch stability.
// ── Silence trimming + WAV encoding ──────────────────────────────────────────────

// Only trims the LEAD-IN (dead air before the note is struck) — the
// trailing end is deliberately left untouched all the way through to the
// actual end of the recording. A real handpan's decay tail runs quiet
// enough, long enough, that any trailing-silence threshold ended up
// cutting the capture down to just the first second or so, discarding
// exactly the long decay the whole 8-second window exists to capture.
async function trimSilence(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;

  const AMPLITUDE_THRESHOLD = 0.02;
  const WINDOW = Math.max(1, Math.round(sampleRate * 0.02)); // 20ms RMS window

  function rmsAt(i) {
    let sum = 0;
    const end = Math.min(channelData.length, i + WINDOW);
    for (let j = i; j < end; j++) sum += channelData[j] * channelData[j];
    return Math.sqrt(sum / (end - i));
  }

  let startIdx = 0;
  for (let i = 0; i < channelData.length; i += WINDOW) {
    if (rmsAt(i) > AMPLITUDE_THRESHOLD) { startIdx = Math.max(0, i - WINDOW); break; }
  }

  const trimmed = channelData.subarray(startIdx);
  const trimmedBuffer = audioCtx.createBuffer(1, trimmed.length, sampleRate);
  trimmedBuffer.copyToChannel(trimmed, 0);

  return audioBufferToWav(trimmedBuffer);
}

function audioBufferToWav(buffer) {
  const numChannels = 1;
  const sampleRate = buffer.sampleRate;
  const samples = buffer.getChannelData(0);
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = samples.length * bytesPerSample;

  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);

  function writeString(offset, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function setStatus(html)  { statusEl.innerHTML  = html; }
function setActions(html) { actionsEl.innerHTML = html; }
