// Play Along mode: a two-lane tab (left hand | right hand) whose notes fall
// to one "now" line, above the real pan, where rings close in on the next
// notes. Notes struck together share a band across both lanes; two notes in
// one hand share a pill. Driven by the playback clock; the frame loop only
// runs while playing (idle loops starve CPU, see css/handpanmap.css).

import { gridA } from './grid-context.js';
import { audibleLagSeconds, getPlaybackPosition, intervalMs, noteForLabel, start, stop } from './noteplayer.js';
import { getEffectiveHand } from './notegrid.js';
import { resolveTakSlapNote } from './handpanmap.js';
import { borrowPan, keepPerimeterFace, measurePanBoxes, tonefieldScreenPos } from './pinned-pan.js';
import { stepNotes, soundKind, chipText, countFor, chordName } from './play-along-model.js';
import { show, hide } from './dom.js';
import { canAccess, FEATURE } from './gated-feature.js';
import { Bus, BUS_EVENT } from './bus.js';
import { TransportRegistry } from './transport-ui.js';

const COLOR = {
  card: '#1A1D22',
  lane: '#22262D',
  text: '#ECEDEF',
  muted: '#9AA1AC',
  faint: '#6B727D',
  ink: '#14161A',
  now: '#F2B544',
  nowSoft: '#FFD27A',
  nowPill: '#6E5A2C',
  pill: '#3A3F48',
  bandStroke: '#5A616C',
  barLine: '#4A505B',
  tak: '#4FC7B2',
  slap: '#F29A52',
};
const FONT = 'Inter, system-ui, -apple-system, sans-serif';
const MAX_DPR = 2;
const MIN_FRAME_MS = 15;      // ~60fps cap on 120Hz screens
const NOW_HOLD = 0.6;         // steps a note stays lit after the beat
const NOW_EARLY = 0.05;       // steps a note lights before the beat
const RING_BEATS = 2;         // approach rings appear this many beats ahead
const RING_GAP = 16;          // px a ring sits outside its field at full lead
const BOX_REFRESH_FRAMES = 20;
const SAMPLE_ONSET_SEC = 0.02; // median silence before the strike in our samples
const SCRUB_THRESHOLD_PX = 6;  // a smaller move is a tap, not a scrub
const WHEEL_SETTLE_MS = 180;
const TEMPO_SETTLE_MS = 450;
const MIN_BPM = 30;
const MAX_BPM = 240;
const BPM_STEP = 2;

let active = false;
let rafId = null;
let lastDrawTs = 0;
let frameCount = 0;
let startedPlaybackOurselves = false;
let releasePan = null;
let resizeObserver = null;
let panBoxes = null;
let lastBarText = '';
let viewT = 0;          // playhead while paused, always on a beat
let lastT = 0;          // playhead of the last drawn frame
let scrub = null;       // pointer drag in progress
let scrubT = null;      // playhead while dragging or scrolling
let wheelTimer = null;
let wheelResume = false;
let tempoTimer = null;
let resumeAfterTempo = false;

let overlayEl = null;
let stripCanvas = null;
let stripCtx = null;
let panCanvas = null;
let panCtx = null;
let panHost = null;
let playBtn = null;
let barEl = null;
let tempoEl = null;

const chordNames = new Map();

export function initPlayAlongMode() {
  document.querySelectorAll('[data-play-along]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!canAccess(FEATURE.PLAY_ALONG)) {
        Bus.emit(BUS_EVENT.SHOW_UPGRADE_MODAL, { feature: FEATURE.PLAY_ALONG });
        return;
      }
      openPlayAlong();
    });
  });
}

const PLAY_ICON = '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l11-6.5a1 1 0 0 0 0-1.72l-11-6.5A1 1 0 0 0 8 5.5z"></path></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"></rect><rect x="14" y="5" width="4" height="14" rx="1"></rect></svg>';

function ensureDom() {
  if (overlayEl) return;
  overlayEl = document.createElement('div');
  overlayEl.id = 'playAlongOverlay';
  overlayEl.hidden = true;
  overlayEl.setAttribute('role', 'dialog');
  overlayEl.setAttribute('aria-label', 'Play Along');
  overlayEl.innerHTML = `
    <div class="pa-column">
      <div class="pa-header">
        <button type="button" class="pa-exit" id="playAlongExit" aria-label="Exit Play Along">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"></path></svg>
        </button>
        <div class="pa-heading">
          <div class="pa-title">Play Along</div>
          <div class="pa-sub" id="playAlongBar"></div>
        </div>
        <div class="pa-tempo" role="group" aria-label="Tempo">
          <button type="button" class="pa-tempo-btn" data-tempo-step="-1" aria-label="Slower">−</button>
          <label class="pa-tempo-field">
            <span aria-hidden="true">♩</span>
            <input id="playAlongTempo" type="number" inputmode="numeric" min="${MIN_BPM}" max="${MAX_BPM}" aria-label="Beats per minute">
          </label>
          <button type="button" class="pa-tempo-btn" data-tempo-step="1" aria-label="Faster">+</button>
        </div>
      </div>
      <div class="pa-strip-card">
        <canvas id="playAlongStrip" role="img" aria-label="Timing strip: left-hand notes on the left, right-hand notes on the right, falling to the now line. Drag or scroll to move through the phrase; arrow keys step a beat."></canvas>
      </div>
      <div class="pa-pan" id="playAlongPanHost">
        <canvas id="playAlongPanCanvas" aria-hidden="true"></canvas>
      </div>
      <div class="pa-controls">
        <button type="button" class="pa-play" id="playAlongPlay" aria-label="Play">${PLAY_ICON}</button>
      </div>
    </div>`;
  document.body.appendChild(overlayEl);

  stripCanvas = overlayEl.querySelector('#playAlongStrip');
  stripCtx = stripCanvas.getContext('2d');
  panCanvas = overlayEl.querySelector('#playAlongPanCanvas');
  panCtx = panCanvas.getContext('2d');
  panHost = overlayEl.querySelector('#playAlongPanHost');
  playBtn = overlayEl.querySelector('#playAlongPlay');
  barEl = overlayEl.querySelector('#playAlongBar');
  tempoEl = overlayEl.querySelector('#playAlongTempo');

  overlayEl.querySelector('#playAlongExit').addEventListener('click', closePlayAlong);
  playBtn.addEventListener('click', togglePlayback);

  overlayEl.querySelectorAll('[data-tempo-step]').forEach(btn => {
    btn.addEventListener('click', () => setTempo(shownBpm() + Number(btn.dataset.tempoStep) * BPM_STEP));
  });
  tempoEl.addEventListener('change', () => setTempo(Number(tempoEl.value)));
  tempoEl.addEventListener('keydown', e => { if (e.key === 'Enter') tempoEl.blur(); });

  stripCanvas.addEventListener('pointerdown', onStripPointerDown);
  stripCanvas.addEventListener('pointermove', onStripPointerMove);
  stripCanvas.addEventListener('pointerup', onStripPointerUp);
  stripCanvas.addEventListener('pointercancel', onStripPointerUp);
  stripCanvas.addEventListener('wheel', onStripWheel, { passive: false });
}

export function openPlayAlong() {
  if (active) return;
  active = true;
  frameCount = 0;
  lastBarText = '';
  chordNames.clear();
  ensureDom();

  releasePan = borrowPan(panHost, 'play-along-pinned');
  document.body.classList.add('play-along-open');
  show(overlayEl);
  viewT = 0;
  lastT = 0;
  tempoEl.value = shownBpm();

  window.addEventListener('keydown', onKey, true);
  window.addEventListener('playbackStateChange', onPlaybackChange);
  window.addEventListener('popstate', closePlayAlong);
  resizeObserver = new ResizeObserver(() => { sizeCanvases(); drawFrame(); });
  resizeObserver.observe(stripCanvas);
  resizeObserver.observe(panCanvas);

  sizeCanvases();
  onPlaybackChange();
}

export function closePlayAlong() {
  if (!active) return;
  active = false;
  stopLoop();
  clearTimeout(wheelTimer);
  clearTimeout(tempoTimer);
  scrub = null;
  scrubT = null;
  resumeAfterTempo = false;
  resizeObserver?.disconnect();
  resizeObserver = null;
  panBoxes = null;

  window.removeEventListener('keydown', onKey, true);
  window.removeEventListener('playbackStateChange', onPlaybackChange);
  window.removeEventListener('popstate', closePlayAlong);

  if (startedPlaybackOurselves && gridA.playing) stop(gridA);
  startedPlaybackOurselves = false;

  releasePan?.();
  releasePan = null;
  document.body.classList.remove('play-along-open');
  hide(overlayEl);
  // Let panel-resize.js re-fit the pan back in the Studio.
  window.dispatchEvent(new Event('resize'));
}

function onKey(e) {
  if (e.key === 'Escape') {
    e.stopPropagation();
    closePlayAlong();
    return;
  }
  if (e.target.closest?.('input')) return;
  if (e.key === ' ' && !e.target.closest?.('button')) {
    e.preventDefault();
    e.stopPropagation();
    togglePlayback();
  } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    e.preventDefault();
    e.stopPropagation();
    seekTo(lastT + (e.key === 'ArrowRight' ? 1 : -1) * meter().sub);
  }
}

function togglePlayback() {
  if (gridA.playing) stop(gridA);
  else playFrom(viewT);
}

function playFrom(step) {
  startedPlaybackOurselves = true;
  start(gridA, true, false, step);
}

// Nearest beat to step t, within the phrase.
function snapToBeat(t) {
  const { sub } = meter();
  const total = gridA.innerLabels.length || 1;
  const beat = Math.round(t / sub) * sub;
  return ((beat % total) + total) % total;
}

// Moves the playhead to the beat nearest t; playback resumes there.
function seekTo(t) {
  const wasPlaying = gridA.playing;
  if (wasPlaying) stop(gridA);
  viewT = snapToBeat(t);
  drawFrame();
  if (wasPlaying) playFrom(viewT);
}

function onPlaybackChange() {
  if (!active) return;
  const playing = gridA.playing;
  if (!playing) viewT = snapToBeat(lastT);
  playBtn.innerHTML = playing ? PAUSE_ICON : PLAY_ICON;
  playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  overlayEl.classList.toggle('pa-is-playing', playing);
  if (playing) startLoop();
  else { stopLoop(); drawFrame(); }
}

function startLoop() {
  if (rafId) return;
  lastDrawTs = 0;
  rafId = requestAnimationFrame(loop);
}

function stopLoop() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
}

function loop() {
  if (!active || !gridA.playing) { rafId = null; return; }
  rafId = requestAnimationFrame(loop);
  const now = performance.now();
  if (now - lastDrawTs < MIN_FRAME_MS) return;
  lastDrawTs = now;
  frameCount++;
  if (frameCount % 30 === 0) keepPerimeterFace();
  if (frameCount % BOX_REFRESH_FRAMES === 0) panBoxes = null;
  drawFrame();
}

function sizeCanvas(canvas, ctx) {
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  const rect = canvas.getBoundingClientRect();
  const w = Math.round(rect.width);
  const h = Math.round(rect.height);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w, h };
}

let stripSize = { w: 0, h: 0 };
let panSize = { w: 0, h: 0 };

function sizeCanvases() {
  if (!active) return;
  stripSize = sizeCanvas(stripCanvas, stripCtx);
  panSize = sizeCanvas(panCanvas, panCtx);
  panBoxes = null;
}

// ---------------------------------------------------------------------------

// The phrase's real meter. Phones play each bar as quarter-note steps at a
// scaled tempo (normalizeMobileSubdivision in pattern-crud.js).
function meter() {
  const sub = gridA.mobileOriginalSubdivision || gridA.subdivision || 2;
  return { beats: gridA.beats, sub, spm: gridA.beats * sub };
}

// The step being heard, not scheduled: notes reach the now line as they sound.
function playhead() {
  if (scrubT !== null) return scrubT;
  if (!gridA.playing) return viewT;
  const pos = getPlaybackPosition(gridA);
  const t = pos.step + pos.fraction;
  return t - (audibleLagSeconds(gridA) + SAMPLE_ONSET_SEC) / (intervalMs(gridA) / 1000);
}

// --- Scrubbing: the strip follows the finger (or scroll), then snaps to a beat.

function clampStep(t) {
  return Math.min(Math.max(t, 0), Math.max(0, gridA.innerLabels.length - 1));
}

function onStripPointerDown(e) {
  if (e.button > 0) return;
  scrub = { y: e.clientY, t0: lastT, moved: false, resume: false };
  stripCanvas.setPointerCapture(e.pointerId);
}

function onStripPointerMove(e) {
  if (!scrub) return;
  const dy = e.clientY - scrub.y;
  if (!scrub.moved) {
    if (Math.abs(dy) < SCRUB_THRESHOLD_PX) return;
    scrub.moved = true;
    scrub.resume = gridA.playing;
    if (scrub.resume) stop(gridA);
    overlayEl.classList.add('pa-scrubbing');
  }
  scrubT = clampStep(scrub.t0 + dy / stripLayout().pxPerStep);
  drawFrame();
}

function onStripPointerUp() {
  if (!scrub) return;
  const { moved, resume } = scrub;
  scrub = null;
  if (moved) endScrub(resume);
}

function onStripWheel(e) {
  e.preventDefault();
  const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
  if (scrubT === null) {
    wheelResume = gridA.playing;
    if (wheelResume) stop(gridA);
    scrubT = lastT;
  }
  // Content follows the scroll, like a page: scrolling down shows earlier notes.
  scrubT = clampStep(scrubT - px / stripLayout().pxPerStep);
  drawFrame();
  clearTimeout(wheelTimer);
  wheelTimer = setTimeout(() => endScrub(wheelResume), WHEEL_SETTLE_MS);
}

function endScrub(resume) {
  overlayEl.classList.remove('pa-scrubbing');
  viewT = snapToBeat(scrubT ?? lastT);
  scrubT = null;
  drawFrame();
  if (resume) playFrom(viewT);
}

// --- Tempo: shown in the phrase's real BPM (phones play a scaled one).

function shownBpm() {
  return Math.round(gridA.bpm * (gridA.subdivision || 1) / meter().sub);
}

function setTempo(bpm) {
  if (!Number.isFinite(bpm)) { tempoEl.value = shownBpm(); return; }
  const clamped = Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpm)));
  // Changing tempo mid-play throws the clock off; pause, then resume on
  // the current beat once the changes stop.
  if (gridA.playing) {
    stop(gridA);
    resumeAfterTempo = true;
  }
  gridA.bpm = clamped * meter().sub / (gridA.subdivision || 1);
  const studioInput = document.getElementById('bpmInput-A');
  if (studioInput) studioInput.value = gridA.bpm;
  TransportRegistry.updateAll(gridA);
  tempoEl.value = clamped;
  drawFrame();
  clearTimeout(tempoTimer);
  if (resumeAfterTempo) {
    tempoTimer = setTimeout(() => {
      resumeAfterTempo = false;
      if (active && !gridA.playing) playFrom(viewT);
    }, TEMPO_SETTLE_MS);
  }
}

function notesAt(j) {
  const total = gridA.innerLabels.length;
  if (!total || j < 0) return null;
  const i = ((j % total) + total) % total;
  return stepNotes(gridA.innerLabels[i], i, idx => getEffectiveHand(idx, gridA));
}

function chordNameFor(notes) {
  const key = notes.map(n => n.label).join('|');
  if (!chordNames.has(key)) chordNames.set(key, chordName(notes.map(n => noteForLabel(n.label))));
  return chordNames.get(key);
}

const isNow = dt => dt <= NOW_EARLY && dt > -NOW_HOLD;

function drawFrame() {
  if (!active || !stripSize.w) return;
  const t = playhead();
  lastT = t;
  drawStrip(t);
  drawPan(t);
  updateBar(t);
}

function updateBar(t) {
  const { spm } = meter();
  const total = gridA.innerLabels.length;
  if (!spm || !total) return;
  const i = ((Math.floor(t) % total) + total) % total;
  const text = `Bar ${Math.floor(i / spm) + 1} of ${Math.ceil(total / spm)}`;
  if (text !== lastBarText) { lastBarText = text; barEl.textContent = text; }
}

// --- Strip -----------------------------------------------------------------

function stripLayout() {
  const { w, h } = stripSize;
  const pad = 8;
  const spineW = 56;
  const laneW = (w - spineW - pad * 2) / 2;
  const { sub } = meter();
  const pxPerStep = (sub >= 4 ? 112 : 84) / sub;
  return {
    w, h, pad, laneW,
    laneTop: 26,
    laneBottom: h - 8,
    leftX: pad + laneW / 2,
    rightX: w - pad - laneW / 2,
    spineX: w / 2,
    nowY: h - 46,
    pxPerStep,
    chipR: Math.min(15, pxPerStep * 0.4),
  };
}

function drawStrip(t) {
  const c = stripCtx;
  const L = stripLayout();
  c.clearRect(0, 0, L.w, L.h);

  c.font = `700 11px ${FONT}`;
  c.textAlign = 'center';
  c.textBaseline = 'alphabetic';
  c.fillStyle = '#C9CDD3';
  c.fillText('LEFT', L.leftX, 16);
  c.fillText('RIGHT', L.rightX, 16);

  c.fillStyle = COLOR.lane;
  roundRect(c, L.pad, L.laneTop, L.laneW, L.laneBottom - L.laneTop, 12);
  c.fill();
  roundRect(c, L.w - L.pad - L.laneW, L.laneTop, L.laneW, L.laneBottom - L.laneTop, 12);
  c.fill();

  c.save();
  c.beginPath();
  c.rect(0, L.laneTop, L.w, L.laneBottom - L.laneTop);
  c.clip();

  // Under the notes, so lit chips stay readable.
  c.strokeStyle = COLOR.now;
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(L.pad, L.nowY);
  c.lineTo(L.w - L.pad, L.nowY);
  c.stroke();

  const { beats, sub, spm } = meter();
  const total = gridA.innerLabels.length;
  const first = Math.floor(t - (L.laneBottom - L.nowY) / L.pxPerStep) - 1;
  const last = Math.ceil(t + (L.nowY - L.laneTop) / L.pxPerStep) + 1;

  for (let j = Math.max(0, first); j <= last && total; j++) {
    const i = j % total;
    const y = L.nowY - (j - t) * L.pxPerStep;
    if (i % spm === 0) drawBarLine(c, L, y + L.pxPerStep / 2, i / spm + 1);
    const notes = notesAt(j);
    const count = countFor(i, beats, sub);
    const name = notes && notes.length >= 2 ? chordNameFor(notes) : '';
    if (notes) drawStripStep(c, L, y, notes, j - t);
    drawCount(c, L, y, count, name, notes ? isNow(j - t) : false);
  }
  c.restore();

  const fade = c.createLinearGradient(0, L.laneTop, 0, L.laneTop + 32);
  fade.addColorStop(0, COLOR.card);
  fade.addColorStop(1, 'rgba(26, 29, 34, 0)');
  c.fillStyle = fade;
  c.fillRect(0, L.laneTop, L.w, 32);

  c.fillStyle = COLOR.now;
  triangle(c, 0, L.nowY - 6, 0, L.nowY + 6, L.pad, L.nowY);
  triangle(c, L.w, L.nowY - 6, L.w, L.nowY + 6, L.w - L.pad, L.nowY);
}

function drawBarLine(c, L, y, bar) {
  c.save();
  c.strokeStyle = COLOR.barLine;
  c.lineWidth = 1.5;
  c.setLineDash([3, 3]);
  c.beginPath();
  c.moveTo(L.pad, y);
  c.lineTo(L.w - L.pad, y);
  c.stroke();
  c.restore();
  c.fillStyle = COLOR.muted;
  c.font = `600 10px ${FONT}`;
  c.textAlign = 'left';
  c.fillText(`BAR ${bar}`, L.pad + 8, y - 5);
}

function drawStripStep(c, L, y, notes, dt) {
  const lit = isNow(dt);
  c.save();
  if (dt <= -NOW_HOLD) c.globalAlpha = 0.3;

  if (notes.length >= 2) {
    const bandH = L.chipR * 2 + 10;
    c.fillStyle = lit ? 'rgba(242, 181, 68, 0.14)' : 'rgba(236, 237, 239, 0.06)';
    c.strokeStyle = lit ? COLOR.now : COLOR.bandStroke;
    c.lineWidth = 1.5;
    roundRect(c, L.pad + 4, y - bandH / 2, L.w - L.pad * 2 - 8, bandH, bandH / 2);
    c.fill();
    c.stroke();
  }

  for (const hand of ['L', 'R']) {
    const group = notes.filter(n => n.hand === hand);
    if (!group.length) continue;
    const cx = hand === 'L' ? L.leftX : L.rightX;
    const off = group.length > 1 ? L.chipR + 5 : 0;
    if (group.length > 1) {
      const pillH = L.chipR * 2 + 4;
      c.fillStyle = lit ? COLOR.nowPill : COLOR.pill;
      roundRect(c, cx - off - L.chipR - 5, y - pillH / 2, (off + L.chipR + 5) * 2, pillH, pillH / 2);
      c.fill();
    }
    group.forEach((n, k) => {
      const x = group.length > 1 ? cx + (k === 0 ? -off : off) : cx;
      drawChip(c, x, y, L.chipR, n.label, lit);
    });
  }
  c.restore();
}

function drawChip(c, x, y, r, label, lit) {
  const kind = soundKind(label);
  let fill = lit ? COLOR.now : COLOR.text;
  let ink = COLOR.ink;
  if (!lit && kind === 'tak') { fill = COLOR.tak; ink = '#0E1A18'; }
  if (!lit && kind === 'slap') { fill = COLOR.slap; ink = '#1E1208'; }

  c.fillStyle = fill;
  if (kind === 'tak') {
    c.beginPath();
    c.moveTo(x, y - r);
    c.lineTo(x + r, y);
    c.lineTo(x, y + r);
    c.lineTo(x - r, y);
    c.closePath();
    c.fill();
  } else if (kind === 'slap') {
    roundRect(c, x - r * 0.93, y - r * 0.93, r * 1.86, r * 1.86, r * 0.4);
    c.fill();
  } else if (kind === 'ding') {
    c.strokeStyle = fill;
    c.lineWidth = 2.5;
    c.beginPath();
    c.arc(x, y, r + 2, 0, Math.PI * 2);
    c.stroke();
    c.beginPath();
    c.arc(x, y, r - 3, 0, Math.PI * 2);
    c.fill();
  } else {
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fill();
  }

  c.fillStyle = ink;
  c.font = `700 ${Math.round(r * 0.9)}px ${FONT}`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(chipText(label), x, y + 1);
  c.textBaseline = 'alphabetic';
}

function drawCount(c, L, y, count, name, lit) {
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  if (name) {
    c.fillStyle = lit ? COLOR.nowSoft : COLOR.text;
    c.font = `700 14px ${FONT}`;
    c.fillText(name, L.spineX, y - 6);
    c.fillStyle = lit ? COLOR.text : COLOR.muted;
    c.font = `600 10px ${FONT}`;
    c.fillText(count.text, L.spineX, y + 9);
  } else if (count.onBeat) {
    c.fillStyle = lit ? COLOR.text : '#C9CDD3';
    c.font = `700 14px ${FONT}`;
    c.fillText(count.text, L.spineX, y);
  } else {
    c.fillStyle = COLOR.faint;
    c.font = `400 12px ${FONT}`;
    c.fillText(count.text, L.spineX, y);
  }
  c.textBaseline = 'alphabetic';
}

// --- Pan -------------------------------------------------------------------

function ringColor(label) {
  const kind = soundKind(label);
  if (kind === 'tak') return COLOR.tak;
  if (kind === 'slap') return COLOR.slap;
  return COLOR.text;
}

function fieldsFor(notes) {
  const out = [];
  for (const n of notes) {
    const tf = tonefieldScreenPos(resolveTakSlapNote(n.label, n.hand), panBoxes);
    if (tf) out.push({ ...tf, label: n.label });
  }
  return out;
}

function drawPan(t) {
  const c = panCtx;
  c.clearRect(0, 0, panSize.w, panSize.h);
  if (!panBoxes) panBoxes = measurePanBoxes(panCanvas);
  if (!panBoxes.overlay) return;

  const ringSteps = RING_BEATS * meter().sub;
  for (let j = Math.max(0, Math.floor(t) - 1); j <= Math.ceil(t + ringSteps); j++) {
    const dt = j - t;
    const notes = notesAt(j);
    if (!notes) continue;
    const fields = fieldsFor(notes);
    if (isNow(dt)) drawLit(c, fields, dt);
    else if (dt > 0 && dt <= ringSteps) drawRings(c, fields, dt / ringSteps);
  }
}

function drawRings(c, fields, k) {
  for (const f of fields) {
    c.globalAlpha = 0.15 + 0.75 * (1 - k);
    c.strokeStyle = ringColor(f.label);
    c.lineWidth = 2 + 2 * (1 - k);
    c.beginPath();
    c.arc(f.x, f.y, f.rpx + 4 + RING_GAP * k, 0, Math.PI * 2);
    c.stroke();
  }
  c.globalAlpha = 1;
}

function drawLit(c, fields, dt) {
  const fade = dt > 0 ? 1 : 1 + dt / NOW_HOLD;
  c.globalAlpha = fade;
  if (fields.length >= 2) drawChordShape(c, fields);
  for (const f of fields) {
    c.globalAlpha = 0.3 * fade;
    c.fillStyle = COLOR.now;
    c.beginPath();
    c.arc(f.x, f.y, f.rpx, 0, Math.PI * 2);
    c.fill();
    c.globalAlpha = fade;
    c.strokeStyle = COLOR.now;
    c.lineWidth = 3;
    c.beginPath();
    c.arc(f.x, f.y, f.rpx + 3, 0, Math.PI * 2);
    c.stroke();
  }
  c.globalAlpha = 1;
}

// The chord's fields joined in angular order, so players see its shape.
function drawChordShape(c, fields) {
  const cx = fields.reduce((s, f) => s + f.x, 0) / fields.length;
  const cy = fields.reduce((s, f) => s + f.y, 0) / fields.length;
  const pts = [...fields].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  c.save();
  c.beginPath();
  pts.forEach((p, k) => (k ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
  c.closePath();
  c.fillStyle = 'rgba(242, 181, 68, 0.12)';
  c.fill();
  c.strokeStyle = COLOR.now;
  c.lineWidth = 2;
  c.setLineDash([5, 4]);
  c.lineJoin = 'round';
  c.stroke();
  c.restore();
}

// --- Canvas helpers --------------------------------------------------------

function roundRect(c, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + rr, y);
  c.arcTo(x + w, y, x + w, y + h, rr);
  c.arcTo(x + w, y + h, x, y + h, rr);
  c.arcTo(x, y + h, x, y, rr);
  c.arcTo(x, y, x + w, y, rr);
  c.closePath();
}

function triangle(c, x1, y1, x2, y2, x3, y3) {
  c.beginPath();
  c.moveTo(x1, y1);
  c.lineTo(x2, y2);
  c.lineTo(x3, y3);
  c.closePath();
  c.fill();
}
