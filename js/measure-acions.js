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

  // Render DOM for the new measure
  // If you already have a renderMeasure() function, call it here.
  // Otherwise we’ll do a minimal DOM append by cloning your existing measure builder behavior.

  renderAllMeasures(); // We'll add this in Patch M6
}

addMeasureBtn?.addEventListener('click', () => {
  appendEmptyMeasure();
  // move caret to first beat of new measure
  const m = getMeasureCountFromDOM() - 1;
  const { start } = measureRange(m);
  setCaret?.(start);
  setRange?.(start, start);
});

// ===== Copy/Paste/Delete measure =====

function copyMeasure(mIndex) {
  const { start, end } = measureRange(mIndex);
  const steps = [];
  for (let i = start; i <= end; i++) {
    steps.push(snapshotBeat(i)); // from earlier selection patch
  }
  measureClipboard = { type: 'measure', steps, stepsCount: steps.length };
  if (pasteMeasureBtn) pasteMeasureBtn.disabled = false;
}

function pasteMeasureInto(mIndex) {
  if (!measureClipboard || measureClipboard.type !== 'measure') return;

  const { start, end } = measureRange(mIndex);
  const maxLen = Math.min(end - start + 1, measureClipboard.steps.length);

  for (let k = 0; k < maxLen; k++) {
    applyBeat(start + k, measureClipboard.steps[k]); // from earlier selection patch
  }

  // Keep caret at start of pasted measure
  setCaret?.(start);
  setRange?.(start, start);
}

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

copyMeasureBtn?.addEventListener('click', () => {
  copyMeasure(getActiveMeasureIndex());
});

pasteMeasureBtn?.addEventListener('click', () => {
  pasteMeasureInto(getActiveMeasureIndex());
});

delMeasureBtn?.addEventListener('click', () => {
  deleteMeasure(getActiveMeasureIndex());
});

