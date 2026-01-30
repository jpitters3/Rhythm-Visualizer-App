function getStepCountPerMeasure(ctx = window.activeGrid) {
  return calculateSteps(window.getTimeSignature(), ctx.mode);
}

function getAllCellsFlat(ctx = window.activeGrid) {
  return Array.from(ctx.cells);
}

function getMeasureCount(ctx = window.activeGrid) {
  return ctx.measures;
}

function getActiveMeasureIndex(ctx = window.activeGrid) {
  const s = getStepCountPerMeasure(ctx);
  const idx = ctx.caretIndex ?? 0;
  return Math.floor(idx / s);
}

function measureRange(mIndex, ctx = window.activeGrid) {
  const s = getStepCountPerMeasure(ctx);
  const start = mIndex * s;
  const end = start + s - 1;
  return { start, end, length: s };
}

// ===== Add measure ===== //

function appendEmptyMeasure(ctx = window.activeGrid) {
  const s = getStepCountPerMeasure(ctx);
  if (Array.isArray(ctx.innerLabels)) ctx.innerLabels.push(...Array(s).fill(''));
  if (Array.isArray(ctx.innerHands)) ctx.innerHands.push(...Array(s).fill(null));
  renderAllMeasures(ctx);
}

// ===== Delete measure =====

function deleteMeasure(mIndex, ctx = window.activeGrid) {
  const s = getStepCountPerMeasure(ctx);
  const totalMeasures = ctx.measures;

  if (totalMeasures <= 1) {
    alert('You must have at least 1 measure.');
    return;
  }

  const ok = confirm(`Delete measure ${mIndex + 1}?`);
  if (!ok) return;

  const { start } = measureRange(mIndex, ctx);
  if (Array.isArray(ctx.innerLabels)) ctx.innerLabels.splice(start, s);
  if (Array.isArray(ctx.innerHands)) ctx.innerHands.splice(start, s);

  renderAllMeasures(ctx);

  const newMeasureCount = ctx.measures;
  const nextM = Math.min(mIndex, newMeasureCount - 1);
  const nextStart = measureRange(nextM, ctx).start;
  setCaret(nextStart, ctx);
  setRange(nextStart, nextStart, ctx);
  if (typeof clearRange === 'function') clearRange(ctx);
}

// ===== Duplicate Selection =====

function duplicateSelection(ctx = window.activeGrid) {
  const r = (typeof getRange === 'function') ? getRange(ctx) : null;
  if (!r) {
    alert('Please select a range of notes to duplicate.');
    return;
  }

  if (window.HistoryManager) window.HistoryManager.pushState();

  const s = getStepCountPerMeasure(ctx);
  const totalSelectedSteps = r.length;
  const measuresNeeded = Math.ceil(totalSelectedSteps / s);

  // Append new measures to fit duplication
  for (let i = 0; i < measuresNeeded; i++) {
    appendEmptyMeasure(ctx);
  }

  const oldTotalSteps = ctx.innerLabels.length - (measuresNeeded * s);
  const copyFrom = ctx.innerLabels.slice(r.start, r.end + 1);
  const copyHands = ctx.innerHands.slice(r.start, r.end + 1);

  for (let k = 0; k < copyFrom.length; k++) {
    ctx.innerLabels[oldTotalSteps + k] = copyFrom[k];
    ctx.innerHands[oldTotalSteps + k] = copyHands[k];
  }

  renderAllMeasures(ctx);
  const startIdx = oldTotalSteps;
  const endIdx = oldTotalSteps + copyFrom.length - 1;
  setCaret(endIdx, ctx);
  setRange(startIdx, endIdx, ctx);
}

// ===== Delete Multi-Measure Range =====

function deleteMeasuresRange(startM, endM, ctx = window.activeGrid) {
  const s = getStepCountPerMeasure(ctx);
  const countToDelete = (endM - startM + 1);

  if (!confirm(`Delete ${countToDelete} selected measure(s)?`)) return;

  if (Array.isArray(ctx.innerLabels)) {
    ctx.innerLabels.splice(startM * s, countToDelete * s);
    ctx.innerHands.splice(startM * s, countToDelete * s);

    // If we deleted everything, add one empty measure back
    if (ctx.innerLabels.length === 0) {
      ctx.innerLabels.push(...Array(s).fill(''));
      ctx.innerHands.push(...Array(s).fill(null));
    }
  }

  renderAllMeasures(ctx);

  // UI Cleanup
  if (typeof clearRange === 'function') clearRange(ctx);
  const totalMeasures = ctx.measures;
  const nextM = Math.min(startM, totalMeasures - 1);
  const nextStart = nextM * s;
  if (typeof setCaret === 'function') setCaret(nextStart, ctx);
}

// ===== UI EVENT LISTENERS ===== //

document.getElementById('addMeasureBtn')?.addEventListener('click', () => {
  const ctx = window.activeGrid;
  appendEmptyMeasure(ctx);
  const m = ctx.measures - 1;
  const { start } = measureRange(m, ctx);
  setCaret(start, ctx);
});

document.getElementById('delMeasureBtn')?.addEventListener('click', () => {
  const ctx = window.activeGrid;
  const range = (typeof getRange === 'function') ? getRange(ctx) : null;
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
  duplicateSelection(window.activeGrid);
});
