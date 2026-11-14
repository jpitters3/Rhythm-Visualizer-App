// Chord listen: Transcribe. A count-in sets the tempo and where beat 1 is; every
// note heard after it is kept at its exact time and shown on a live strip. On
// stop, js/transcribe-quantize.js places the notes on a grid (triplets
// included), ready to send to the Studio as a phrase.
import { stopRecord } from './listen-clips.js';
import { setMultiNote, setNoteChoice } from './listen-engine.js';
import { labelToNote, noteName, panNotes } from './listen-notes.js';
import { startMic, stopLive } from './listen-play.js';
import { each, listening, prefs, session, setMode, setTask, state } from './listen-state.js';
import { els, renderMode, reply } from './listen-view.js';
import { updateChordShapeDiagram } from './chord-shape-diagram.js';
import { updateCurrentPhraseName } from './controls.js';
import { setVisible } from './dom.js';
import { guardBeforeReplacingGrid } from './lesson-settings.js';
import { getAudioCtx, metroClick, playNoteByLabel, unlockAudio } from './noteplayer.js';
import { applyPattern } from './pattern-crud.js';
import { navigate } from './router.js';
import { findOffset, quantize } from './transcribe-quantize.js';

const SETTINGS_KEY = 'gp_listenTranscribe';
const MULTI_KEY = 'gp_listenTranscribeMulti';
const BEAT_PX = 56; // the live strip's width per beat
const LIT_MS = 350; // how long a heard note stays lit on the pan
const EARLY_SHARE = 0.15; // a note this much of a beat before "1" is on it
const COUNT_IN_LEAD_MS = 150;
const GRID_NAMES = { 1: 'quarter notes', 2: '8th notes', 3: 'triplets', 4: '16th notes' };
const LOOKAHEAD_MS = 120; // sounds are scheduled this far ahead on the audio clock
const PLAYBACK_MUTE_MS = 1800; // the playback's ring must not be heard as notes

// phase: 'setup' | 'countin' | 'recording' | 'done'
const tx = {
  bpm: 90, beatsPerBar: 4, click: true, metro: false, nextClick: 0,
  lag: 0, shift: 0, moves: [], history: [], take: 0, played: [], // ms the speakers trail the clock; beats every note was moved
  phase: 'setup', downbeat: 0, notes: [], grid: 'auto', result: null,
  raf: null, shownBeat: null, taps: [], lit: new Map(),
};

const beatMs = () => 60000 / tx.bpm;
// Where "1" was heard: the click reaches the player late through the speakers
// (Bluetooth most), so they play late by as much
const heardDownbeat = () => tx.downbeat + tx.lag;
const audioNow = () => (getAudioCtx()?.currentTime ?? 0) * 1000;

export const transcribing = () => state.mode === 'transcribe' && (tx.phase === 'countin' || tx.phase === 'recording');

export function loadTranscribeSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    if (saved.bpm) tx.bpm = saved.bpm;
    if (saved.beatsPerBar) tx.beatsPerBar = saved.beatsPerBar;
    if (typeof saved.click === 'boolean') tx.click = saved.click;
    tx.metro = saved.metro === true;
    prefs.transcribeMulti = localStorage.getItem(MULTI_KEY) !== '0';
  } catch { /* private mode: defaults */ }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ bpm: tx.bpm, beatsPerBar: tx.beatsPerBar, click: tx.click, metro: tx.metro }));
    localStorage.setItem(MULTI_KEY, prefs.transcribeMulti ? '1' : '0');
  } catch { /* private mode */ }
}

// Transcribe hears every clear note by default (chords, melody over a bass);
// single-note picks the clearest, the higher of two. Octave overtones stay out.
export function applyNoteChoice() {
  if (state.mode === 'transcribe') {
    setNoteChoice({ pick: 'clearest', guardOctaves: true, spectralChords: true });
    setMultiNote(prefs.transcribeMulti);
  } else {
    setNoteChoice();
    setMultiNote(prefs.multi);
  }
}

export function setTranscribeMulti(on) {
  prefs.transcribeMulti = on;
  saveSettings();
  applyNoteChoice();
  renderMode();
}

export function openTranscribe() {
  if (state.mode === 'transcribe') return;
  if (session.recording) stopRecord();
  if (state.mode === 'live') stopLive();
  each('beforeLive'); // side jobs end
  if (state.task) setTask(null);
  setMode('transcribe');
  applyNoteChoice();
  renderMode();
}

export function closeTranscribe() {
  if (state.mode !== 'transcribe') return;
  if (transcribing()) stopTranscribing();
  stopPlayback();
  setMode('capture');
  applyNoteChoice();
  renderMode();
}

export function setTempo(bpm) {
  tx.bpm = Math.max(40, Math.min(220, Math.round(bpm) || tx.bpm));
  saveSettings();
  renderMode();
}

export function setBeatsPerBar(n) {
  tx.beatsPerBar = Number(n) || 4;
  saveSettings();
  renderMode();
}

export function setCountInClick(on) {
  tx.click = on;
  saveSettings();
}

// The click carries on after the count-in (for headphones)
export function setMetronome(on) {
  tx.metro = on;
  saveSettings();
}

// Tap tempo: the steady gap between the last few taps
export function tapTempo() {
  const now = performance.now();
  tx.taps = [...tx.taps.filter(t => now - t < 2500), now].slice(-5);
  if (tx.taps.length < 3) return;
  const gaps = tx.taps.slice(1).map((t, i) => t - tx.taps[i]).sort((a, b) => a - b);
  setTempo(60000 / gaps[Math.floor(gaps.length / 2)]);
}

export async function startTranscribing() {
  unlockAudio();
  if (!listening()) await startMic();
  if (!listening() || state.mode !== 'transcribe') return;
  stopPlayback();
  applyNoteChoice();
  const startAt = audioNow() + COUNT_IN_LEAD_MS;
  tx.downbeat = startAt + tx.beatsPerBar * beatMs();
  const ctx = getAudioCtx();
  tx.lag = ((ctx?.outputLatency || 0) + (ctx?.baseLatency || 0)) * 1000;
  tx.shift = 0;
  tx.moves = [];
  tx.history = [];
  tx.take++;
  tx.notes = [];
  tx.result = null;
  tx.grid = 'auto';
  tx.phase = 'countin';
  tx.shownBeat = null;
  tx.nextClick = 0;
  if (tx.click) {
    const ctxNow = audioNow();
    for (let b = 0; b < tx.beatsPerBar; b++) metroClick(b === 0 ? 'downbeat' : 'beat', (startAt + b * beatMs() - ctxNow) / 1000);
  }
  clearStrip();
  cancelAnimationFrame(tx.raf);
  tick();
  renderMode();
}

export function stopTranscribing() {
  cancelAnimationFrame(tx.raf);
  tx.raf = null;
  tx.phase = tx.notes.length ? 'done' : 'setup';
  tx.played = tx.notes.slice(); // as played, before any edits
  els.pulse.querySelectorAll('.on').forEach(d => d.classList.remove('on'));
  els.txStrip.scrollLeft = 0; // the whole take, from its start
  if (tx.notes.length) requantize();
  renderMode();
  if (tx.notes.length) reply(`Transcribed ${tx.notes.length} note${tx.notes.length === 1 ? '' : 's'}. Check the grid (tap a note to select it, drag to move), then send it to the Studio.`);
}

export function setGrid(grid) {
  stopPlayback();
  tx.grid = grid === 'auto' ? 'auto' : Number(grid);
  requantize();
  renderMode();
}

// Every note one grid step earlier (-1) or later (+1): when "1" was heard elsewhere.
// Auto may pick another grid after a move, so a step back undoes the last move exactly.
export function nudgeNotes(dir) {
  if (!tx.result) return;
  stopPlayback();
  const last = tx.moves.at(-1);
  if (last && Math.sign(last) !== dir) tx.moves.pop();
  else tx.moves.push(dir / tx.result.subdivision);
  tx.shift = Math.round(tx.moves.reduce((a, b) => a + b, 0) * 12) / 12;
  requantize();
  renderMode();
}

// "1" as the t-grid places notes: where it was heard, less the player's moves
const placedDownbeat = () => heardDownbeat() - tx.shift * beatMs();

// The player's feel: the notes as played, against the "1" they heard. Edits and
// shifts don't change it, so moved notes land exactly on their step.
function requantize() {
  const downbeat = placedDownbeat();
  const offset = findOffset(tx.played.map(n => (n.at - heardDownbeat()) / beatMs()));
  tx.result = quantize(tx.notes, { bpm: tx.bpm, beatsPerBar: tx.beatsPerBar, downbeat, grid: tx.grid, offset });
  renderResult();
}

// 1/3 → "⅓ beat", 5/4 → "1¼ beats"
const FRACTIONS = { 3: '¼', 4: '⅓', 6: '½', 8: '⅔', 9: '¾' };
function beatsText(beats) {
  const twelfths = Math.round(Math.abs(beats) * 12);
  const whole = Math.floor(twelfths / 12);
  const part = twelfths % 12;
  const text = `${whole || (part ? '' : '0')}${part ? FRACTIONS[part] ?? `${part}/12` : ''}`;
  return `${text} beat${whole >= 1 && (whole > 1 || part) ? 's' : ''}`;
}

// The count-in, the pulse and the strip's playhead, on the audio clock
function tick() {
  tx.raf = requestAnimationFrame(tick);
  const beatPos = (audioNow() - tx.downbeat) / beatMs();
  if (tx.phase === 'countin' && beatPos >= -EARLY_SHARE) {
    tx.phase = 'recording';
    renderMode();
  }
  const beat = Math.floor(beatPos + 0.02);
  if (beat !== tx.shownBeat) {
    tx.shownBeat = beat;
    showBeat(beat);
    renderStage();
  }
  if (tx.phase === 'recording') moveHead(beatPos);
  if (tx.metro) scheduleClicks();
  if (tx.lit.size) fadeLit();
}

// The metronome while playing: each beat after the count-in, just ahead of time
function scheduleClicks() {
  const now = audioNow();
  let at = tx.downbeat + tx.nextClick * beatMs();
  while (at < now + LOOKAHEAD_MS) {
    if (at >= now) metroClick(tx.nextClick % tx.beatsPerBar === 0 ? 'downbeat' : 'beat', (at - now) / 1000);
    tx.nextClick++;
    at = tx.downbeat + tx.nextClick * beatMs();
  }
}

function ensurePulseDots() {
  if (els.pulse.childElementCount === tx.beatsPerBar) return;
  els.pulse.replaceChildren(...Array.from({ length: tx.beatsPerBar }, () => {
    const dot = document.createElement('span');
    dot.className = 'cl-pulse-dot';
    return dot;
  }));
}

function showBeat(beat) {
  ensurePulseDots();
  const n = tx.beatsPerBar;
  [...els.pulse.children].forEach((d, i) => d.classList.toggle('on', i === ((beat % n) + n) % n));
  els.stage.classList.remove('beat');
  void els.stage.offsetWidth; // restart the ring animation
  els.stage.classList.add('beat');
  if (beat >= 0) setLaneWidth(beat + 2);
}

function fadeLit() {
  const now = performance.now();
  let changed = false;
  tx.lit.forEach((t, label) => {
    if (now - t > LIT_MS) { tx.lit.delete(label); changed = true; }
  });
  if (changed) renderStage();
}

// --- The live strip: each note at its real time, low notes at the bottom ---

function clearStrip() {
  els.txLane.querySelectorAll('.cl-tx-note, .cl-tx-bar-line').forEach(n => n.remove());
  els.txLane.style.setProperty('--beat-px', `${BEAT_PX}px`);
  els.txLane.style.setProperty('--bar-px', `${BEAT_PX * tx.beatsPerBar}px`);
  setLaneWidth(tx.beatsPerBar * 2);
  moveHead(0);
  els.txStrip.scrollLeft = 0;
}

function setLaneWidth(beats) {
  const width = Math.max(beats * BEAT_PX, els.txStrip.clientWidth);
  if (els.txLane.dataset.width !== String(width)) {
    els.txLane.dataset.width = String(width);
    els.txLane.style.setProperty('--lane-width', `${width}px`);
  }
}

function moveHead(beatPos) {
  const x = Math.max(0, beatPos) * BEAT_PX;
  els.txHead.style.setProperty('--x', `${x.toFixed(1)}px`);
  const view = els.txStrip;
  if (x > view.scrollLeft + view.clientWidth * 0.75) view.scrollLeft = x - view.clientWidth * 0.5;
}

function addStripNote(label, beatPos) {
  const notes = panNotes();
  const row = Math.max(0, notes.findIndex(n => n.label === label));
  const el = document.createElement('span');
  el.className = 'cl-tx-note';
  el.textContent = noteName(labelToNote(label) || '');
  el.style.setProperty('--x', `${(Math.max(0, beatPos) * BEAT_PX).toFixed(1)}px`);
  el.style.setProperty('--y', String(notes.length > 1 ? row / (notes.length - 1) : 0.5));
  els.txLane.appendChild(el);
}

// --- What the stage shows while transcribing ---

function renderStage() {
  updateChordShapeDiagram(els.bigDiagram, [...tx.lit.keys()]);
  let slot = 'Transcribe';
  let name = '';
  if (tx.phase === 'countin') {
    slot = 'Count-in';
    name = tx.shownBeat == null ? '' : String(tx.shownBeat + tx.beatsPerBar + 1);
  } else if (tx.phase === 'recording') {
    slot = `Bar ${Math.floor(Math.max(0, tx.shownBeat ?? 0) / tx.beatsPerBar) + 1}`;
    name = [...tx.lit.keys()].map(l => noteName(labelToNote(l) || '')).join(' · ') || '…';
  } else if (tx.phase === 'done') {
    name = tx.lit.size ? [...tx.lit.keys()].map(l => noteName(labelToNote(l) || '')).join(' · ') : `${tx.notes.length} notes`;
  } else {
    name = listening() ? 'Ready' : '';
  }
  els.slot.textContent = slot;
  els.name.textContent = name;
  els.notes.textContent = `${tx.bpm} BPM · ${tx.beatsPerBar}/4`;
  els.stage.classList.toggle('has-chord', !!name);
}

// --- The result: the phrase in measures of circles ---

function renderResult() {
  const r = tx.result;
  if (!r) return;
  els.txResult.querySelectorAll('.cl-tx-grid').forEach(b => b.classList.toggle('active', b.dataset.grid === String(tx.grid)));
  const bits = [`${r.measures} bar${r.measures === 1 ? '' : 's'} in ${GRID_NAMES[r.subdivision]}${tx.grid === 'auto' ? ', picked to fit your playing' : ''}.`];
  const tripletBeats = [...r.beatGrids.values()].filter(s => s === 3).length;
  if (tx.grid === 'auto' && tripletBeats && r.subdivision !== 3) bits.push(`${tripletBeats} beat${tripletBeats === 1 ? ' was' : 's were'} played as triplets.`);
  if (r.rounded) bits.push(`${r.rounded} note${r.rounded === 1 ? '' : 's'} moved to fit.`);
  if (r.dropped) bits.push(`${r.dropped} before the first beat left out.`);
  els.txSummary.textContent = bits.join(' ');
  els.txShiftText.textContent = tx.shift ? `${beatsText(tx.shift)} ${tx.shift < 0 ? 'earlier' : 'later'}` : 'Move all notes';

  const stepsPerBar = tx.beatsPerBar * r.subdivision;
  const bars = [];
  for (let m = 0; m < r.measures; m++) {
    const bar = document.createElement('div');
    bar.className = 'cl-tx-bar';
    const num = document.createElement('span');
    num.className = 'cl-tx-bar-n';
    num.textContent = String(m + 1);
    const cells = document.createElement('div');
    cells.className = 'cl-tx-cells';
    cells.style.setProperty('--steps', String(stepsPerBar));
    for (let i = 0; i < stepsPerBar; i++) {
      const step = r.steps[m * stepsPerBar + i];
      const cell = document.createElement('span');
      cell.className = 'cl-tx-cell';
      cell.dataset.step = String(m * stepsPerBar + i);
      cell.classList.toggle('is-beat', i % r.subdivision === 0);
      const labels = Array.isArray(step) ? step : step ? [step] : [];
      cell.classList.toggle('has-note', labels.length > 0);
      labels.forEach((l) => {
        const n = document.createElement('span');
        n.textContent = noteName(labelToNote(l) || '');
        cell.appendChild(n);
      });
      cells.appendChild(cell);
    }
    bar.append(num, cells);
    bars.push(bar);
  }
  els.txPhrase.replaceChildren(...bars);
}

// --- Editing the t-grid (js/listen-tgrid.js): changes are to the notes' times,
// so they survive a new grid or shift ---

export const tgridResult = () => (state.mode === 'transcribe' && tx.phase === 'done' ? tx.result : null);
export const tgridTake = () => tx.take;
export const beatLength = () => beatMs();

// When a step of the t-grid is played (ms, on the notes' clock)
export function stepTime(step) {
  const r = tx.result;
  return placedDownbeat() + (step / r.subdivision + r.offset) * beatMs();
}

// change(notes) returns the new notes; each change can be undone
export function editNotes(change) {
  if (!tx.result) return;
  stopPlayback();
  tx.history.push(tx.notes);
  tx.notes = change(tx.notes.slice());
  requantize();
  renderMode();
}

export const canUndoEdit = () => tx.history.length > 0;

export function undoEdit() {
  if (!tx.history.length) return;
  stopPlayback();
  tx.notes = tx.history.pop();
  requantize();
  renderMode();
}

// --- Playing the result back: the grid as it would go to the Studio ---

const play = { raf: null, start: 0, next: 0, shown: -1 };

export const playingBack = () => play.raf != null;

export function togglePlayback() {
  if (playingBack()) stopPlayback();
  else startPlayback();
}

function startPlayback() {
  if (!tx.result) return;
  unlockAudio();
  play.start = audioNow() + COUNT_IN_LEAD_MS;
  play.next = 0;
  play.shown = -1;
  playTick();
  renderPlayButton();
}

export function stopPlayback() {
  if (!playingBack()) return;
  cancelAnimationFrame(play.raf);
  play.raf = null;
  els.txPhrase.querySelectorAll('.playing').forEach(c => c.classList.remove('playing'));
  renderPlayButton();
}

const stepLabels = s => (Array.isArray(s) ? s : s ? [s] : []);

function playTick() {
  play.raf = requestAnimationFrame(playTick);
  const r = tx.result;
  const stepMs = beatMs() / r.subdivision;
  const now = audioNow();
  while (play.next < r.steps.length && play.start + play.next * stepMs < now + LOOKAHEAD_MS) {
    const i = play.next++;
    const delay = Math.max(0, play.start + i * stepMs - now);
    stepLabels(r.steps[i]).forEach(l => playNoteByLabel(l, i, delay / 1000));
    if (tx.metro && i % r.subdivision === 0) metroClick(i % (tx.beatsPerBar * r.subdivision) === 0 ? 'downbeat' : 'beat', delay / 1000);
    session.muteUntil = performance.now() + delay + PLAYBACK_MUTE_MS;
  }
  const current = Math.floor((now - play.start) / stepMs);
  if (current !== play.shown && current >= 0) {
    play.shown = current;
    const cells = els.txPhrase.querySelectorAll('.cl-tx-cell');
    cells.forEach((c, i) => c.classList.toggle('playing', i === current));
    stepLabels(r.steps[current]).forEach(l => tx.lit.set(l, performance.now()));
    renderStage();
  }
  if (tx.lit.size) fadeLit();
  if (current >= r.steps.length) stopPlayback();
}

function renderPlayButton() {
  els.txPlay.textContent = playingBack() ? '■ Stop' : '▶ Play';
  els.txPlay.setAttribute('aria-pressed', String(playingBack()));
}

// The Studio calls the Ding "D"
const studioLabel = l => (l === 'Ding' ? 'D' : l);

export async function sendTranscription() {
  const r = tx.result;
  if (!r) return;
  stopPlayback();
  if (!await guardBeforeReplacingGrid('You have unsaved changes. Discard them and replace the grid with this transcription?')) return;
  const labels = r.steps.map(s => (Array.isArray(s) ? s.map(studioLabel) : s ? studioLabel(s) : ''));
  navigate('studio');
  await applyPattern({
    version: 'v1.0',
    beats: tx.beatsPerBar,
    subdivision: r.subdivision,
    bpm: tx.bpm,
    steps: tx.beatsPerBar * r.subdivision,
    measures: r.measures,
    labels,
    hands: labels.map(() => null), // hands can't be heard; left for the player
    flams: labels.map(() => ''),
    tags: [],
  });
  const when = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  updateCurrentPhraseName(`Transcribed ${when}`);
}

// --- Plugged into the core ---

function renderTranscribe() {
  const open = state.mode === 'transcribe';
  setVisible(els.txBlock, open);
  if (!open) return;
  const busy = transcribing();
  setVisible(els.txSetup, !busy);
  els.txGo.classList.toggle('recording', busy);
  els.txGo.setAttribute('aria-pressed', String(busy));
  els.txGoLabel.textContent = busy ? 'Stop' : 'Start';
  if (document.activeElement !== els.txBpm) els.txBpm.value = String(tx.bpm);
  els.txBeats.value = String(tx.beatsPerBar);
  els.txClick.checked = tx.click;
  els.txMetro.checked = tx.metro;
  els.bpm.textContent = String(tx.bpm);
  els.meter.textContent = `${tx.beatsPerBar}/4`;
  ensurePulseDots();
  setVisible(els.txResult, tx.phase === 'done' && !!tx.result);
  setVisible(els.txEmpty, !tx.notes.length && tx.phase !== 'done');
  els.txCount.textContent = tx.notes.length ? `· ${tx.notes.length} note${tx.notes.length === 1 ? '' : 's'}` : '';
}

export const transcribeFeature = {
  // Every note heard in Transcribe is the transcription's, never a chord's
  onNote: (label, at) => {
    if (state.mode !== 'transcribe') return false;
    tx.lit.set(label, performance.now());
    if (tx.phase === 'countin' || tx.phase === 'recording') {
      const beatPos = (at - heardDownbeat()) / beatMs();
      if (beatPos >= -EARLY_SHARE) {
        tx.notes.push({ label, at });
        addStripNote(label, beatPos);
        setVisible(els.txEmpty, false);
        els.txCount.textContent = `· ${tx.notes.length} note${tx.notes.length === 1 ? '' : 's'}`;
      }
    }
    renderStage();
    return true;
  },
  beforeStop: () => { stopPlayback(); if (transcribing()) stopTranscribing(); },
  renderStage,
  render: renderTranscribe,
};
