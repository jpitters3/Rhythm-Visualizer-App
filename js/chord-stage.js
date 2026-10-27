// Full-screen "stage" for jamming in class: the whole song's chord shapes in
// one big row, grouped by section, with NOW / NEXT called out. Steps by
// keyboard/click/pedal, or auto-advances at a tempo.
import { createChordShapeDiagramEl, updateChordShapeDiagram } from './chord-shape-diagram.js';
import { notesToLabels, playChordNotes } from './chord-playback.js';
import { abbreviateChord } from './progression-to-grid.js';
import { getInversionLabel } from './chord-analyzer.js';
import { activeGrid } from './state.js';
import { ensureAudio, getAudioCtx, metroClick, getMetronomeSound, setMetronomeSound, getVolume, setVolume } from './noteplayer.js';

const BEAT_OPTIONS = [2, 3, 4, 6, 8];
const LOOKAHEAD_S = 0.1; // schedule clicks this far ahead on the audio clock
const SCHEDULE_MS = 25;

let stageEl = null;
let rowEl = null;
let seq = [];
let groups = []; // [{ el, first, last }] — seq index range per section group
let index = 0;
let beat = 0;
let beatsPerChord = 4;
let bpm = 90;
let timer = null; // scheduler interval; non-null = auto-advancing
let soundOn = false;
let metroOn = false;
let metroSubdiv = false;
let nextBeatTime = 0;
let beatsScheduled = 0;
let visualTimers = [];

function buildStage() {
  stageEl = document.createElement('div');
  stageEl.id = 'chordStage';
  stageEl.className = 'chord-stage';
  stageEl.hidden = true;
  stageEl.setAttribute('role', 'dialog');
  stageEl.setAttribute('aria-label', 'Chord progression, full screen');
  stageEl.innerHTML = `
    <div class="cs-stage-title"></div>
    <div class="cs-stage-row"></div>
    <div class="cs-stage-controls">
      <button type="button" class="cs-stage-btn" data-stage="prev" title="Previous chord (←)">⏮</button>
      <button type="button" class="cs-stage-btn cs-stage-play" data-stage="play" title="Auto-advance (Space)">▶</button>
      <button type="button" class="cs-stage-btn" data-stage="next" title="Next chord (→)">⏭</button>
      <label class="cs-stage-field">BPM <input type="number" data-stage="bpm" min="30" max="240"></label>
      <label class="cs-stage-field">Beats per chord
        <select data-stage="beats">${BEAT_OPTIONS.map(b => `<option value="${b}">${b}</option>`).join('')}</select>
      </label>
      <label class="cs-stage-field"><input type="checkbox" data-stage="sound"> Chord sound</label>
      <span class="cs-stage-metro">
        <button type="button" class="cs-stage-btn cs-stage-toggle" data-stage="metro" title="Metronome (M)">🔔</button>
        <button type="button" class="cs-stage-btn cs-stage-toggle cs-stage-sub" data-stage="sub" title="Click the off-beats too">Sub</button>
        <select data-stage="metroSound" title="Metronome sound">
          <option value="Click">Click</option>
          <option value="Shaker">Shaker</option>
        </select>
        <input type="range" data-stage="metroVol" min="0" max="1" step="0.05" title="Metronome volume" aria-label="Metronome volume">
      </span>
      <button type="button" class="cs-stage-btn cs-stage-exit" data-stage="exit" title="Exit (Esc)">✕ Exit</button>
    </div>
    <div class="cs-stage-help">← → step · Space play/pause · M metronome · click a chord to jump · Esc exit</div>
  `;
  document.body.appendChild(stageEl);
  rowEl = stageEl.querySelector('.cs-stage-row');

  stageEl.addEventListener('click', (e) => {
    const card = e.target.closest('.cs-stage-card');
    if (card) { goTo(parseInt(card.dataset.i, 10)); return; }
    const act = e.target.closest('[data-stage]')?.dataset.stage;
    if (act === 'prev') goTo(index - 1);
    else if (act === 'next') goTo(index + 1);
    else if (act === 'play') togglePlay();
    else if (act === 'metro') setMetro(!metroOn);
    else if (act === 'sub') { metroSubdiv = !metroSubdiv; syncMetroControls(); }
    else if (act === 'exit') closeChordStage();
  });

  stageEl.querySelector('[data-stage="bpm"]').addEventListener('change', (e) => {
    bpm = Math.min(240, Math.max(30, parseInt(e.target.value, 10) || bpm));
    e.target.value = bpm; // the scheduler reads bpm live, no restart needed
  });
  stageEl.querySelector('[data-stage="beats"]').addEventListener('change', (e) => {
    beatsPerChord = parseInt(e.target.value, 10);
    beat = 0;
    if (timer) startTimer(); // restart on a downbeat
    update();
  });
  stageEl.querySelector('[data-stage="metroSound"]').addEventListener('change', (e) => {
    setMetronomeSound(e.target.value);
  });
  stageEl.querySelector('[data-stage="metroVol"]').addEventListener('input', (e) => {
    setVolume('metronome', parseFloat(e.target.value));
  });
  stageEl.querySelector('[data-stage="sound"]').addEventListener('change', (e) => {
    soundOn = e.target.checked;
  });

  // Capture phase: beats the Studio's own Space/P/M shortcuts while open.
  window.addEventListener('keydown', onKeydown, true);
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && !stageEl.hidden) closeChordStage();
  });
  window.addEventListener('resize', () => { if (!stageEl.hidden) sizeCards(); });
}

function onKeydown(e) {
  if (!stageEl || stageEl.hidden) return;
  const inField = e.target.closest?.('input, select');
  const key = e.key;
  let handled = true;
  if (key === 'Escape') closeChordStage();
  else if (inField) handled = false;
  else if (key === 'ArrowRight' || key === 'PageDown' || key === 'Enter') goTo(index + 1);
  else if (key === 'ArrowLeft' || key === 'PageUp') goTo(index - 1);
  else if (key === ' ') togglePlay();
  else if (key === 'Home') goTo(0);
  else if (key.toLowerCase() === 'm') setMetro(!metroOn);
  e.stopPropagation(); // never leak to Studio shortcuts while the stage is up
  if (handled) e.preventDefault();
}

function chordNameHtml(chord) {
  const inv = chord.inversion ? `<span class="cs-stage-inv">${getInversionLabel(chord.inversion)}</span>` : '';
  return `<div class="cs-stage-name">${abbreviateChord(chord)}${inv}</div>`;
}

function renderRow() {
  rowEl.replaceChildren();
  groups = [];
  let groupEl = null;
  let lastSectionIndex = -1;

  seq.forEach(({ chord, section, sectionIndex }, i) => {
    if (sectionIndex !== lastSectionIndex) {
      groupEl = document.createElement('div');
      groupEl.className = 'cs-stage-group';
      groupEl.dataset.color = String(section.color ?? 0);
      groupEl.innerHTML = '<div class="cs-stage-group-label"></div><div class="cs-stage-cards"></div>';
      groupEl.querySelector('.cs-stage-group-label').textContent = section.name || 'Section';
      rowEl.appendChild(groupEl);
      groups.push({ el: groupEl, first: i, last: i });
      lastSectionIndex = sectionIndex;
    }
    groups.at(-1).last = i;

    const card = document.createElement('div');
    card.className = 'cs-stage-card';
    card.dataset.i = String(i);
    const shape = createChordShapeDiagramEl({ flat: true });
    updateChordShapeDiagram(shape, notesToLabels(chord.notes));
    card.innerHTML = '<div class="cs-stage-badge"></div>';
    card.appendChild(shape);
    card.insertAdjacentHTML('beforeend', `${chordNameHtml(chord)}<div class="cs-stage-beats"></div>`);
    groupEl.querySelector('.cs-stage-cards').appendChild(card);
  });
  sizeCards();
}

// Largest card size that fits every chord in one row, capped by height.
function sizeCards() {
  const n = seq.length;
  const gap = 20;
  const groupGap = 40;
  const available = window.innerWidth - 64 - (n - 1) * gap - (groups.length - 1) * groupGap;
  const size = Math.max(48, Math.min(window.innerHeight * 0.3, available / Math.max(n, 1) / 1.05));
  rowEl.style.setProperty('--card-size', `${Math.floor(size)}px`);
}

function update() {
  const n = seq.length;
  const next = n > 1 ? (index + 1) % n : -1;
  const imminent = !!timer && beat === beatsPerChord - 1;

  rowEl.querySelectorAll('.cs-stage-card').forEach((card) => {
    const i = parseInt(card.dataset.i, 10);
    const isNow = i === index;
    const isNext = i === next;
    card.classList.toggle('is-now', isNow);
    card.classList.toggle('is-next', isNext);
    card.classList.toggle('is-imminent', isNext && imminent);
    card.classList.toggle('is-past', !isNow && !isNext && i < index);
    card.classList.toggle('is-later', !isNow && !isNext && i > index);
    card.querySelector('.cs-stage-badge').textContent = isNow ? 'Now' : isNext ? 'Next' : '';

    const beatsEl = card.querySelector('.cs-stage-beats');
    beatsEl.innerHTML = isNow
      ? Array.from({ length: beatsPerChord }, (_, b) => `<span class="${timer && b <= beat ? 'on' : ''}"></span>`).join('')
      : '';
  });

  groups.forEach((g) => {
    const holdsNow = index >= g.first && index <= g.last;
    const holdsNext = !holdsNow && next >= g.first && next <= g.last;
    g.el.classList.toggle('is-now', holdsNow);
    g.el.classList.toggle('is-next', holdsNext);
  });

  stageEl.querySelector('[data-stage="play"]').textContent = timer ? '⏸' : '▶';
}

function setMetro(on) {
  metroOn = on;
  if (on) ensureAudio();
  syncMetroControls();
}

function syncMetroControls() {
  stageEl.querySelector('[data-stage="metro"]').classList.toggle('on', metroOn);
  stageEl.querySelector('[data-stage="sub"]').classList.toggle('on', metroSubdiv);
  stageEl.querySelector('[data-stage="sub"]').disabled = !metroOn;
}

function goTo(i, { fromTick = false } = {}) {
  const n = seq.length;
  if (!n) return;
  index = ((i % n) + n) % n;
  beat = 0;
  const card = rowEl.querySelector(`.cs-stage-card[data-i="${index}"]`);
  // Restart the "landed" pop on every change.
  card?.classList.remove('landed');
  void card?.offsetWidth;
  card?.classList.add('landed');
  // Phones: the row can overflow, so keep NOW in view.
  card?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  if (soundOn) playChordNotes(seq[index].chord.notes);
  if (timer && !fromTick) startTimer(); // manual jump: re-sync the beat grid to this chord
  update();
}

function tick() {
  beat += 1;
  if (beat >= beatsPerChord) goTo(index + 1, { fromTick: true });
  else update();
}

function clockNow() {
  return getAudioCtx()?.currentTime ?? performance.now() / 1000;
}

// Lookahead scheduler: clicks land on the audio clock (no setInterval drift);
// the visual beat follows via a timeout at the same moment.
function scheduleBeats() {
  const now = clockNow();
  const secondsPerBeat = 60 / bpm;
  while (nextBeatTime < now + LOOKAHEAD_S) {
    const delay = Math.max(0, nextBeatTime - now);
    if (metroOn) {
      metroClick(beatsScheduled % beatsPerChord === 0 ? 'downbeat' : 'beat', delay);
      if (metroSubdiv) metroClick('subdiv', delay + secondsPerBeat / 2);
    }
    // Beat 0 is the chord already on screen; later beats advance the display.
    if (beatsScheduled > 0) visualTimers = [...visualTimers.slice(-8), setTimeout(tick, delay * 1000)];
    beatsScheduled += 1;
    nextBeatTime += secondsPerBeat;
  }
}

function startTimer() {
  stopTimer();
  ensureAudio();
  beatsScheduled = 0;
  nextBeatTime = clockNow() + 0.05;
  scheduleBeats();
  timer = setInterval(scheduleBeats, SCHEDULE_MS);
}

function stopTimer() {
  clearInterval(timer);
  visualTimers.forEach(clearTimeout);
  visualTimers = [];
  timer = null;
}

function togglePlay() {
  if (timer) {
    stopTimer();
  } else {
    beat = 0;
    startTimer();
    if (soundOn) playChordNotes(seq[index].chord.notes);
  }
  update();
}

export function openChordStage(song) {
  if (!stageEl) buildStage();
  seq = [];
  song.sections.forEach((section, sectionIndex) => {
    section.slots.forEach((chord) => {
      if (chord?.notes) seq.push({ chord, section, sectionIndex });
    });
  });
  if (!seq.length) return;

  index = 0;
  beat = 0;
  bpm = activeGrid?.bpm || 90;
  beatsPerChord = BEAT_OPTIONS.includes(activeGrid?.beats) ? activeGrid.beats : 4;
  stageEl.querySelector('.cs-stage-title').textContent = song.title?.trim() || 'Chord progression';
  stageEl.querySelector('[data-stage="bpm"]').value = bpm;
  stageEl.querySelector('[data-stage="beats"]').value = String(beatsPerChord);
  stageEl.querySelector('[data-stage="sound"]').checked = soundOn;
  // Metronome starts from the Studio's own settings.
  metroOn = !!activeGrid?.metronomeOn;
  metroSubdiv = !!activeGrid?.metronomeSubdiv;
  stageEl.querySelector('[data-stage="metroSound"]').value = getMetronomeSound();
  stageEl.querySelector('[data-stage="metroVol"]').value = String(getVolume('metronome'));
  syncMetroControls();

  stageEl.hidden = false;
  document.body.classList.add('chord-stage-open');
  renderRow();
  goTo(0);
  stageEl.requestFullscreen?.().catch(() => {}); // overlay still works without it (e.g. iPhone)
}

export function closeChordStage() {
  if (!stageEl || stageEl.hidden) return;
  stopTimer();
  stageEl.hidden = true;
  document.body.classList.remove('chord-stage-open');
  if (document.fullscreenElement === stageEl) document.exitFullscreen?.().catch(() => {});
}
