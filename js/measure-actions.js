import { alert, confirm } from './alert.js';
import { activeGrid } from './grid-context.js';
import { renderAllMeasures } from './notegrid.js';
import { setCaret, setRange, clearRange, getRange } from './range-selection.js';
import { HistoryManager } from './history.js';

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

// ===== Add measure ===== //

export function appendEmptyMeasure(ctx, skipHistory = false) {
  const c = ctx || activeGrid;
  const s = c.stepsPerMeasure;

  if (!skipHistory && HistoryManager) HistoryManager.pushState();

  if (Array.isArray(c.innerLabels)) c.innerLabels.push(...Array(s).fill(''));
  if (Array.isArray(c.innerHands)) c.innerHands.push(...Array(s).fill(null));
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
  if (Array.isArray(c.innerLabels)) c.innerLabels.splice(start, s);
  if (Array.isArray(c.innerHands)) c.innerHands.splice(start, s);

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

  // Append new measures to fit duplication
  for (let i = 0; i < measuresNeeded; i++) {
    appendEmptyMeasure(c, true); // true = skip redundant history push
  }

  const oldTotalSteps = c.innerLabels.length - (measuresNeeded * s);
  const copyFrom = c.innerLabels.slice(r.start, r.end + 1);
  const copyHands = c.innerHands.slice(r.start, r.end + 1);

  for (let k = 0; k < copyFrom.length; k++) {
    c.innerLabels[oldTotalSteps + k] = copyFrom[k];
    c.innerHands[oldTotalSteps + k] = copyHands[k];
  }

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

  if (Array.isArray(c.innerLabels)) {
    c.innerLabels.splice(startM * s, countToDelete * s);
    c.innerHands.splice(startM * s, countToDelete * s);

    // If we deleted everything, add one empty measure back
    if (c.innerLabels.length === 0) {
      c.innerLabels.push(...Array(s).fill(''));
      c.innerHands.push(...Array(s).fill(null));
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

// ===== UI EVENT LISTENERS ===== //

export function initMeasureActions() {
  document.getElementById('addMeasureBtn')?.addEventListener('click', () => {
    const ctx = activeGrid;
    appendEmptyMeasure(ctx);
    // append is end?
    const m = ctx.measures - 1;
    const { start } = measureRange(m, ctx);
    setCaret(start, ctx);
  });

  document.getElementById('delMeasureBtn')?.addEventListener('click', async () => {
    const ctx = activeGrid;
    const range = getRange(ctx);
    if (range && range.length > 1) {
      const s = ctx.stepsPerMeasure;
      const startM = Math.floor(range.start / s);
      const endM = Math.floor(range.end / s);
      await deleteMeasuresRange(startM, endM, ctx);
    } else {
      await deleteMeasure(getActiveMeasureIndex(ctx), ctx);
    }
  });

  document.getElementById('selDuplicateBtn')?.addEventListener('click', async () => {
    await duplicateSelection(activeGrid);
  });
}
