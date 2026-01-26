function getStepCountPerMeasure() {
  return STEPS; // already in your app
}

function getAllCellsFlat() {
  return Array.from(document.querySelectorAll('.cell'));
}

// measures are contiguous blocks of STEPS in DOM order
function getMeasureCountFromDOM() {
  const total = getAllCellsFlat().length;
  return Math.max(1, Math.ceil(total / getStepCountPerMeasure()));
}

function getActiveMeasureIndex() {
  const s = getStepCountPerMeasure();
  const idx = (typeof caretIndex === 'number' && caretIndex >= 0) ? caretIndex
    : (typeof selectedIndex === 'number' && selectedIndex >= 0) ? selectedIndex
      : 0;
  return Math.floor(idx / s);
}

function measureRange(mIndex) {
  const s = getStepCountPerMeasure();
  const start = mIndex * s;
  const end = start + s - 1;
  return { start, end, length: s };
}

// ===== Add measure ===== //

function appendEmptyMeasure() {
  const s = getStepCountPerMeasure();

  // Expand data
  if (Array.isArray(innerLabels)) innerLabels.push(...Array(s).fill(''));

  renderAllMeasures();
}

addMeasureBtn?.addEventListener('click', () => {
  appendEmptyMeasure();
  // move caret to first beat of new measure
  const m = getMeasureCountFromDOM() - 1;
  const { start } = measureRange(m);
  setCaret?.(start);
});

// ===== Delete measure =====

function deleteMeasure(mIndex) {
  const s = getStepCountPerMeasure();
  const totalMeasures = getMeasureCountFromDOM();

  if (totalMeasures <= 1) {
    alert('You must have at least 1 measure.');
    return;
  }

  const ok = confirm(`Delete measure ${mIndex + 1}?`);
  if (!ok) return;

  const { start } = measureRange(mIndex);

  // Remove the slice from data
  if (Array.isArray(innerLabels)) innerLabels.splice(start, s);

  // Rerender
  renderAllMeasures();

  // Place caret at same measure index (or previous if deleted last)
  const newMeasureCount = getMeasureCountFromDOM();
  const nextM = Math.min(mIndex, newMeasureCount - 1);
  const nextStart = measureRange(nextM).start;
  setCaret?.(nextStart);
  setRange?.(nextStart, nextStart);
  clearRange?.(); // clears multi-select range if it was spanning measures
}

// ===== Duplicate Selection =====

function duplicateSelection() {
  // 1. Get current selection
  const r = (typeof getRange === 'function') ? getRange() : null;
  if (!r) {
    alert('Please select a range of notes to duplicate.');
    return;
  }

  const s = getStepCountPerMeasure();

  // 2. Calculate steps in selection
  const totalSelectedSteps = r.length;

  // 3. Calculate measures needed
  const measuresNeeded = Math.ceil(totalSelectedSteps / s);

  // 4. Append new measures
  const oldTotalSteps = (Array.isArray(innerLabels) ? innerLabels.length : 0);

  if (Array.isArray(innerLabels)) {
    // Add N empty measures
    const newStepsCount = measuresNeeded * s;
    innerLabels.push(...Array(newStepsCount).fill(''));
  }

  // 5. Copy & Paste
  // We can manually copy from [r.start ... r.end] to [oldTotalSteps ... ]

  const destStart = oldTotalSteps;

  for (let i = 0; i < totalSelectedSteps; i++) {
    const srcIdx = r.start + i;
    const destIdx = destStart + i;

    // Use snapshotBeat to get data (deep copy already fixed in notegrid.js) but we need to extract .label
    const data = snapshotBeat(srcIdx);

    // We need to act like pasteSelection -> update innerLabels directly
    // snapshotBeat returns { label: ... } structure
    // innerLabels is the raw array

    let val = data.label;

    // REDUNDANT DEEP COPY just to be safe (though snapshotBeat handles it now)
    if (Array.isArray(val)) {
      val = [...val];
    }

    innerLabels[destIdx] = val;
  }

  // 6. Render
  renderAllMeasures();

  // Optional: Move selection to the new copy?
  // For now, keep original selection or clear? Standard behavior usually keeps selection or moves it.
  // Let's move selection to the new copy so user sees it.
  if (typeof setRange === 'function') {
    setRange(destStart, destStart + totalSelectedSteps - 1);
    if (typeof setCaret === 'function') setCaret(destStart);
  }
}

// ===== Delete Multi-Measure Range =====

function deleteMeasuresRange(startM, endM) {
  const s = getStepCountPerMeasure();
  const countToDelete = (endM - startM + 1);

  if (!confirm(`Delete ${countToDelete} selected measure(s)?`)) return;

  if (Array.isArray(innerLabels)) {
    innerLabels.splice(startM * s, countToDelete * s);

    // If we deleted everything, add one empty measure back
    if (innerLabels.length === 0) {
      innerLabels.push(...Array(s).fill(''));
    }
  }

  renderAllMeasures();

  // UI Cleanup
  if (typeof clearRange === 'function') clearRange();
  const totalMeasures = getMeasureCountFromDOM();
  const nextM = Math.min(startM, totalMeasures - 1);
  const nextStart = nextM * s;
  if (typeof setCaret === 'function') setCaret(nextStart);
}

selDuplicateBtn?.addEventListener('click', duplicateSelection);

delMeasureBtn?.addEventListener('click', () => {
  const range = (typeof getRange === 'function') ? getRange() : null;
  if (range && range.length > 1) {
    const s = getStepCountPerMeasure();
    const startM = Math.floor(range.start / s);
    const endM = Math.floor(range.end / s);
    deleteMeasuresRange(startM, endM);
  } else {
    deleteMeasure(getActiveMeasureIndex());
  }
});
