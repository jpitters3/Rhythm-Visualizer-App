// Handpan Pattern Preview
//
// A small animated handpan (dots glowing in sequence over the handpan
// image) that plays a saved pattern's rhythm. Ported from the old Welcome
// Dashboard's buildWelcomeHandpan (see git history on js/dashboard.js) so
// it can be reused anywhere a pattern needs a visual preview — currently
// the Patterns modal (js/patterns-modal.js).
//
// Unlike the live grid, this resolves notes directly from a given SCALES
// entry rather than the user's currently-active scale, so a preview can
// show a pattern's *intended* scale regardless of what the viewer has
// mounted.

import { intervalMs, resolveHand, playNoteSample, ensureNoteSampleLoaded } from './noteplayer.js';
import { getScale } from './state.js';
import { SCALES } from './config.js';
import { HANDPAN_MAP } from './handpanmap.js';

const SOUND_TAK = 'Tak';
const SOUND_SLAP = 'Slap';

// Matches HANDPAN_MAP_BRONZE in handpanmap.js (calibrated for handpan-for-groovepan.png)
export const PREVIEW_HP_MAP = {
  'Ding': { x: 48.1, y: 45.6, r: 12 },
  '1':    { x: 58.9, y: 75.7, r: 10 },
  '2':    { x: 34.4, y: 75.3, r: 10 },
  '3':    { x: 77.9, y: 59.2, r: 10 },
  '4':    { x: 17.9, y: 55.9, r: 10 },
  '5':    { x: 77.5, y: 34.8, r: 9  },
  '6':    { x: 21.1, y: 32.6, r: 9  },
  '7':    { x: 60,   y: 18.8, r: 8  },
  '8':    { x: 38.3, y: 18.6, r: 8  },
  'T':    { x: 61.1, y: 56.3, r: 7  },
  'S':    { x: 93.3, y: 47.9, r: 6  },
};

function noteForLabelInScale(label, scale) {
  if (label === 'T') return SOUND_TAK;
  if (label === 'S') return SOUND_SLAP;
  if (!scale) return null;
  if (label === 'Ding' || label === 'D') return `${scale.ding}_ding`;
  if (scale.map && scale.map[label]) return scale.map[label];
  return null;
}

// HANDPAN_MAP (live export from handpanmap.js) always reflects whatever the
// viewer currently has mounted in the studio — system or custom handpan —
// so it's the source of truth for "my handpan"'s actual tone field
// positions. It uses T_R/T_L/S_R/S_L (split by hand); PREVIEW_HP_MAP only
// has one T/S each, so the right-hand variant is used as a reasonable
// stand-in. Any key HANDPAN_MAP doesn't have falls back to the default
// PREVIEW_HP_MAP position rather than leaving a dot unplaced.
function buildDotMapFromCurrentHandpan() {
  const map = {};
  for (const key of Object.keys(PREVIEW_HP_MAP)) {
    const sourceKey = key === 'T' ? 'T_R' : key === 'S' ? 'S_R' : key;
    const entry = HANDPAN_MAP[sourceKey];
    map[key] = entry ? { x: entry.x, y: entry.y, r: entry.r || 8 } : PREVIEW_HP_MAP[key];
  }
  return map;
}

// Mounts a preview into `overlayEl` (an empty, positioned element sized to
// the handpan image behind it). Dots are positioned immediately, but the
// looping flash animation only actually runs while playing (autoplay:true
// at mount, or after play() is called) — many cards flashing at once is a
// real photosensitivity hazard, so only one card should ever animate at a
// time (see js/patterns-modal.js, which enforces that + autoplays only the
// first card by default).
export function mountHandpanPreview(overlayEl, patternData, { scaleName, sound = false, autoplay = false } = {}) {
  const intendedScale = SCALES[scaleName] || Object.values(SCALES)[0];
  let scale = intendedScale;

  overlayEl.innerHTML = '';
  const dots = new Map();

  for (const [note, p] of Object.entries(PREVIEW_HP_MAP)) {
    const dot = document.createElement('div');
    dot.className = 'pp-dot';
    dot.dataset.note = note;
    const visual = document.createElement('div');
    visual.className = 'pp-visual';
    dot.appendChild(visual);
    overlayEl.appendChild(dot);
    dots.set(note, dot);
  }

  // Width only (as % of container width) + aspect-ratio:1 on .pp-dot — the
  // container isn't square, so equal width%/height% would map to different
  // pixel amounts and render as an oval. aspect-ratio locks the rendered
  // height to match the resolved pixel width instead.
  function applyDotPositions(map) {
    for (const [note, dot] of dots.entries()) {
      const p = map[note] || PREVIEW_HP_MAP[note];
      dot.style.cssText = `left:${p.x}%;top:${p.y}%;width:${p.r * 2}%;transform:translate(-50%,-50%)`;
    }
  }
  applyDotPositions(PREVIEW_HP_MAP);

  const rawLabels = patternData?.labels || [];
  const rawHands = patternData?.hands || [];

  const sequence = rawLabels.map((l, stepIndex) => {
    if (!l) return { note: null, rawLabel: null, stepIndex };
    if (Array.isArray(l)) {
      const notes = l.map((s, originalIdx) => {
        const u = String(s).toUpperCase();
        const n = (u === 'D' || u === 'DING') ? 'Ding' : s;
        return PREVIEW_HP_MAP[n] ? { note: n, originalIdx } : null;
      }).filter(Boolean);
      return { note: notes.length ? notes : null, rawLabel: l, stepIndex };
    }
    const u = String(l).toUpperCase();
    const n = (u === 'D' || u === 'DING') ? 'Ding' : l;
    return { note: PREVIEW_HP_MAP[n] ? n : null, rawLabel: l, stepIndex };
  });

  const hasNotes = sequence.some(s => s.note);
  const playSequence = hasNotes
    ? sequence
    : Object.keys(PREVIEW_HP_MAP).map((note, stepIndex) => ({ note, rawLabel: note, stepIndex }));

  const ms = Math.max(80, intervalMs({ bpm: patternData?.bpm || 90, subdivision: patternData?.subdivision || 2 }));
  const animDuration = Math.max(200, ms * 3.2);

  let soundOn = sound;
  let i = 0;
  let intervalId = null;

  function tick() {
    const { note, rawLabel, stepIndex } = playSequence[i % playSequence.length];
    i++;

    if (rawLabel && soundOn) {
      const labels = Array.isArray(rawLabel) ? rawLabel : [rawLabel];
      for (const l of labels) {
        if (!l) continue;
        const u = String(l).toUpperCase();
        const n = (u === 'D' || u === 'DING') ? 'Ding' : l;
        const sampleName = noteForLabelInScale(n, scale);
        if (sampleName) ensureNoteSampleLoaded(sampleName).then(() => playNoteSample(sampleName));
      }
    }

    if (!note) return;

    const isChord = Array.isArray(note);
    const notesToHighlight = isChord ? note : [{ note, originalIdx: 0 }];
    const stepHandData = rawHands[stepIndex];

    for (const { note: n, originalIdx } of notesToHighlight) {
      const dot = dots.get(n);
      const visual = dot?.querySelector('.pp-visual');
      if (!visual) continue;

      const hand = resolveHand(stepIndex, stepHandData, originalIdx, isChord, patternData?.subdivision || 2);
      const down = hand === 'R';
      const shadowColor = down ? 'var(--down-fill)' : 'var(--up-fill)';

      visual.animate([
        { transform: 'scale(1)', backgroundColor: 'rgba(255,255,255,0.4)', boxShadow: `0 0 14px 7px ${shadowColor}`, opacity: 1 },
        { transform: 'scale(1.5)', backgroundColor: 'transparent', boxShadow: '0 0 0 0 transparent', opacity: 0 },
      ], { duration: animDuration, easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)' });
    }
  }

  function startAnimating() {
    if (intervalId) return; // already running
    intervalId = setInterval(tick, ms);
  }

  function stopAnimating() {
    clearInterval(intervalId);
    intervalId = null;
  }

  if (autoplay) startAnimating();

  return {
    // Fully tears down — stops animating and clears the DOM. Used when a
    // card leaves the grid (re-render/close), not for a regular pause.
    stop() {
      stopAnimating();
      overlayEl.innerHTML = '';
    },
    // Stops animating/muting without clearing the DOM — dots stay in place,
    // just idle. Used when another card starts playing, or the user stops
    // this one.
    pause() {
      stopAnimating();
      soundOn = false;
    },
    setSound(on) {
      soundOn = on;
    },
    // Unmutes, restarts from step 0, and (re)starts the animation loop if it
    // wasn't already running — used by the play button.
    play() {
      soundOn = true;
      i = 0;
      startAnimating();
    },
    // 'mine' reads the viewer's currently-active scale live (system or
    // custom handpan, whatever getScale()/HANDPAN_MAP resolve to right now)
    // instead of the Mini-Course's intended scale/dot layout. 'intended'
    // switches both back. Always restarts from step 0 so the phrase doesn't
    // pick up mid-sequence with the new scale's pitches/hand assignments.
    setScaleSource(source) {
      if (source === 'mine') {
        scale = getScale() || intendedScale;
        applyDotPositions(buildDotMapFromCurrentHandpan());
      } else {
        scale = intendedScale;
        applyDotPositions(PREVIEW_HP_MAP);
      }
      i = 0;
    },
  };
}
