import { alert, confirm } from './alert.js';
import { activeGrid } from './grid-context.js';
import { renderAllMeasures } from './notegrid.js';
import { setCaret, setRange, clearRange, getRange } from './range-selection.js';
import { HistoryManager } from './history.js';
import { Bus, BUS_EVENT } from './bus.js';

export function getStepCountPerMeasure(ctx) {
  const c = ctx || activeGrid;
  return c.stepsPerMeasure;
}

function getAllCellsFlat(ctx) {
  return Array.from((ctx || activeGrid).cells);
}

export function getMeasureCount(ctx) {
  return (ctx || activeGrid).measures;
}

export function getActiveMeasureIndex(ctx) {
  const c = ctx || activeGrid;
  const s = c.stepsPerMeasure;
  const idx = c.caretIndex ?? 0;
  return Math.floor(idx / s);
}

export function measureRange(mIndex, ctx) {
  const c = ctx || activeGrid;
  const s = c.stepsPerMeasure;
  const start = mIndex * s;
  const end = start + s - 1;
  return { start, end, length: s };
}

// Sections are per measure, so pad to the current count before any splice
function sectionsFor(c, count = c.measures) {
  if (!Array.isArray(c.measureSections)) c.measureSections = [];
  const list = c.measureSections;
  for (let i = 0; i < count; i++) if (list[i] === undefined) list[i] = null;
  return list;
}

// ===== Add measure ===== //

export function appendEmptyMeasure(ctx, skipHistory = false) {
  const c = ctx || activeGrid;
  const s = c.stepsPerMeasure;

  if (!skipHistory && HistoryManager) HistoryManager.pushState();

  sectionsFor(c).splice(c.measures, Infinity, null);
  if (Array.isArray(c.innerLabels)) c.innerLabels.push(...Array(s).fill(''));
  if (Array.isArray(c.innerHands)) c.innerHands.push(...Array(s).fill(null));
  if (Array.isArray(c.innerFlams)) c.innerFlams.push(...Array(s).fill(''));
  renderAllMeasures(c);

  // Scroll to bottom so the user sees the new measure
  const container = c.container;
  if (container) {
    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'smooth'
    });
  }
}

// ===== Insert measure at position =====
// Mirrors deleteMeasure's splice pattern (measureRange gives the flat-index
// window for a measure) but inserts instead of removing. mIndex is clamped
// to [0, c.measures] so inserting "below" the last measure just appends.
export function insertEmptyMeasureAt(mIndex, ctx, skipHistory = false) {
  const c = ctx || activeGrid;
  const s = c.stepsPerMeasure;
  const clampedIndex = Math.max(0, Math.min(mIndex, c.measures));
  const start = clampedIndex * s;

  if (!skipHistory && HistoryManager) HistoryManager.pushState();

  sectionsFor(c).splice(clampedIndex, 0, null);
  if (Array.isArray(c.innerLabels)) c.innerLabels.splice(start, 0, ...Array(s).fill(''));
  if (Array.isArray(c.innerHands)) c.innerHands.splice(start, 0, ...Array(s).fill(null));
  if (Array.isArray(c.innerFlams)) c.innerFlams.splice(start, 0, ...Array(s).fill(''));

  renderAllMeasures(c);

  setCaret(start, c);
  setRange(start, start, c);
}

// ===== Delete measure =====

export async function deleteMeasure(mIndex, ctx) {
  const c = ctx || activeGrid;
  const s = c.stepsPerMeasure;
  const totalMeasures = c.measures;


  if (totalMeasures <= 1) {
    await alert('You must have at least 1 measure.');
    return;
  }

  const ok = await confirm(`Delete measure ${mIndex + 1}?`);
  if (!ok) return;

  if (HistoryManager) HistoryManager.pushState();

  const { start } = measureRange(mIndex, c);
  sectionsFor(c).splice(mIndex, 1);
  if (Array.isArray(c.innerLabels)) c.innerLabels.splice(start, s);
  if (Array.isArray(c.innerHands)) c.innerHands.splice(start, s);
  if (Array.isArray(c.innerFlams)) c.innerFlams.splice(start, s);

  renderAllMeasures(c);

  const newMeasureCount = c.measures;
  const nextM = Math.min(mIndex, newMeasureCount - 1);
  const nextStart = measureRange(nextM, c).start;
  setCaret(nextStart, c);
  setRange(nextStart, nextStart, c);
  clearRange(c);
}

// ===== Duplicate Selection =====

export async function duplicateSelection(ctx) {
  const c = ctx || activeGrid;
  const r = getRange(c);
  if (!r) {
    await alert('Please select a range of notes to duplicate.');
    return;
  }

  if (HistoryManager) HistoryManager.pushState();

  const s = c.stepsPerMeasure;
  const totalSelectedSteps = r.length;
  const measuresNeeded = Math.ceil(totalSelectedSteps / s);
  const wholeMeasures = r.start % s === 0 && totalSelectedSteps % s === 0;
  const copySections = wholeMeasures
    ? sectionsFor(c).slice(r.start / s, r.start / s + measuresNeeded)
    : [];

  // Append new measures to fit duplication
  for (let i = 0; i < measuresNeeded; i++) {
    appendEmptyMeasure(c, true); // true = skip redundant history push
  }

  const oldTotalSteps = c.innerLabels.length - (measuresNeeded * s);
  const copyFrom = c.innerLabels.slice(r.start, r.end + 1);
  const copyHands = c.innerHands.slice(r.start, r.end + 1);
  const copyFlams = Array.isArray(c.innerFlams) ? c.innerFlams.slice(r.start, r.end + 1) : [];

  // slice() is a shallow copy — a chord/multi cell's value is an array, so the
  // duplicated step would otherwise share the SAME array as the original and
  // editing one sub-note would mutate both. Clone any array entries by value.
  const cloneStep = v => (Array.isArray(v) ? v.slice() : v);

  for (let k = 0; k < copyFrom.length; k++) {
    c.innerLabels[oldTotalSteps + k] = cloneStep(copyFrom[k]);
    c.innerHands[oldTotalSteps + k] = cloneStep(copyHands[k]);
    if (Array.isArray(c.innerFlams)) c.innerFlams[oldTotalSteps + k] = copyFlams[k] ?? '';
  }
  const firstNew = oldTotalSteps / s;
  copySections.forEach((sec, k) => { c.measureSections[firstNew + k] = sec ? { ...sec } : null; });

  renderAllMeasures(c);
  const startIdx = oldTotalSteps;
  const endIdx = oldTotalSteps + copyFrom.length - 1;
  setCaret(endIdx, c);
  setRange(startIdx, endIdx, c);
}

// ===== Delete Multi-Measure Range =====

export async function deleteMeasuresRange(startM, endM, ctx) {
  const c = ctx || activeGrid;
  const s = c.stepsPerMeasure;
  const countToDelete = (endM - startM + 1);

  if (!await confirm(`Delete ${countToDelete} selected measure(s)?`)) return;

  if (HistoryManager) HistoryManager.pushState();

  sectionsFor(c).splice(startM, countToDelete);
  if (Array.isArray(c.innerLabels)) {
    c.innerLabels.splice(startM * s, countToDelete * s);
    c.innerHands.splice(startM * s, countToDelete * s);
    if (Array.isArray(c.innerFlams)) c.innerFlams.splice(startM * s, countToDelete * s);

    // If we deleted everything, add one empty measure back
    if (c.innerLabels.length === 0) {
      c.innerLabels.push(...Array(s).fill(''));
      c.innerHands.push(...Array(s).fill(null));
      if (Array.isArray(c.innerFlams)) c.innerFlams.push(...Array(s).fill(''));
    }
  }

  renderAllMeasures(c);

  // UI Cleanup
  clearRange(c);
  const totalMeasures = c.measures;
  const nextM = Math.min(startM, totalMeasures - 1);
  const nextStart = nextM * s;
  setCaret(nextStart, c);
}

// ===== Move measures (drag-to-reorder) =====
// Moves the block [from, from+count) so it starts at `to`, where `to` is an
// index in the list with the block already removed.
export function moveMeasures(from, count, to, ctx) {
  const c = ctx || activeGrid;
  const s = c.stepsPerMeasure;
  const total = c.measures;
  if (count < 1 || from < 0 || from + count > total) return false;
  const target = Math.max(0, Math.min(to, total - count));
  if (target === from) return false;

  if (HistoryManager) HistoryManager.pushState();

  const moveBlock = (arr, unit) => {
    if (!Array.isArray(arr)) return;
    const block = arr.splice(from * unit, count * unit);
    arr.splice(target * unit, 0, ...block);
  };
  moveBlock(c.innerLabels, s);
  moveBlock(c.innerHands, s);
  moveBlock(c.innerFlams, s);
  moveBlock(sectionsFor(c, total), 1);

  // Caret follows the measure it was in
  const caret = c.caretIndex;
  renderAllMeasures(c);
  if (caret !== null && caret !== undefined) {
    const m = Math.floor(caret / s);
    const offset = caret % s;
    let newM = m;
    if (m >= from && m < from + count) newM = target + (m - from);
    else {
      const without = m > from ? m - count : m;
      newM = without >= target ? without + count : without;
    }
    clearRange(c);
    setCaret(newM * s + offset, c);
  }
  return true;
}

// ===== Sections (colour + name per measure) =====
export const SECTION_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'];
const LABEL_MAX = 24;

// patch: { color?: string|null, label?: string }. Empty section → null.
export function setMeasureSections(measureIndexes, patch, ctx) {
  const c = ctx || activeGrid;
  if (!measureIndexes.length) return;
  if (HistoryManager) HistoryManager.pushState();
  const list = sectionsFor(c);
  measureIndexes.forEach(m => {
    if (m < 0 || m >= c.measures) return;
    const next = { ...(list[m] || {}), ...patch };
    if (!SECTION_COLORS.includes(next.color)) delete next.color;
    next.label = (next.label || '').trim().slice(0, LABEL_MAX);
    if (!next.label) delete next.label;
    list[m] = Object.keys(next).length ? next : null;
  });
  renderAllMeasures(c);
}

// ===== UI EVENT LISTENERS ===== //

// Shared by the +/- corner button (single active measure, no range needed)
// and the long-press selection menu's "Delete measure" entry (usually IS a
// range) — deletes whichever measure(s) the range spans, or just the
// caret's own measure with no range. Both deleteMeasure/deleteMeasuresRange
// already confirm with the user and push to HistoryManager, so undo works
// no matter which path this takes.
async function deleteActiveMeasureOrRange(ctx) {
  const range = getRange(ctx);
  if (range && range.length > 1) {
    const s = ctx.stepsPerMeasure;
    const startM = Math.floor(range.start / s);
    const endM = Math.floor(range.end / s);
    await deleteMeasuresRange(startM, endM, ctx);
  } else {
    await deleteMeasure(getActiveMeasureIndex(ctx), ctx);
  }
}

export function initMeasureActions() {
  document.querySelectorAll('.addMeasureBtn').forEach(btn => {
    btn.addEventListener('click', () => {
      const ctx = activeGrid;
      appendEmptyMeasure(ctx);
      const m = ctx.measures - 1;
      const { start } = measureRange(m, ctx);
      setCaret(start, ctx);
    });
  });

  document.querySelectorAll('.delMeasureBtn').forEach(btn => {
    btn.addEventListener('click', () => deleteActiveMeasureOrRange(activeGrid));
  });

  document.getElementById('selDuplicateBtn')?.addEventListener('click', async () => {
    await duplicateSelection(activeGrid);
  });

  document.getElementById('selInsertAboveBtn')?.addEventListener('click', () => {
    const ctx = activeGrid;
    insertEmptyMeasureAt(getActiveMeasureIndex(ctx), ctx);
  });

  document.getElementById('selInsertBelowBtn')?.addEventListener('click', () => {
    const ctx = activeGrid;
    insertEmptyMeasureAt(getActiveMeasureIndex(ctx) + 1, ctx);
  });

  document.getElementById('selDeleteMeasureBtn')?.addEventListener('click', () => {
    deleteActiveMeasureOrRange(activeGrid);
  });

  // Mobile "+ Measure"/"− Measure" in the notation header (css/layout.css):
  // default to "+"; the moment the user actually clicks/taps a cell, swap
  // to "-". CELL_CLICKED (js/notegrid.js) fires only from that real click
  // handler — deliberately NOT the more general CARET_CHANGED, which also
  // fires from plain programmatic setCaret() calls (loading a pattern,
  // paste, ghost-note nav, auto-advance, the initial grid's
  // own construction defaulting caretIndex to 0) that aren't the user
  // selecting anything and were previously making "-" show from load.
  Bus.on(BUS_EVENT.CELL_CLICKED, () => {
    document.body.classList.add('has-caret');
  });

  // Unselecting (clicking outside the grid, Escape — both call
  // clearSelection(), which sets caretIndex to null and fires
  // CARET_CHANGED) swaps back to "+". Using CARET_CHANGED here, unlike
  // above, is fine: a null caretIndex unambiguously means "nothing is
  // selected" regardless of what caused it.
  Bus.on(BUS_EVENT.CARET_CHANGED, () => {
    if (activeGrid.caretIndex === null) {
      document.body.classList.remove('has-caret');
    }
  });
}
