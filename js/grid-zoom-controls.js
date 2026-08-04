// grid-zoom-controls.js
//
// Zoom +/- for the note grid. Replaces an earlier, removed attempt
// (js/grid-zoom.js) that used a CSS `zoom:` transform on the whole grid —
// that scaled everything visually but never changed how many cells fit per
// row, so it couldn't produce "zoom in enough and the measure wraps."
//
// Model: "cellsAcross" (how many cells should fit across one visual row) is
// the thing that's locked to a musically sensible value — either a divisor
// of stepsPerMeasure (zoom in: one measure splits across multiple rows,
// reusing the same CSS Grid auto-wrap mobile already relies on) or a
// multiple of stepsPerMeasure (zoom out: several whole measures share one
// row, each keeping its own independent grid + label row side by side).
// Both --cols (for a single measure's internal grid) and each measure's
// actual pixel size are derived from cellsAcross, never stored directly.

import { activeGrid } from './grid-context.js';
import { Bus, BUS_EVENT } from './bus.js';

const STORAGE_KEY = 'groovepan_zoom_cellsAcross';
const TARGET_DEFAULT_ACROSS = 8; // "comfortably fit 8 across" on first load

// Builds the full ordered set of valid cellsAcross values for a given
// stepsPerMeasure, from most zoomed-in (smallest cellsAcross) to most
// zoomed-out (largest), plus which index represents "unzoomed" (one full
// measure per row) and which is the recommended ~8-across default.
export function buildZoomLevels(s) {
  const divisorsAsc = [];
  for (let d = 1; d <= Math.floor(s / 2); d++) {
    if (s % d === 0) divisorsAsc.push(d);
  }
  // A step count with no divisor below itself (other than 1) is prime —
  // give it one intermediate zoom-in step (an uneven split, e.g. 7 -> 4+3)
  // instead of jumping straight from the whole measure to one cell per row.
  const prime = divisorsAsc.length === 1 && divisorsAsc[0] === 1 && s > 3;

  const belowDefault = divisorsAsc.map(d => ({ cellsAcross: d, cols: d, measuresPerRow: 1, uneven: false }));
  if (prime) {
    const half = Math.ceil(s / 2);
    belowDefault.push({ cellsAcross: half, cols: half, measuresPerRow: 1, uneven: true });
  }

  const unzoomedLevel = { cellsAcross: s, cols: s, measuresPerRow: 1, uneven: false };

  // Generous enough to always include the ~8-across default multiple, even
  // for a very small stepsPerMeasure (e.g. s=1 would need up to 8x).
  const maxMultiple = Math.max(6, Math.ceil(TARGET_DEFAULT_ACROSS / Math.max(1, s)));
  const aboveDefault = [];
  for (let m = 2; m <= maxMultiple; m++) {
    aboveDefault.push({ cellsAcross: m * s, cols: s, measuresPerRow: m, uneven: false });
  }

  const levels = [...belowDefault, unzoomedLevel, ...aboveDefault];

  // Recommended default: whichever valid level's cellsAcross is closest to
  // (without exceeding) 8 — covers both "zoom in a large measure toward 8"
  // and "fit multiple small measures to reach 8" with the same rule.
  let recommendedIndex = belowDefault.length;
  let bestDiff = Infinity;
  levels.forEach((lvl, i) => {
    if (lvl.cellsAcross <= TARGET_DEFAULT_ACROSS) {
      const diff = TARGET_DEFAULT_ACROSS - lvl.cellsAcross;
      if (diff < bestDiff) { bestDiff = diff; recommendedIndex = i; }
    }
  });

  return { levels, unzoomedIndex: belowDefault.length, recommendedIndex };
}

function readStoredCellsAcross() {
  const raw = localStorage.getItem(STORAGE_KEY);
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function writeStoredCellsAcross(cellsAcross) {
  localStorage.setItem(STORAGE_KEY, String(cellsAcross));
}

// Resolves the level to actually render for the given stepsPerMeasure: the
// persisted preference if it's still valid for this s, otherwise the
// recommended ~8-across default (also persisting that as the new value, so
// a since-changed time signature settles on a sensible level going forward).
export function getCurrentZoomLevel(ctx) {
  const c = ctx || activeGrid;
  const s = c.stepsPerMeasure;
  const { levels, recommendedIndex } = buildZoomLevels(s);

  const stored = readStoredCellsAcross();
  const match = stored != null ? levels.find(l => l.cellsAcross === stored) : null;
  if (match) return match;

  const fallback = levels[recommendedIndex];
  writeStoredCellsAcross(fallback.cellsAcross);
  return fallback;
}

function stepZoom(ctx, direction) {
  const c = ctx || activeGrid;
  const s = c.stepsPerMeasure;
  const { levels } = buildZoomLevels(s);

  const current = getCurrentZoomLevel(c);
  const currentIndex = levels.findIndex(l => l.cellsAcross === current.cellsAcross);
  const nextIndex = Math.max(0, Math.min(levels.length - 1, currentIndex + direction));

  writeStoredCellsAcross(levels[nextIndex].cellsAcross);
  // notegrid.js listens for this and calls renderAllMeasures itself — kept
  // as an event rather than a direct import to avoid a circular dependency
  // (notegrid.js needs getCurrentZoomLevel from this file to render at all).
  Bus.emit(BUS_EVENT.GRID_ZOOM_CHANGED, { ctx: c });
}

// direction convention: zoom IN = bigger cells = fewer cellsAcross = walk
// toward the start of the (ascending) levels array, i.e. index - 1.
export function zoomIn(ctx) { stepZoom(ctx, -1); }
export function zoomOut(ctx) { stepZoom(ctx, 1); }

export function initGridZoom() {
  document.getElementById('zoomInBtn')?.addEventListener('click', () => zoomIn(activeGrid));
  document.getElementById('zoomOutBtn')?.addEventListener('click', () => zoomOut(activeGrid));
}
