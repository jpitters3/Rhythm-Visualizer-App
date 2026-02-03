import { activeGrid } from './grid-context.js';
import { calculateSteps, getTimeSignature } from './rhythm-core.js';
import { renderAllMeasures } from './notegrid.js';
import { setCaret, setRange, clearRange, getRange } from './range-selection.js';

export function getStepCountPerMeasure(ctx) {
  const c = ctx || activeGrid;
  return calculateSteps(getTimeSignature(), c.mode);
}

function getAllCellsFlat(ctx) {
  return Array.from((ctx || activeGrid).cells);
}

export function getMeasureCount(ctx) {
  return (ctx || activeGrid).measures;
}

export function getActiveMeasureIndex(ctx) {
  const c = ctx || activeGrid;
  const s = getStepCountPerMeasure(c);
  const idx = c.caretIndex ?? 0;
  return Math.floor(idx / s);
}

export function measureRange(mIndex, ctx) {
  const c = ctx || activeGrid;
  const s = getStepCountPerMeasure(c);
  const start = mIndex * s;
  const end = start + s - 1;
  // return { start, end, length: s }; 
  // Wait, the original code returned this.
  return { start, end, length: s };
}

// ===== Add measure ===== //

export function appendEmptyMeasure(ctx) {
  const c = ctx || activeGrid;
  const s = getStepCountPerMeasure(c);
  if (Array.isArray(c.innerLabels)) c.innerLabels.push(...Array(s).fill(''));
  if (Array.isArray(c.innerHands)) c.innerHands.push(...Array(s).fill(null));
  renderAllMeasures(c);
}

// ===== Delete measure =====

export function deleteMeasure(mIndex, ctx) {
  const c = ctx || activeGrid;
  const s = getStepCountPerMeasure(c);
  const totalMeasures = c.measures;

  if (totalMeasures <= 1) {
    alert('You must have at least 1 measure.');
    return;
  }

  const ok = confirm(`Delete measure ${mIndex + 1}?`);
  if (!ok) return;

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

export function duplicateSelection(ctx) {
  const c = ctx || activeGrid;
  const r = getRange(c);
  if (!r) {
    alert('Please select a range of notes to duplicate.');
    return;
  }

  if (window.HistoryManager) window.HistoryManager.pushState();

  const s = getStepCountPerMeasure(c);
  const totalSelectedSteps = r.length;
  const measuresNeeded = Math.ceil(totalSelectedSteps / s);

  // Append new measures to fit duplication
  for (let i = 0; i < measuresNeeded; i++) {
    appendEmptyMeasure(c);
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

export function deleteMeasuresRange(startM, endM, ctx) {
  const c = ctx || activeGrid;
  const s = getStepCountPerMeasure(c);
  const countToDelete = (endM - startM + 1);

  if (!confirm(`Delete ${countToDelete} selected measure(s)?`)) return;

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

document.getElementById('addMeasureBtn')?.addEventListener('click', () => {
  const ctx = activeGrid;
  appendEmptyMeasure(ctx);
  const m = ctx.measures - 1;
  const { start } = measureRange(m, ctx);
  setCaret(start, ctx);
});

document.getElementById('delMeasureBtn')?.addEventListener('click', () => {
  const ctx = activeGrid;
  const range = getRange(ctx);
  if (range && range.length > 1) {
    const s = getStepCountPerMeasure(ctx);
    const startM = Math.floor(range.start / s);
    const endM = Math.floor(range.end / s);
    deleteMeasuresRange(startM, endM, ctx);
  } else {
    deleteMeasure(getActiveMeasureIndex(ctx), ctx);
  }
});

document.getElementById('selDuplicateBtn')?.addEventListener('click', () => {
  duplicateSelection(activeGrid);
});

// ==== WINDOW EXPOSE ====
window.getStepCountPerMeasure = getStepCountPerMeasure;
window.appendEmptyMeasure = appendEmptyMeasure;
window.deleteMeasure = deleteMeasure;
window.duplicateSelection = duplicateSelection;
window.deleteMeasuresRange = deleteMeasuresRange;
window.getActiveMeasureIndex = getActiveMeasureIndex;
window.measureRange = measureRange;
