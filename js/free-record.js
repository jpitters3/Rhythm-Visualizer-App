import { getAudioCtx, unlockAudio, playNoteByLabel, getVolume, setBeats, setSubdivision } from './noteplayer.js';
import { getScale, isListening, activeGrid } from './state.js';
import { turnOffMic, startCountdown } from './transcription.js';
import { Bus, BUS_EVENT } from './bus.js';

const BUFSIZE = 2048;
const buf = new Float32Array(BUFSIZE);
const ROW_HEIGHT = 82;
const CELL_SIZE = 52;
const BEAT_MARGIN = 40; // px from edge to first/last beat center; keeps pulse animation unclipped
const MIN_ROWS = 4;
const DEBOUNCE_MS = 80;
const CLARITY_THRESHOLD = 0.85;
const RMS_FLOOR = 0.015;
const FLUX_NEW_STRIKE = 1.35;

// Per-note sustain gate: same note can't re-trigger within this window
// unless RMS rises sharply relative to the original strike (genuine restrike).
const NOTE_GATE_MS = 350;
const NOTE_RESTRIKE_FLUX = 1.65;

// Copied from transcription.js to keep this module independent
const NOTE_FREQS = {
  "C2": 65.41, "Cs2": 69.30, "D2": 73.42, "Eb2": 77.78, "E2": 82.41, "F2": 87.31, "Fs2": 92.50, "G2": 98.00, "Gs2": 103.83, "A2": 110.00, "Bb2": 116.54, "B2": 123.47,
  "C3": 130.81, "Cs3": 138.59, "D3": 146.83, "Eb3": 155.56, "E3": 164.81, "F3": 174.61, "Fs3": 185.00, "G3": 196.00, "Gs3": 207.65, "A3": 220.00, "Bb3": 233.08, "B3": 246.94,
  "C4": 261.63, "Cs4": 277.18, "D4": 293.66, "Eb4": 311.13, "E4": 329.63, "F4": 349.23, "Fs4": 369.99, "G4": 392.00, "Gs4": 415.30, "A4": 440.00, "Bb4": 466.16, "B4": 493.88,
  "C5": 523.25, "Cs5": 554.37, "D5": 587.33, "Eb5": 622.25, "E5": 659.25, "F5": 698.46, "Fs5": 739.99, "G5": 783.99, "Gs5": 830.61, "A5": 880.00, "Bb5": 932.33, "B5": 987.77,
  "C6": 1046.50
};

// --- State ---
let frStream = null;
let frAnalyser = null;
let isRecording = false;
let recordStartAudioTime = 0; // AudioContext.currentTime at recording start
let frInputLatencyMs = 0;     // computed once per recording: analyser buffer + device input latency
let recordDuration = 0;
let events = [];
let lastNoteTime = 0;
let prevRms = 0;
let lastDetectedLabel = null;
// Per-note sustain gate: label -> { time: audioElapsedMs, rms: frameRms }
const noteGate = new Map();
let isPlaying = false;
let activePlayBtn = null;
let playheadRAF = null;
let playbackTimers = [];
let nextEventId = 0;
let selectedIds = new Set();
let lastSelectedId = null;

// Drag state
let dragEventIds = null;
let dragStartTimes = null;
let dragAnchorTime = null;
let isDragging = false;
let wasDragging = false;
let activeDragPointerId = null;

// Placeholder state
let placeholderTime = null;
let placeholderEl = null;

// Snap state
let snapActive = false;

// Handpan move state
let handpanWrapOrigParent = null;
let handpanWrapOrigNextSibling = null;

// --- Standalone Metronome ---
let frMetroPlaying = false;
let frMetroBeat = 0;
let frMetroTimer = null;
let frMetroNextBeatTime = 0; // AudioContext time of next scheduled beat

// --- DOM Refs ---
const view          = document.getElementById('freeRecordView');
const timeline      = document.getElementById('frTimeline');
const timelineOuter = document.getElementById('frTimelineOuter');
const playhead      = document.getElementById('frPlayhead');
const recordBtn     = document.getElementById('frRecordBtn');
const playBtn       = document.getElementById('frPlayBtn');
const saveBtn       = document.getElementById('frSaveBtn');
const discardBtn    = document.getElementById('frDiscardBtn');
const snapBtn           = document.getElementById('frSnapBtn');
const nudgeLeftBtn      = document.getElementById('frNudgeLeft');
const nudgeRightBtn     = document.getElementById('frNudgeRight');
const savedList         = document.getElementById('frSavedList');
const backBtn           = document.getElementById('frBackBtn');
const openBtn           = document.getElementById('freeRecordBtn');
const frTsBeatsEl       = document.getElementById('frTsBeats');
const frTsSubEl         = document.getElementById('frTsSub');
const frHandpanSlot     = document.getElementById('frHandpanSlot');
const handpanWrapEl     = document.getElementById('handpanWrap');
const handpanOverlayEl  = document.getElementById('handpanOverlay');
const handpanOverlayBotEl = document.getElementById('handpanOverlayBottom');

// --- Standalone Metronome ---

function frScheduleClick(atTime, kind) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const vol = getVolume('metronome') ?? 1;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(kind === 'downbeat' ? 1600 : 1300, atTime);
  const level = Math.max(0.0001, (kind === 'downbeat' ? 0.28 : 0.20) * vol);
  gain.gain.setValueAtTime(0.0001, atTime);
  gain.gain.exponentialRampToValueAtTime(level, atTime + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, atTime + 0.03);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(atTime);
  osc.stop(atTime + 0.04);
}

// Lookahead scheduler — schedules notes 100ms ahead using AudioContext time so ticks don't drift.
function frMetroScheduler() {
  if (!frMetroPlaying) return;
  const ctx = getAudioCtx();
  if (!ctx) return;
  const lookahead = 0.1; // seconds
  const beatSec = 60 / (activeGrid?.bpm || 120);
  const beats = activeGrid?.beats || 4;

  while (frMetroNextBeatTime < ctx.currentTime + lookahead) {
    frScheduleClick(frMetroNextBeatTime, frMetroBeat === 0 ? 'downbeat' : 'beat');
    frMetroBeat = (frMetroBeat + 1) % beats;
    frMetroNextBeatTime += beatSec;
  }
  frMetroTimer = setTimeout(frMetroScheduler, 25);
}

// startAtAudioTime: AudioContext time to begin — pass ctx.currentTime when recording starts for tight sync.
function startFrMetro(startAtAudioTime) {
  const ctx = getAudioCtx();
  frMetroBeat = 0;
  frMetroPlaying = true;
  frMetroNextBeatTime = startAtAudioTime ?? (ctx?.currentTime ?? 0);
  frMetroScheduler();
}

function stopFrMetro() {
  frMetroPlaying = false;
  clearTimeout(frMetroTimer);
  frMetroTimer = null;
}

// Intercept fr-transport play button before TransportUI handles it
document.getElementById('frTransport')?.addEventListener('click', e => {
  const btn = e.target.closest('.t-play-btn');
  if (!btn) return;
  e.stopImmediatePropagation();
  unlockAudio();
  if (isRecording) {
    // Stop button while recording: stop the recording (which also stops metro)
    stopRecording();
  } else if (frMetroPlaying) {
    stopFrMetro();
    btn.textContent = '►';
    btn.classList.remove('active');
  } else {
    startFrMetro();
    btn.textContent = '■';
    btn.classList.add('active');
  }
}, { capture: true });

// --- Pitch Detection (mirrors transcription.js) ---

function autoCorrelate(buffer, sampleRate) {
  let SIZE = buffer.length;
  let rms = 0;
  for (let i = 0; i < SIZE; i++) { const v = buffer[i]; rms += v * v; }
  if (Math.sqrt(rms / SIZE) < RMS_FLOOR) return null;

  let r1 = 0, r2 = SIZE - 1;
  const thres = 0.2;
  for (let i = 0; i < SIZE / 2; i++) if (Math.abs(buffer[i]) < thres) { r1 = i; break; }
  for (let i = 1; i < SIZE / 2; i++) if (Math.abs(buffer[SIZE - i]) < thres) { r2 = SIZE - i; break; }
  buffer = buffer.slice(r1, r2);
  SIZE = buffer.length;

  const c = new Float32Array(SIZE).fill(0);
  for (let i = 0; i < SIZE; i++)
    for (let j = 0; j < SIZE - i; j++)
      c[i] += buffer[j] * buffer[j + i];

  let d = 0;
  while (c[d] > c[d + 1]) d++;
  let maxval = -1, maxpos = -1;
  for (let i = d; i < SIZE; i++) {
    if (c[i] > maxval) { maxval = c[i]; maxpos = i; }
  }
  if (maxpos <= 0) return null;

  const clarity = c[0] > 0 ? maxval / c[0] : 0;
  return { freq: sampleRate / maxpos, clarity, rms: Math.sqrt(rms / buffer.length) };
}

function findClosestNote(freq) {
  const scale = getScale();
  if (!scale) return null;

  const targets = [];
  const dFreq = NOTE_FREQS[scale.ding];
  if (dFreq) targets.push({ label: 'Ding', freq: dFreq });
  for (const [label, noteName] of Object.entries(scale.map || {})) {
    const f = NOTE_FREQS[noteName];
    if (f) targets.push({ label, freq: f });
  }

  const TOLERANCE = 0.07;
  let closest = null;
  let minDiff = Infinity;
  for (const t of targets) {
    const diff = Math.abs(t.freq - freq);
    if (diff < minDiff && diff < t.freq * TOLERANCE) {
      minDiff = diff;
      closest = t.label;
    }
  }
  return closest;
}

// --- Detection Loop ---

function detectionLoop() {
  if (!isRecording) return;

  const audioCtx = getAudioCtx();
  frAnalyser.getFloatTimeDomainData(buf);
  const result = autoCorrelate(buf, audioCtx.sampleRate);

  // Use the audio clock for all timestamps so they stay in sync with the metronome.
  const audioElapsedMs = (audioCtx.currentTime - recordStartAudioTime) * 1000;
  // Shift events back by input latency so they land on the beat where they were struck.
  const eventTimeMs = Math.max(0, audioElapsedMs - frInputLatencyMs);

  const frameRms = result ? result.rms : 0;
  const flux = prevRms > 0 ? frameRms / prevRms : 99;
  prevRms = frameRms;

  if (result && result.clarity >= CLARITY_THRESHOLD) {
    const label = findClosestNote(result.freq);
    if (label && (audioElapsedMs - lastNoteTime >= DEBOUNCE_MS)) {
      // Rolling flux check: blocks frame-to-frame sustain for as long as the note rings.
      // flux ≈ 1.0 during sustain (RMS barely changing), well below the 1.35 threshold.
      const isGlobalSustain = label === lastDetectedLabel && flux < FLUX_NEW_STRIKE;

      // Per-note gate: blocks re-triggers when other notes played in between.
      // Expires after NOTE_GATE_MS so genuine re-strikes are eventually allowed.
      let isGatedSustain = false;
      const gate = noteGate.get(label);
      if (gate && (audioElapsedMs - gate.time) < NOTE_GATE_MS) {
        if (frameRms / gate.rms < NOTE_RESTRIKE_FLUX) isGatedSustain = true;
      }

      if (!isGlobalSustain && !isGatedSustain) {
        lastNoteTime = audioElapsedMs;
        lastDetectedLabel = label;
        noteGate.set(label, { time: audioElapsedMs, rms: frameRms });
        const event = { id: nextEventId++, label, time: eventTimeMs };
        events.push(event);
        appendCell(event, true);
      }
    }
  }

  // Advance playhead using the same audio clock
  updatePlayhead(audioElapsedMs);

  requestAnimationFrame(detectionLoop);
}

// --- Recording ---

async function startRecording() {
  if (isListening) await turnOffMic();

  try {
    unlockAudio();
    const audioCtx = getAudioCtx();
    if (audioCtx.state === 'suspended') await audioCtx.resume();

    frStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, autoGainControl: false, noiseSuppression: false }
    });

    const source = audioCtx.createMediaStreamSource(frStream);
    frAnalyser = audioCtx.createAnalyser();
    frAnalyser.fftSize = BUFSIZE;
    source.connect(frAnalyser);

    events = [];
    selectedIds.clear();
    lastSelectedId = null;
    clearPlaceholder();
    resetTimeline();
    updateNudgeBtns();

    recordBtn.textContent = '■ Stop';
    recordBtn.classList.add('active');
    playBtn.disabled = true;
    saveBtn.disabled = true;
    discardBtn.disabled = true;

    startCountdown(() => {
      const audioCtx = getAudioCtx();
      recordStartAudioTime = audioCtx.currentTime;

      // Latency comp = half the analyser buffer (average note position in buffer) + device input latency.
      // audioCtx.baseLatency covers hardware I/O round-trip; halving it approximates one-way input latency.
      const sampleRate = audioCtx.sampleRate || 44100;
      frInputLatencyMs = ((BUFSIZE / sampleRate) / 2 + (audioCtx.baseLatency || 0.02) / 2) * 1000;

      lastNoteTime = 0;
      prevRms = 0;
      lastDetectedLabel = null;
      noteGate.clear();
      isRecording = true;

      // Auto-start metronome, anchored to AudioContext time for drift-free sync
      const metroPlayBtn = document.querySelector('#frTransport .t-play-btn');
      if (!frMetroPlaying) {
        startFrMetro(audioCtx.currentTime);
        if (metroPlayBtn) { metroPlayBtn.textContent = '■'; metroPlayBtn.classList.add('active'); }
      }

      requestAnimationFrame(detectionLoop);
    });
  } catch (err) {
    console.error('[FreeRecord] Mic error:', err);
  }
}

function stopRecording() {
  isRecording = false;
  const audioCtx = getAudioCtx();
  recordDuration = (audioCtx.currentTime - recordStartAudioTime) * 1000;

  if (frStream) { frStream.getTracks().forEach(t => t.stop()); frStream = null; }
  frAnalyser = null;

  // Stop metronome when recording ends
  if (frMetroPlaying) {
    stopFrMetro();
    const metroPlayBtn = document.querySelector('#frTransport .t-play-btn');
    if (metroPlayBtn) { metroPlayBtn.textContent = '►'; metroPlayBtn.classList.remove('active'); }
  }

  recordBtn.textContent = '● Record';
  recordBtn.classList.remove('active');

  // Trim trailing empty rows: shrink to the row containing the last note (min MIN_ROWS).
  if (events.length) {
    const bpm = activeGrid?.bpm || 120;
    const beats = activeGrid?.beats || 4;
    const measureMs = (60000 / bpm) * beats;
    const lastNoteRow = Math.floor(Math.max(...events.map(e => e.time)) / measureMs);
    const trimmedRows = Math.max(MIN_ROWS, lastNoteRow + 1);
    timeline.style.minHeight = (trimmedRows * ROW_HEIGHT) + 'px';
    renderLabels();
    recordDuration = Math.min(recordDuration, trimmedRows * measureMs);
  } else {
    updateTimelineHeight();
  }

  const hasEvents = events.length > 0;
  playBtn.disabled = !hasEvents;
  saveBtn.disabled = !hasEvents;
  discardBtn.disabled = !hasEvents;
}

// --- Timeline ---

function getMeasurePx() {
  return timeline.clientWidth || 800;
}

// Compute row/x in beat units to avoid floating-point error compounding across rows.
// Cells are mapped to [CELL_SIZE/2 .. w-CELL_SIZE/2] so beat-1 cells are fully visible.
function getRowPos(timeMs) {
  const bpm = activeGrid?.bpm || 120;
  const beats = activeGrid?.beats || 4;
  const w = getMeasurePx();
  const beatMs = 60000 / bpm;
  const measureMs = beatMs * beats;
  const row = Math.floor(timeMs / measureMs);
  const beatInMeasure = (timeMs - row * measureMs) / beatMs; // 0..beats
  const x = BEAT_MARGIN + (beatInMeasure / beats) * (w - 2 * BEAT_MARGIN);
  return { x, row };
}

function updatePlayhead(timeMs) {
  const { x, row } = getRowPos(timeMs);
  playhead.style.left = x + 'px';
  playhead.style.top = (row * ROW_HEIGHT + 4) + 'px';
  playhead.style.height = (ROW_HEIGHT - 8) + 'px';

  const currentRows = Math.round((parseInt(timeline.style.minHeight) || ROW_HEIGHT * MIN_ROWS) / ROW_HEIGHT);
  // During recording: pre-expand when playhead enters the second-to-last row.
  const neededRows = (isRecording && row >= currentRows - 2)
    ? currentRows + 1
    : Math.max(currentRows, row + 1);
  if (neededRows !== currentRows) {
    timeline.style.minHeight = (neededRows * ROW_HEIGHT) + 'px';
    renderLabels();
  }
}

function updateTimelineHeight() {
  const maxTime = Math.max(
    recordDuration || 0,
    events.length ? Math.max(...events.map(e => e.time)) : 0
  );
  const newRows = maxTime > 0 ? (getRowPos(maxTime).row + 1) : MIN_ROWS;
  const newHeight = Math.max(MIN_ROWS, newRows) * ROW_HEIGHT;
  const prevHeight = parseInt(timeline.style.minHeight) || 0;
  timeline.style.minHeight = newHeight + 'px';
  if (newHeight !== prevHeight) renderLabels();
}

function updateBeatLines() {
  const w = timelineOuter.clientWidth;
  if (!w) return;
  const beats = activeGrid?.beats || 4;
  const sub = activeGrid?.subdivision || 2;
  const beatPx = (w - 2 * BEAT_MARGIN) / beats;
  const subPx = beatPx / sub;
  const layers = [
    `repeating-linear-gradient(180deg, transparent 0px, transparent ${ROW_HEIGHT - 1}px, var(--panel-border) ${ROW_HEIGHT - 1}px, var(--panel-border) ${ROW_HEIGHT}px)`,
    `repeating-linear-gradient(90deg, var(--fr-beat-line) 0px, var(--fr-beat-line) 1px, transparent 1px, transparent ${beatPx}px)`,
  ];
  if (sub > 1) {
    layers.push(`repeating-linear-gradient(90deg, var(--fr-subdiv-line) 0px, var(--fr-subdiv-line) 1px, transparent 1px, transparent ${subPx}px)`);
  }
  timeline.style.backgroundImage = layers.join(', ');
  timeline.style.backgroundPosition = `${BEAT_MARGIN}px 0`;
  renderLabels();
}

function renderLabels() {
  Array.from(timeline.querySelectorAll('.fr-beat-label')).forEach(el => el.remove());
  const w = timelineOuter.clientWidth;
  if (!w) return;
  const beats = activeGrid?.beats || 4;
  const sub = activeGrid?.subdivision || 2;
  const beatPx = (w - 2 * BEAT_MARGIN) / beats;
  const numRows = Math.max(MIN_ROWS, Math.round((parseInt(timeline.style.minHeight) || ROW_HEIGHT * MIN_ROWS) / ROW_HEIGHT));
  const showAnd = sub >= 2;

  for (let r = 0; r < numRows; r++) {
    for (let b = 0; b < beats; b++) {
      const el = document.createElement('div');
      el.className = 'fr-beat-label';
      el.textContent = String(b + 1);
      el.style.left = (BEAT_MARGIN + b * beatPx + 3) + 'px';
      el.style.top = (r * ROW_HEIGHT + 4) + 'px';
      timeline.appendChild(el);

      if (showAnd) {
        const half = document.createElement('div');
        half.className = 'fr-beat-label fr-beat-label-sub';
        half.textContent = '&';
        half.style.left = (BEAT_MARGIN + b * beatPx + beatPx / 2 + 3) + 'px';
        half.style.top = (r * ROW_HEIGHT + 4) + 'px';
        timeline.appendChild(half);
      }
    }
  }
}

function resetTimeline() {
  timeline.innerHTML = '';
  timeline.appendChild(playhead);
  playhead.style.left = '0px';
  playhead.style.top = '4px';
  playhead.style.height = (ROW_HEIGHT - 8) + 'px';
  timeline.style.minHeight = (MIN_ROWS * ROW_HEIGHT) + 'px';
  timelineOuter.scrollTop = 0;
  updateBeatLines();
}

function appendCell(event, animate) {
  const { x, row } = getRowPos(event.time);
  const cell = document.createElement('div');
  cell.className = 'fr-cell' + (animate ? ' fr-cell-new' : '');
  if (selectedIds.has(event.id)) cell.classList.add('fr-cell-selected');
  cell.textContent = event.label === 'Ding' ? 'D' : event.label;
  cell.style.left = (x - CELL_SIZE / 2) + 'px';
  cell.style.top = (row * ROW_HEIGHT + ROW_HEIGHT / 2) + 'px';
  cell.dataset.eventId = event.id;
  timeline.appendChild(cell);

  if (animate) {
    setTimeout(() => cell.classList.remove('fr-cell-new'), 350);
  }
  return cell;
}

function rerenderCells() {
  Array.from(timeline.children).forEach(el => {
    if (el !== playhead && !el.classList.contains('fr-beat-label')) el.remove();
  });
  events.sort((a, b) => a.time - b.time);
  events.forEach(ev => appendCell(ev, false));
  updateTimelineHeight();
}

function clientPosToTime(clientX, clientY) {
  const rect = timeline.getBoundingClientRect();
  const bpm = activeGrid?.bpm || 120;
  const beats = activeGrid?.beats || 4;
  const w = getMeasurePx();
  const beatMs = 60000 / bpm;
  const measureMs = beatMs * beats;
  const localX = Math.max(0, Math.min(w - 1, clientX - rect.left));
  const localY = Math.max(0, clientY - rect.top);
  const row = Math.floor(localY / ROW_HEIGHT);
  const beatFraction = Math.max(0, Math.min(1, (localX - BEAT_MARGIN) / (w - 2 * BEAT_MARGIN)));
  return Math.max(0, row * measureMs + beatFraction * measureMs);
}

function updateNudgeBtns() {
  const hasSelection = selectedIds.size > 0;
  if (nudgeLeftBtn) nudgeLeftBtn.disabled = !hasSelection;
  if (nudgeRightBtn) nudgeRightBtn.disabled = !hasSelection;
}

// --- Snap ---

function snapTimeToGrid(timeMs) {
  const bpm = activeGrid?.bpm || 120;
  const sub = activeGrid?.subdivision || 2;
  const snapMs = (60000 / bpm) / sub;
  return Math.round(timeMs / snapMs) * snapMs;
}

function snapSelected() {
  if (!selectedIds.size) return;
  events.forEach(ev => {
    if (selectedIds.has(ev.id)) ev.time = snapTimeToGrid(ev.time);
  });
  rerenderCells();
}

// --- Placeholder ---

function setPlaceholder(timeMs) {
  clearPlaceholder();
  placeholderTime = timeMs;
  const { x, row } = getRowPos(timeMs);
  placeholderEl = document.createElement('div');
  placeholderEl.className = 'fr-cell fr-cell-placeholder';
  placeholderEl.style.left = (x - CELL_SIZE / 2) + 'px';
  placeholderEl.style.top = (row * ROW_HEIGHT + ROW_HEIGHT / 2) + 'px';
  timeline.appendChild(placeholderEl);
  timeline.style.minHeight = Math.max(
    parseInt(timeline.style.minHeight) || ROW_HEIGHT,
    (row + 1) * ROW_HEIGHT
  ) + 'px';
}

function clearPlaceholder() {
  placeholderEl?.remove();
  placeholderEl = null;
  placeholderTime = null;
}

function fillPlaceholder(noteLabel) {
  if (placeholderTime === null) return;
  const timeMs = placeholderTime;
  clearPlaceholder();
  const event = { id: nextEventId++, label: noteLabel, time: timeMs };
  events.push(event);
  events.sort((a, b) => a.time - b.time);
  appendCell(event, true);
  playBtn.disabled = false;
  saveBtn.disabled = false;
  discardBtn.disabled = false;
}

// --- Playback ---

function playRecording(evts, dur, triggerBtn = playBtn) {
  stopPlayback();
  timelineOuter.scrollTop = 0;
  updatePlayhead(0);
  updateTimelineHeight();

  isPlaying = true;
  activePlayBtn = triggerBtn;
  triggerBtn.textContent = '■ Stop';

  timeline.querySelectorAll('.fr-cell').forEach(c => c.classList.remove('fr-cell-active'));

  evts.forEach(ev => {
    const t = setTimeout(() => {
      playNoteByLabel(ev.label, null);
      const cell = timeline.querySelector(`.fr-cell[data-event-id="${ev.id}"]`);
      if (cell) {
        cell.classList.add('fr-cell-active');
        setTimeout(() => cell.classList.remove('fr-cell-active'), 400);
      }
    }, ev.time);
    playbackTimers.push(t);
  });

  // Auto-stop when playback finishes
  const endTimer = setTimeout(() => stopPlayback(), dur + 650);
  playbackTimers.push(endTimer);

  const startTs = Date.now();
  function animatePlayhead() {
    const elapsed = Date.now() - startTs;
    updatePlayhead(elapsed);
    if (elapsed < dur + 600) {
      playheadRAF = requestAnimationFrame(animatePlayhead);
    }
  }
  playheadRAF = requestAnimationFrame(animatePlayhead);
}

function stopPlayback() {
  playbackTimers.forEach(t => clearTimeout(t));
  playbackTimers = [];
  if (playheadRAF) { cancelAnimationFrame(playheadRAF); playheadRAF = null; }

  if (isPlaying) {
    isPlaying = false;
    if (activePlayBtn === playBtn) {
      playBtn.textContent = '▶ Play';
    } else if (activePlayBtn) {
      activePlayBtn.textContent = '▶';
    }
    activePlayBtn = null;
  }
}

// --- Discard ---

function discardRecording() {
  stopPlayback();
  events = [];
  selectedIds.clear();
  lastSelectedId = null;
  clearPlaceholder();
  recordDuration = 0;
  resetTimeline();
  playBtn.disabled = true;
  saveBtn.disabled = true;
  discardBtn.disabled = true;
  updateNudgeBtns();
}

// --- Save / Load ---

function getSaved() {
  try { return JSON.parse(localStorage.getItem('freeRecordings') || '[]'); } catch { return []; }
}

function saveRecording() {
  if (!events.length) return;

  const rec = {
    id: Date.now().toString(),
    name: `Recording ${new Date().toLocaleString()}`,
    events: [...events],
    duration: recordDuration,
    createdAt: new Date().toISOString()
  };

  const saved = getSaved();
  saved.unshift(rec);
  localStorage.setItem('freeRecordings', JSON.stringify(saved));

  saveBtn.disabled = true;
  renderSavedList();
}

function renderSavedList() {
  const saved = getSaved();
  savedList.innerHTML = '';

  if (!saved.length) {
    const empty = document.createElement('p');
    empty.className = 'fr-empty';
    empty.textContent = 'No saved recordings yet.';
    savedList.appendChild(empty);
    return;
  }

  saved.forEach(rec => {
    const row = document.createElement('div');
    row.className = 'fr-saved-row';
    row.dataset.id = rec.id;

    const name = document.createElement('span');
    name.className = 'fr-saved-name';
    name.textContent = rec.name;

    const dur = document.createElement('span');
    dur.className = 'fr-saved-dur';
    dur.textContent = (rec.duration / 1000).toFixed(1) + 's · ' + rec.events.length + ' notes';

    const playBtnEl = document.createElement('button');
    playBtnEl.className = 'fr-saved-action-btn';
    playBtnEl.textContent = '▶';
    playBtnEl.dataset.id = rec.id;
    playBtnEl.dataset.action = 'play';

    const delBtnEl = document.createElement('button');
    delBtnEl.className = 'fr-saved-action-btn fr-saved-delete-btn';
    delBtnEl.textContent = '✕';
    delBtnEl.dataset.id = rec.id;
    delBtnEl.dataset.action = 'delete';

    row.appendChild(name);
    row.appendChild(dur);
    row.appendChild(playBtnEl);
    row.appendChild(delBtnEl);
    savedList.appendChild(row);
  });
}

function loadRecording(rec) {
  if (isRecording) stopRecording();
  stopPlayback();
  events = [];
  selectedIds.clear();
  lastSelectedId = null;
  recordDuration = rec.duration;
  resetTimeline();
  updateNudgeBtns();
  events = rec.events.map(ev => ({ ...ev, id: nextEventId++ }));
  events.forEach(ev => appendCell(ev, false));
  updateTimelineHeight();
  playBtn.disabled = false;
  saveBtn.disabled = true;
  discardBtn.disabled = false;
}

savedList?.addEventListener('click', e => {
  if (e.target.closest('[data-action="delete"]')) {
    const id = e.target.closest('[data-action="delete"]').dataset.id;
    const updated = getSaved().filter(r => r.id !== id);
    localStorage.setItem('freeRecordings', JSON.stringify(updated));
    renderSavedList();
    return;
  }

  const playActionBtn = e.target.closest('[data-action="play"]');
  if (playActionBtn) {
    if (isPlaying && activePlayBtn === playActionBtn) { stopPlayback(); return; }
    const rec = getSaved().find(r => r.id === playActionBtn.dataset.id);
    if (!rec) return;
    loadRecording(rec);
    playRecording(events, recordDuration, playActionBtn);
    return;
  }

  const row = e.target.closest('.fr-saved-row');
  if (row) {
    const rec = getSaved().find(r => r.id === row.dataset.id);
    if (rec) loadRecording(rec);
  }
});

// --- View Open / Close ---

export function openFreeRecordView() {
  view.style.display = 'flex';
  document.getElementById('accountDropdownMenu')?.classList.remove('open', 'show');
  // Move handpan into free-record view
  if (handpanWrapEl && frHandpanSlot && !frHandpanSlot.contains(handpanWrapEl)) {
    handpanWrapOrigParent = handpanWrapEl.parentNode;
    handpanWrapOrigNextSibling = handpanWrapEl.nextSibling;
    frHandpanSlot.appendChild(handpanWrapEl);
  }
  if (frTsBeatsEl) frTsBeatsEl.value = activeGrid?.beats || 4;
  if (frTsSubEl) frTsSubEl.value = activeGrid?.subdivision || 2;
  updateBeatLines();
  renderSavedList();
}

export function closeFreeRecordView() {
  if (isRecording) stopRecording();
  stopPlayback();
  stopFrMetro();
  clearPlaceholder();
  const metroPlayBtn = document.querySelector('#frTransport .t-play-btn');
  if (metroPlayBtn) { metroPlayBtn.textContent = '►'; metroPlayBtn.classList.remove('active'); }
  // Restore handpan to original position
  if (handpanWrapEl && handpanWrapOrigParent) {
    handpanWrapOrigParent.insertBefore(handpanWrapEl, handpanWrapOrigNextSibling);
    handpanWrapOrigParent = null;
    handpanWrapOrigNextSibling = null;
  }
  view.style.display = 'none';
}

// --- Selection ---

timeline.addEventListener('click', e => {
  if (wasDragging) { wasDragging = false; return; }
  if (isPlaying || isRecording) return;
  const cell = e.target.closest('.fr-cell');
  if (!cell) return;
  const id = parseInt(cell.dataset.eventId);
  if (isNaN(id)) return;

  const isMeta = e.metaKey || e.ctrlKey;
  const isShift = e.shiftKey;

  if (isShift && lastSelectedId !== null) {
    // Range select: select all events between lastSelectedId and id (by time order)
    const sorted = [...events].sort((a, b) => a.time - b.time);
    const idxA = sorted.findIndex(ev => ev.id === lastSelectedId);
    const idxB = sorted.findIndex(ev => ev.id === id);
    if (idxA !== -1 && idxB !== -1) {
      const lo = Math.min(idxA, idxB);
      const hi = Math.max(idxA, idxB);
      sorted.slice(lo, hi + 1).forEach(ev => selectedIds.add(ev.id));
    }
    // Don't update lastSelectedId on shift-click
  } else if (isMeta) {
    // Toggle this cell without clearing others
    if (selectedIds.has(id)) selectedIds.delete(id);
    else selectedIds.add(id);
    lastSelectedId = id;
  } else {
    // Plain click: select only this cell
    selectedIds.clear();
    selectedIds.add(id);
    lastSelectedId = id;
  }

  rerenderCells();
  updateNudgeBtns();
  if (snapActive) snapSelected();
});

// --- Snap button ---

snapBtn?.addEventListener('click', () => {
  if (selectedIds.size) {
    snapSelected();
  } else {
    snapActive = !snapActive;
    snapBtn.classList.toggle('active', snapActive);
  }
});

// --- Nudge ---

nudgeLeftBtn?.addEventListener('click', () => nudgeSelected(-1));
nudgeRightBtn?.addEventListener('click', () => nudgeSelected(1));

function nudgeSelected(direction) {
  if (!selectedIds.size) return;
  const bpm = activeGrid?.bpm || 120;
  const step = Math.round(60000 / bpm / 4); // 16th-note step
  events.forEach(ev => {
    if (selectedIds.has(ev.id)) ev.time = Math.max(0, ev.time + direction * step);
  });
  rerenderCells();
}

// --- Drag and Drop ---

view?.addEventListener('pointerdown', e => {
  if (isPlaying || isRecording) return;
  const isRealCell = !!e.target.closest('.fr-cell:not(.fr-cell-placeholder)');
  const isOnTimeline = !!e.target.closest('#frTimeline');
  const isOnActionBar = !!e.target.closest('.fr-action-bar');
  if (!isRealCell && !isOnActionBar && selectedIds.size) {
    selectedIds.clear();
    lastSelectedId = null;
    rerenderCells();
    updateNudgeBtns();
  }
  if (!isOnTimeline && !e.target.closest('#frHandpanSlot')) clearPlaceholder();
});

timeline.addEventListener('pointerdown', e => {
  const cell = e.target.closest('.fr-cell:not(.fr-cell-placeholder)');
  if (!cell) {
    if (!isPlaying && !isRecording) setPlaceholder(clientPosToTime(e.clientX, e.clientY));
    return;
  }

  if (isPlaying || isRecording) return;
  const id = parseInt(cell.dataset.eventId);
  if (isNaN(id)) return;

  // Modifier keys mean multi-select — let the click handler manage selection, skip drag setup
  if (e.metaKey || e.ctrlKey || e.shiftKey) return;

  clearPlaceholder();

  if (!selectedIds.has(id)) {
    selectedIds.clear();
    selectedIds.add(id);
    rerenderCells();
    updateNudgeBtns();
  }
  lastSelectedId = id;

  dragEventIds = new Set(selectedIds);
  dragStartTimes = new Map(events.filter(ev => dragEventIds.has(ev.id)).map(ev => [ev.id, ev.time]));
  dragAnchorTime = clientPosToTime(e.clientX, e.clientY);
  isDragging = false;
  activeDragPointerId = e.pointerId;
  e.preventDefault();
});

document.addEventListener('pointermove', e => {
  if (!dragEventIds || e.pointerId !== activeDragPointerId) return;
  const newTime = clientPosToTime(e.clientX, e.clientY);
  const delta = newTime - dragAnchorTime;
  if (Math.abs(delta) > 20) isDragging = true;
  if (!isDragging) return;

  events.forEach(ev => {
    if (dragEventIds.has(ev.id)) ev.time = Math.max(0, (dragStartTimes.get(ev.id) || 0) + delta);
  });
  rerenderCells();

  Array.from(timeline.querySelectorAll('.fr-cell')).forEach(c => {
    if (dragEventIds.has(parseInt(c.dataset.eventId))) c.classList.add('fr-cell-dragging');
  });
});

document.addEventListener('pointerup', e => {
  if (!dragEventIds || e.pointerId !== activeDragPointerId) return;
  wasDragging = isDragging;
  dragEventIds = null;
  dragStartTimes = null;
  dragAnchorTime = null;
  isDragging = false;
  activeDragPointerId = null;
  rerenderCells();
  if (snapActive) snapSelected();
});

document.addEventListener('pointercancel', e => {
  if (!dragEventIds || e.pointerId !== activeDragPointerId) return;
  events.forEach(ev => { if (dragStartTimes.has(ev.id)) ev.time = dragStartTimes.get(ev.id); });
  wasDragging = false;
  dragEventIds = null;
  dragStartTimes = null;
  dragAnchorTime = null;
  isDragging = false;
  activeDragPointerId = null;
  rerenderCells();
});

// --- Button Wiring ---

backBtn?.addEventListener('click', closeFreeRecordView);
openBtn?.addEventListener('click', openFreeRecordView);

recordBtn?.addEventListener('click', () => {
  if (isRecording) stopRecording();
  else startRecording();
});

playBtn?.addEventListener('click', () => {
  if (isPlaying) stopPlayback();
  else if (events.length) playRecording(events, recordDuration, playBtn);
});

saveBtn?.addEventListener('click', saveRecording);
discardBtn?.addEventListener('click', discardRecording);

// Time signature / subdivision controls in FR header
frTsBeatsEl?.addEventListener('change', () => {
  const val = parseInt(frTsBeatsEl.value) || 4;
  setBeats(val, activeGrid);
  const orig = document.getElementById('tsBeats');
  if (orig) orig.value = val;
  Bus.emit(BUS_EVENT.GRID_CHANGED);
});

frTsSubEl?.addEventListener('change', () => {
  const val = parseInt(frTsSubEl.value) || 2;
  setSubdivision(val, activeGrid);
  const orig = document.getElementById('tsSub');
  if (orig && orig.querySelector(`option[value="${val}"]`)) orig.value = val;
  updateBeatLines();
});

// Mutual exclusion: if mic button is clicked while recording, stop
document.getElementById('micBtn')?.addEventListener('click', () => {
  if (isRecording) stopRecording();
});

// Redraw beat lines whenever BPM / time sig changes
Bus.on(BUS_EVENT.GRID_CHANGED, () => {
  if (view.style.display !== 'none' && view.style.display !== '') {
    updateBeatLines();
    rerenderCells();
  }
});

// Reflow on container resize (e.g. window resize)
if (typeof ResizeObserver !== 'undefined') {
  let resizeRAF = null;
  new ResizeObserver(() => {
    if (resizeRAF) return;
    resizeRAF = requestAnimationFrame(() => {
      resizeRAF = null;
      if (view.style.display !== 'none' && view.style.display !== '') {
        updateBeatLines();
        rerenderCells();
      }
    });
  }).observe(timelineOuter);
}

// 'n' snaps selected cells when free-record view is open
document.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyN') return;
  if (!view || view.style.display === 'none' || view.style.display === '') return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (selectedIds.size) snapSelected();
});

// Escape clears selection when free-record view is open
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Escape') return;
  if (!view || view.style.display === 'none' || view.style.display === '') return;
  if (!selectedIds.size) return;
  selectedIds.clear();
  lastSelectedId = null;
  rerenderCells();
  updateNudgeBtns();
});

// Spacebar controls free-record playback when the view is open
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space') return;
  if (!view || view.style.display === 'none' || view.style.display === '') return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (isPlaying) stopPlayback();
  else if (events.length) playRecording(events, recordDuration, playBtn);
}, { capture: true });

// --- Handpan Interceptors ---
// When FR view is open: play the note, fill any placeholder, prevent grid write.

function frResolveNote(rawNote) {
  return (rawNote === 'T_R' || rawNote === 'T_L') ? 'T'
       : (rawNote === 'S_R' || rawNote === 'S_L') ? 'S'
       : rawNote;
}

function frHandpanClickInterceptor(e) {
  if (!view || view.style.display === 'none' || view.style.display === '') return;
  const dot = e.target?.closest('.hp-dot');
  if (!dot?.dataset.note) return;
  const note = frResolveNote(dot.dataset.note);
  playNoteByLabel(note, null);
  if (placeholderTime !== null) fillPlaceholder(note);
  e.stopImmediatePropagation(); // prevent writeToSession in handpanmap.js
}

function frHandpanTouchInterceptor(e) {
  if (!view || view.style.display === 'none' || view.style.display === '') return;
  for (const touch of e.changedTouches) {
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const dot = el?.closest('.hp-dot');
    if (!dot?.dataset.note) continue;
    const note = frResolveNote(dot.dataset.note);
    playNoteByLabel(note, null);
    if (placeholderTime !== null) fillPlaceholder(note);
    e.stopImmediatePropagation();
    e.preventDefault();
    break;
  }
}

handpanOverlayEl?.addEventListener('click', frHandpanClickInterceptor, { capture: true });
handpanOverlayBotEl?.addEventListener('click', frHandpanClickInterceptor, { capture: true });
handpanOverlayEl?.addEventListener('touchstart', frHandpanTouchInterceptor, { capture: true, passive: false });
handpanOverlayBotEl?.addEventListener('touchstart', frHandpanTouchInterceptor, { capture: true, passive: false });
