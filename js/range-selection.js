import { activeGrid, gridA, gridB } from './grid-context.js';

function allCells(ctx) {
  return Array.from((ctx || activeGrid).cells);
}

function clampIndex(i, ctx) {
  const cells = allCells(ctx || activeGrid);
  const max = cells.length - 1;
  return Math.max(0, Math.min(max, i));
}

export function hasRange(ctx) {
  const c = ctx || activeGrid;
  return c.rangeStart !== null && c.rangeEnd !== null;
}

export function getRange(ctx) {
  const c = ctx || activeGrid;
  if (!hasRange(c)) return null;
  const a = Math.min(c.rangeStart, c.rangeEnd);
  const b = Math.max(c.rangeStart, c.rangeEnd);
  return { start: a, end: b, length: (b - a + 1) };
}

export function clearRange(ctx) {
  const c = ctx || activeGrid;
  c.rangeStart = null;
  c.rangeEnd = null;
  c.anchorIndex = null;
  c.selecting = false;
  updateRangeUI(c);
}

// Local implementation to avoid circular dependency (notegrid.js uses setCaret which uses applySelection (from notegrid.js))
function applySelectionLocal(i, ctx) {
  const c = ctx || activeGrid;
  c.caretIndex = i;
  const cellList = c.cells;
  cellList.forEach((cell, idx) => cell.classList.toggle('selected', idx === i));
}

// Export as applySelection for consumers (like compose-mode.js)
export function applySelection(i, ctx) {
  applySelectionLocal(i, ctx);
}

export function setCaret(i, ctx) {
  applySelectionLocal(i, ctx);
}

export function setRange(a, b, ctx) {
  const c = ctx || activeGrid;
  c.rangeStart = a;
  c.rangeEnd = b;
  updateRangeUI(c);
}

export function updateRangeUI(ctx) {
  const c = ctx || activeGrid;
  const cells = allCells(c);
  cells.forEach(cell => cell.classList.remove('range', 'range-start', 'range-end'));

  const r = getRange(c);
  if (r) {
    for (let i = r.start; i <= r.end; i++) {
      const cell = cells[i];
      if (!cell) continue;
      cell.classList.add('range');
      if (i === r.start) cell.classList.add('range-start');
      if (i === r.end) cell.classList.add('range-end');
    }
  }

  // Update action bar (global for now, but linked to activeGrid)
  const selBar = document.getElementById('selBar');
  const selBarText = document.getElementById('selBarText');
  const selPasteBtn = document.getElementById('selPasteBtn');
  const beatClipboard = window.beatClipboard; // Still global in notegrid? NO, exported.
  // We need to check if clipboard has stuff.
  // Actually, notegrid.js exports beatClipboard. But importing it creates cycle.
  // I will check `window.beatClipboard` as a fallback or assume clipboard state is managed elsewhere.
  // Or I can skip the button disable logic here and let notegrid handle it?

  if (selBar && c === activeGrid) {
    const count = r ? r.length : 0;
    const showBar = (count > 1);
    selBar.style.display = showBar ? 'flex' : 'none';
    document.body.classList.toggle('has-selection', showBar);
    if (selBarText) selBarText.textContent = `${count} selected`;
    // if (selPasteBtn) selPasteBtn.disabled = !beatClipboard; // Commented out to avoid dependency for now
  }
}

// ===== MOBILE LONG-PRESS RANGE SELECTION =====
let longPressTimer = null;
window.longPressFired = false;

function indexFromCellEl(cellEl) {
  return parseInt(cellEl.dataset.index);
}

export function startLongPress(cellEl) {
  clearTimeout(longPressTimer);
  window.longPressFired = false;

  // Resolve context from DOM if possible, or use activeGrid
  // This logic was: const ctx = window.gridA.container.contains(cellEl) ? window.gridA : window.gridB;
  // We need gridA/gridB.
  // Import them?
  // import { gridA, gridB } from './grid-context.js'; (Deferred)
  // I'll assume activeGrid for simplicity or standard resolution:
  // We can traverse up to find container ID?
  let ctx = activeGrid;
  // Better resolution:
  const parent = cellEl.closest('.measures') || cellEl.closest('.secondary-measures');
  if (parent && parent.id === 'measures') ctx = gridA;
  else if (parent) ctx = gridB;

  const idx = indexFromCellEl(cellEl);
  if (isNaN(idx)) return;

  longPressTimer = setTimeout(() => {
    window.longPressFired = true;
    ctx.selecting = true;

    if ('vibrate' in navigator) {
      navigator.vibrate(50);
    }

    ctx.anchorIndex = idx;
    setCaret(idx, ctx);
    setRange(idx, idx, ctx);
  }, 450);
}

// Helpers resolved via top-level imports

export function cancelLongPress() {
  clearTimeout(longPressTimer);
  longPressTimer = null;
}

export function updateDragSelectionOver(cellEl, ctx) {
  const c = ctx || activeGrid;
  if (!c.selecting || (c.anchorIndex === null)) return;
  const idx = indexFromCellEl(cellEl);
  if (isNaN(idx)) return;
  setCaret(idx, c);
  setRange(c.anchorIndex, idx, c);
}

// Click outside to clear range
window.addEventListener('click', (e) => {
  if (hasRange(activeGrid) && !e.target.closest('.cell') && !e.target.closest('.sel-bar')) {
    clearRange(activeGrid);
  }
});


// Expose legacy for now if needed, or rely on imports
// window.setCaret = setCaret; // Removed
window.setCaret = setCaret;
window.setRange = setRange;
window.clearRange = clearRange;
window.getRange = getRange;
window.hasRange = hasRange;
window.startLongPress = startLongPress;
window.cancelLongPress = cancelLongPress;
window.updateDragSelectionOver = updateDragSelectionOver;
