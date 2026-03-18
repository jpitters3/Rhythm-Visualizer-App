import { activeGrid, gridA, gridB } from './grid-context.js';
import { setLongPressFired } from './state.js';
import { isReviewing } from './coaching-mode.js';
import { Bus, BUS_EVENT } from './bus.js';

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

// Local implementation to avoid circular dependency
function applySelectionLocal(i, ctx) {
  const c = ctx || activeGrid;
  c.caretIndex = i;
  const cellList = c.cells;
  let targetCell = null;
  cellList.forEach((cell, idx) => {
    const isSelected = (idx === i);
    cell.classList.toggle('selected', isSelected);
    if (isSelected) targetCell = cell;
  });
  Bus.emit(BUS_EVENT.CARET_CHANGED);
  
  if (targetCell && typeof targetCell.scrollIntoView === 'function') {
    targetCell.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

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
  const selectionTools = document.getElementById('selectionTools');
  const selBarText = document.getElementById('selBarText');

  if (selectionTools && c === activeGrid) {
    const count = r ? r.length : 0;
    const showBar = (count > 0);
    selectionTools.classList.toggle('visible', showBar);
    document.body.classList.toggle('has-selection', showBar);
    if (selBarText) selBarText.textContent = `${count} selected`;
  }
}

// ===== MOBILE LONG-PRESS RANGE SELECTION =====
let longPressTimer = null;

function indexFromCellEl(cellEl) {
  return parseInt(cellEl.dataset.index);
}

export function startLongPress(cellEl) {
  clearTimeout(longPressTimer);
  setLongPressFired(false);

  // Resolve context from DOM if possible, or use activeGrid
  let ctx = activeGrid;
  const parent = cellEl.closest('.measures') || cellEl.closest('.secondary-measures');
  if (parent && parent.id === 'measures') ctx = gridA;
  else if (parent) ctx = gridB; // Assuming secondary-measures maps to gridB if needed, or check ID

  const idx = indexFromCellEl(cellEl);
  if (isNaN(idx)) return;

  longPressTimer = setTimeout(() => {
    setLongPressFired(true);

    // If reviewing, don't trigger range selection UI/logic
    if (isReviewing && isReviewing()) {
      if ('vibrate' in navigator) navigator.vibrate(50);
      return;
    }

    ctx.selecting = true;
    if ('vibrate' in navigator) {
      navigator.vibrate(50);
    }
    ctx.anchorIndex = idx;
    setCaret(idx, ctx);
    setRange(idx, idx, ctx);
  }, 450);
}

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


