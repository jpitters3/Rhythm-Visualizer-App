// Pan Hero — Guitar-Hero-style falling-note visualization.
//
// A standalone full-screen overlay (NOT presentation mode). The real handpan
// is re-parented into the overlay and pinned near the bottom; the notes of the
// current phrase fall straight down in vertical lanes, each lane locked to its
// tonefield's on-screen x, and reach the tonefield at the moment the note is
// scheduled — driven by the playback clock (getPlaybackPosition), not CSS.
//
// v1 is visualization only (no scoring). The pan stays tappable so the player
// can strike along with the falling notes.

import { gridA } from './grid-context.js';
import { getPlaybackPosition, intervalMs, start, stop } from './noteplayer.js';
import { getEffectiveHand } from './notegrid.js';
import {
  HANDPAN_MAP, getDisplayPosition, isPerimeterNote, resolveTakSlapNote,
  setHandpanSide, getHandpanSide,
} from './handpanmap.js';
import { show, hide } from './dom.js';

let active = false;
let rafId = null;
let frameCount = 0;
let boxes = null;   // cached element rects (see refreshBoxes)
let canvasCssW = 0;
let canvasCssH = 0;
let lastVW = 0;
let lastVH = 0;
let lastDrawTs = 0;

let overlayEl = null;
let canvas = null;
let cctx = null;
let panHost = null;
let hintEl = null;

// Pan re-parent bookkeeping
let originalParent = null;
let originalNextSibling = null;
let stashedInline = { maxWidth: '', width: '', margin: '' };

// Playback / side bookkeeping
let startedPlaybackOurselves = false;
let prevHandpanSideRaw = null;

// Landed-note spark particles (ported from presentation-mode.js)
let sparks = [];
// Per-step guard so a burst fires once per pass, keyed by absolute step index
let sparked = new Set();

const LEAD_SECONDS_DESKTOP = 2.4;
const LEAD_SECONDS_MOBILE = 1.8;

// ---------------------------------------------------------------------------

export function initPanHero() {
  document.querySelectorAll('[data-pan-hero]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('handpanOptionsMenu')?.classList.remove('show');
      openPanHero();
    });
  });
}

function ensureDom() {
  if (overlayEl) return;

  overlayEl = document.createElement('div');
  overlayEl.id = 'panHeroOverlay';
  overlayEl.hidden = true;

  canvas = document.createElement('canvas');
  canvas.id = 'panHeroCanvas';
  cctx = canvas.getContext('2d');

  panHost = document.createElement('div');
  panHost.id = 'panHeroPanHost';

  hintEl = document.createElement('div');
  hintEl.id = 'panHeroHint';
  hintEl.textContent = 'Press play';
  hintEl.hidden = true;

  const exitBtn = document.createElement('button');
  exitBtn.id = 'panHeroExit';
  exitBtn.type = 'button';
  exitBtn.textContent = '✕';
  exitBtn.setAttribute('aria-label', 'Exit Pan Hero');
  exitBtn.addEventListener('click', closePanHero);

  overlayEl.append(panHost, canvas, hintEl, exitBtn);
  document.body.appendChild(overlayEl);
}

export function openPanHero() {
  if (active) return;
  active = true;
  frameCount = 0;
  sparks = [];
  sparked = new Set();
  ensureDom();

  // Force the merged "perimeter" face so bottom notes have visible tonefields.
  prevHandpanSideRaw = localStorage.getItem('gp_handpanSide');
  setHandpanSide('perimeter');

  // Re-parent the real pan into the overlay. A transformed ancestor
  // (.handpan-panel translateZ on mobile) would otherwise trap position:fixed.
  const wrap = document.getElementById('handpanWrap');
  if (wrap) {
    originalParent = wrap.parentElement;
    originalNextSibling = wrap.nextSibling;
    stashedInline = {
      maxWidth: wrap.style.maxWidth,
      width: wrap.style.width,
      margin: wrap.style.margin,
    };
    wrap.style.maxWidth = wrap.style.width = wrap.style.margin = '';
    wrap.classList.add('pan-hero-pinned');
    panHost.appendChild(wrap);
  }

  document.body.classList.add('pan-hero-open');
  show(overlayEl);

  if (!gridA.playing) {
    startedPlaybackOurselves = true;
    start(gridA);
  }

  window.addEventListener('resize', onForcedResize);
  window.addEventListener('orientationchange', onForcedResize);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('playbackStateChange', onPlaybackChange);
  window.addEventListener('popstate', closePanHero);

  lastDrawTs = 0;
  onResize(true);
  rafId = requestAnimationFrame(loop);
}

export function closePanHero() {
  if (!active) return;
  active = false;

  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  boxes = null;

  window.removeEventListener('resize', onForcedResize);
  window.removeEventListener('orientationchange', onForcedResize);
  window.removeEventListener('keydown', onKey, true);
  window.removeEventListener('playbackStateChange', onPlaybackChange);
  window.removeEventListener('popstate', closePanHero);

  if (startedPlaybackOurselves && gridA.playing) stop(gridA);
  startedPlaybackOurselves = false;

  const wrap = document.getElementById('handpanWrap');
  if (wrap && originalParent) {
    wrap.classList.remove('pan-hero-pinned');
    wrap.style.maxWidth = stashedInline.maxWidth;
    wrap.style.width = stashedInline.width;
    wrap.style.margin = stashedInline.margin;
    originalParent.insertBefore(wrap, originalNextSibling);
  }
  originalParent = originalNextSibling = null;

  // Restore the user's face, then write their persisted preference back
  // verbatim (setHandpanSide clobbers gp_handpanSide).
  setHandpanSide(prevHandpanSideRaw || 'top');
  if (prevHandpanSideRaw != null) {
    localStorage.setItem('gp_handpanSide', prevHandpanSideRaw);
  } else {
    localStorage.removeItem('gp_handpanSide');
  }
  prevHandpanSideRaw = null;

  document.body.classList.remove('pan-hero-open');
  hide(overlayEl);

  // Let panel-resize.js recompute .handpan-panel height / .handpan-wrap width.
  window.dispatchEvent(new Event('resize'));
}

// ---------------------------------------------------------------------------

function onKey(e) {
  if (e.key === 'Escape') {
    e.stopPropagation();
    closePanHero();
  }
}

function onPlaybackChange() {
  // If the user stops transport while open, notes freeze — surface a hint
  // rather than auto-closing.
  if (hintEl) hintEl.hidden = gridA.playing;
}

// Cap the backing-store resolution. The falling circles don't need retina
// crispness, and clearRect + fills + the per-frame GPU upload scale with pixel
// count — an uncapped 2× DPR on a large desktop viewport is several times the
// work of a phone.
const MAX_DPR = 1.5;

// Sync the canvas backing store to its CSS box. CSS owns the box (a centred
// column on desktop, full width on mobile — see css/pan-hero.css); we only
// re-measure when the viewport actually changed, since getBoundingClientRect
// forces a layout flush and this runs from the frame loop.
function onResize(force) {
  if (!canvas) return;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!force && vw === lastVW && vh === lastVH) return;
  lastVW = vw;
  lastVH = vh;

  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  const rect = canvas.getBoundingClientRect();
  canvasCssW = Math.round(rect.width);
  canvasCssH = Math.round(rect.height);
  canvas.width = Math.round(canvasCssW * dpr);
  canvas.height = Math.round(canvasCssH * dpr);
  cctx.setTransform(1, 0, 0, 1, 0, 0);
  cctx.scale(dpr, dpr);
  boxes = null; // rects are now stale
}

// The resize/orientation listeners must bypass onResize's "viewport unchanged"
// gate — a device-toolbar DPR change or a CSS breakpoint cross can resize the
// canvas box without changing window.innerWidth/Height.
function onForcedResize() {
  onResize(true);
}

function maybeReforceSide() {
  if (frameCount % 30 !== 0) return;
  if (getHandpanSide() !== 'perimeter') setHandpanSide('perimeter');
}

// The pinned pan is fixed-position with its breathing animation frozen, so its
// box is stable while open — no need to hit getBoundingClientRect() (a layout
// flush) every frame. `boxes` is refreshed on resize and every
// REFRESH_RECTS_EVERY frames as a safety net.
const REFRESH_RECTS_EVERY = 20;

function refreshBoxes() {
  const overlay = document.getElementById('handpanOverlay');
  const wrap = document.getElementById('handpanWrap');
  boxes = {
    overlay: overlay ? overlay.getBoundingClientRect() : null,
    wrap: wrap ? wrap.getBoundingClientRect() : null,
    canvas: canvas.getBoundingClientRect(),
  };
}

// Cap the render rate to ~60fps. On a 120Hz (ProMotion) display rAF fires
// twice as often with half the budget; the falling-note motion gains nothing
// from 120fps and the playback clock is continuous, so skipping alternate
// frames is invisible.
const MIN_FRAME_MS = 15;

function loop() {
  if (!active) return;
  rafId = requestAnimationFrame(loop);

  const now = performance.now();
  if (now - lastDrawTs < MIN_FRAME_MS) return;
  lastDrawTs = now;

  frameCount++;
  onResize();
  maybeReforceSide();
  if (!boxes || frameCount % REFRESH_RECTS_EVERY === 0) refreshBoxes();

  const pos = getPlaybackPosition(gridA);
  const t = pos.step + pos.fraction;

  updateSparks();
  draw(t);
}

// ---------------------------------------------------------------------------

function isDark() {
  return document.body.classList.contains('dark');
}

// Hand colours. Pan Hero always sits on a near-black overlay, so it always
// uses the dark-theme grid palette (--up-fill / --down-fill from
// css/grid-and-labels.css) regardless of the app theme — L = blue, R = pink,
// matching the studio's sub-dot / cell colours. rgb() so lerpToWhite() parses.
function handColor(hand) {
  return hand === 'L' ? 'rgb(30, 121, 232)' : 'rgb(253, 3, 128)';
}

function labelText(label) {
  const s = String(label);
  if (s === 'Ding' || s === 'D' || s === '0') return 'D';
  return s;
}

// Resolve a note's tonefield centre to screen pixels for THIS frame.
// Two coordinate spaces: rim pucks are 0-100 of #handpanWrap (padding
// included); everything else is 0-100 of #handpanOverlay (the image area).
function tonefieldScreenPos(key, boxes) {
  const p = getDisplayPosition(key);
  if (!p) return null;
  const isRim = isPerimeterNote(key);
  const box = isRim ? boxes.wrap : boxes.overlay;
  if (!box || box.width === 0) return null;
  const r = (HANDPAN_MAP[key] && HANDPAN_MAP[key].r) || 8;
  return {
    x: (box.left - boxes.canvas.left) + (p.x / 100) * box.width,
    y: (box.top - boxes.canvas.top) + (p.y / 100) * box.height,
    rpx: (r / 100) * box.width,
  };
}

function draw(t) {
  const w = canvasCssW;
  const h = canvasCssH;
  cctx.clearRect(0, 0, w, h);

  const total = gridA.cells.length;
  if (!total || !boxes || !boxes.overlay) { drawSparks(); return; }

  const stepSec = intervalMs(gridA) / 1000;
  const mobile = window.innerWidth < 700;
  const leadSeconds = mobile ? LEAD_SECONDS_MOBILE : LEAD_SECONDS_DESKTOP;
  const leadSteps = Math.max(1, leadSeconds / stepSec);

  // Tonefield vertical spread this frame. minHitY (topmost field) sets the
  // fall speed so the earliest note spawns near the top; the range drives the
  // per-note size cue: a note bound for a low field (falls further) is drawn
  // bigger so the player knows to let it travel; a small circle lands high.
  const yr = tonefieldYRange(boxes);
  const minHitY = Number.isFinite(yr.min) ? yr.min : h * 0.45;
  const ySpread = yr.max > yr.min ? yr.max - yr.min : 1;
  const pxPerStep = minHitY / leadSteps;

  const baseR = mobile ? 15 : 19;

  const firstJ = Math.floor(t) - 1;
  const lastJ = Math.ceil(t + leadSteps) + 1;
  const lanesDrawn = new Set();

  for (let j = firstJ; j <= lastJ; j++) {
    if (j < 0) continue;
    const i = ((j % total) + total) % total;
    const raw = gridA.innerLabels[i];
    if (!raw) continue;

    const dt = j - t;
    if (dt < -0.5) { sparked.delete(j); continue; }

    const isChord = Array.isArray(raw);
    // Keep the ORIGINAL slot index — filtering out empty slots would re-index
    // and desync each note from its slot.
    const slots = isChord ? raw : [raw];

    slots.forEach((label, subIdx) => {
      if (!label) return;
      // Match the STUDIO grid's colouring exactly:
      //  - chord sub-dots are coloured purely by column (slots 0,1 = left/L,
      //    slots 2,3 = right/R — css/grid-and-labels.css .hand-column rules),
      //    regardless of any cell-level manual sticking.
      //  - single notes use getEffectiveHand() (manual override, else the
      //    8th-note alternation) — the same call renderAllMeasures() makes.
      const hand = isChord
        ? (subIdx <= 1 ? 'L' : 'R')
        : getEffectiveHand(i, gridA);
      const key = resolveTakSlapNote(String(label), hand);
      const tf = tonefieldScreenPos(key, boxes);
      if (!tf) return;

      const x = tf.x;
      // Falls until its centre reaches the tonefield centre (dt <= 0), then
      // holds there — never slides past.
      const y = tf.y - Math.max(0, dt) * pxPerStep;
      if (y < -40) return;

      // Size cue: bigger circle = lands lower on the pan (further to fall).
      const yNorm = (tf.y - yr.min) / ySpread;               // 0 top … 1 bottom
      const sizeFactor = 0.7 + yNorm * 0.75;
      const radius = baseR * sizeFactor;

      // Lane guide (once per x per frame): faint full lane + a brighter
      // "target zone" segment just above the tonefield.
      const laneKey = Math.round(x);
      if (!lanesDrawn.has(laneKey)) {
        lanesDrawn.add(laneKey);
        cctx.save();
        cctx.strokeStyle = isDark() ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.045)';
        cctx.lineWidth = 2;
        cctx.beginPath();
        cctx.moveTo(x, 0);
        cctx.lineTo(x, tf.y);
        cctx.stroke();
        cctx.strokeStyle = isDark() ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.12)';
        cctx.lineWidth = 3;
        cctx.beginPath();
        cctx.moveTo(x, tf.y - radius * 2.4);
        cctx.lineTo(x, tf.y);
        cctx.stroke();
        cctx.restore();
      }

      drawPuck(x, y, radius, label, hand, dt);

      // Landing burst — once per pass of step j
      if (dt <= 0 && dt > -0.25 && !sparked.has(j)) {
        sparked.add(j);
        createBurst(tf.x, tf.y, handColor(hand));
      }
    });
  }

  drawSparks();
}

const APPROACH_STEPS = 4;   // ring is visible this many steps before impact
const APPROACH_GAP = 34;    // px the ring sits outside the puck at full lead

function drawPuck(x, y, radius, label, hand, dt) {
  const col = handColor(hand);
  const bright = lerpToWhite(col, 0.4);
  let r = radius;
  let fill = col;
  let alpha = 1;

  // Approach pop in the last step before impact
  if (dt > 0 && dt <= 1) {
    const pop = Math.exp(-6 * (1 - dt));
    r += radius * 0.5 * pop;
    fill = lerpToWhite(col, 0.6 * pop);
  }
  // Rest fade — after landing the puck holds on the tonefield and fades out.
  if (dt <= 0) {
    alpha = Math.max(0, 1 + dt / 0.5); // 1 at impact → 0 at dt = -0.5
    fill = lerpToWhite(col, 0.5);
  }

  cctx.save();
  cctx.globalAlpha = alpha;

  // Approach ring — shrinks to meet the puck edge exactly at the beat (dt=0),
  // the clearest "play NOW" cue. Bright hand-coloured; a soft translucent halo
  // ring gives it presence against the dark background without canvas
  // shadowBlur (which is a per-fill perf killer on large canvases).
  if (dt > 0 && dt < APPROACH_STEPS) {
    const k = dt / APPROACH_STEPS;                  // 1 far → 0 at impact
    const ringR = r + APPROACH_GAP * k;
    cctx.globalAlpha = alpha * (0.16 + 0.14 * (1 - k));
    cctx.strokeStyle = bright;
    cctx.lineWidth = 7;
    cctx.beginPath();
    cctx.arc(x, y, ringR, 0, Math.PI * 2);
    cctx.stroke();
    cctx.globalAlpha = alpha * (0.6 + 0.4 * (1 - k));
    cctx.lineWidth = 2.5 + 3 * (1 - k);
    cctx.beginPath();
    cctx.arc(x, y, ringR, 0, Math.PI * 2);
    cctx.stroke();
    cctx.globalAlpha = alpha;
  }

  // Puck: outer soft halo + solid core (cheap stand-in for a drop shadow).
  cctx.globalAlpha = alpha * 0.28;
  cctx.fillStyle = col;
  cctx.beginPath();
  cctx.arc(x, y, r + 6, 0, Math.PI * 2);
  cctx.fill();
  cctx.globalAlpha = alpha;
  cctx.beginPath();
  cctx.arc(x, y, r, 0, Math.PI * 2);
  cctx.fillStyle = fill;
  cctx.fill();

  cctx.fillStyle = '#fff';
  cctx.font = `600 ${Math.round(r * 0.95)}px system-ui, sans-serif`;
  cctx.textAlign = 'center';
  cctx.textBaseline = 'middle';
  cctx.fillText(labelText(label), x, y + 1);
  cctx.restore();
}

// ---------------------------------------------------------------------------
// Helpers

function tonefieldYRange(boxes) {
  let min = Infinity;
  let max = -Infinity;
  for (const key of Object.keys(HANDPAN_MAP)) {
    const tf = tonefieldScreenPos(key, boxes);
    if (!tf) continue;
    if (tf.y < min) min = tf.y;
    if (tf.y > max) max = tf.y;
  }
  return { min, max };
}

function lerpToWhite(rgb, amt) {
  const m = rgb.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!m) return rgb;
  const r = Math.round(+m[1] + (255 - +m[1]) * amt);
  const g = Math.round(+m[2] + (255 - +m[2]) * amt);
  const b = Math.round(+m[3] + (255 - +m[3]) * amt);
  return `rgb(${r}, ${g}, ${b})`;
}

// Sparks (ported from presentation-mode.js)
function updateSparks() {
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.x += s.vx;
    s.y += s.vy;
    s.vy += 0.35;
    s.alpha *= 0.9;
    if (s.alpha < 0.02) sparks.splice(i, 1);
  }
}

function createBurst(x, y, color) {
  for (let k = 0; k < 12; k++) {
    sparks.push({
      x, y,
      vx: (Math.random() - 0.5) * 10,
      vy: (Math.random() - 0.5) * 10 - 2,
      alpha: 1,
      color,
    });
  }
}

function drawSparks() {
  for (const s of sparks) {
    cctx.globalAlpha = Math.max(0, s.alpha);
    cctx.fillStyle = s.color;
    cctx.beginPath();
    cctx.arc(s.x, s.y, 3, 0, Math.PI * 2);
    cctx.fill();
  }
  cctx.globalAlpha = 1;
}
