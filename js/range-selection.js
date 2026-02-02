function allCells(ctx = window.activeGrid) {
  return Array.from(ctx.cells);
}

function clampIndex(i, ctx = window.activeGrid) {
  const max = allCells(ctx).length - 1;
  return Math.max(0, Math.min(max, i));
}

function hasRange(ctx = window.activeGrid) {
  return ctx.rangeStart !== null && ctx.rangeEnd !== null;
}

function getRange(ctx = window.activeGrid) {
  if (!hasRange(ctx)) return null;
  const a = Math.min(ctx.rangeStart, ctx.rangeEnd);
  const b = Math.max(ctx.rangeStart, ctx.rangeEnd);
  return { start: a, end: b, length: (b - a + 1) };
}

function clearRange(ctx = window.activeGrid) {
  ctx.rangeStart = null;
  ctx.rangeEnd = null;
  ctx.anchorIndex = null;
  ctx.selecting = false;
  updateRangeUI(ctx);
}

function setCaret(i, ctx = window.activeGrid) {
  ctx.caretIndex = i;
  if (typeof applySelection === 'function') applySelection(i, ctx);
}

function setRange(a, b, ctx = window.activeGrid) {
  ctx.rangeStart = a;
  ctx.rangeEnd = b;
  updateRangeUI(ctx);
}

function updateRangeUI(ctx = window.activeGrid) {
  const cells = allCells(ctx);
  cells.forEach(c => c.classList.remove('range', 'range-start', 'range-end'));

  const r = getRange(ctx);
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
  const count = r ? r.length : 0;
  if (selBar && ctx === window.activeGrid) {
    const showBar = (count > 1);
    selBar.style.display = showBar ? 'flex' : 'none';
    document.body.classList.toggle('has-selection', showBar);
    if (selBarText) selBarText.textContent = `${count} selected`;
    if (selPasteBtn) selPasteBtn.disabled = !beatClipboard;
  }
}

// ===== MOBILE LONG-PRESS RANGE SELECTION =====
let longPressTimer = null;
window.longPressFired = false;

function indexFromCellEl(cellEl, ctx = window.activeGrid) {
  return parseInt(cellEl.dataset.index);
}

function startLongPress(cellEl) {
  clearTimeout(longPressTimer);
  window.longPressFired = false;

  const ctx = window.gridA.container.contains(cellEl) ? window.gridA : window.gridB;
  const idx = indexFromCellEl(cellEl, ctx);
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

function cancelLongPress() {
  clearTimeout(longPressTimer);
  longPressTimer = null;
}

function updateDragSelectionOver(cellEl, ctx = window.activeGrid) {
  if (!ctx.selecting || (ctx.anchorIndex === null)) return;
  const idx = indexFromCellEl(cellEl, ctx);
  if (isNaN(idx)) return;
  setCaret(idx, ctx);
  setRange(ctx.anchorIndex, idx, ctx);
}

// Click outside to clear range
window.addEventListener('click', (e) => {
  if (typeof hasRange === 'function' && !hasRange(window.activeGrid)) return;
  if (e.target.closest('.cell')) return;
  if (e.target.closest('.sel-bar')) return;
  if (typeof clearRange === 'function') clearRange(window.activeGrid);
});

window.setCaret = setCaret;
window.setRange = setRange;
window.clearRange = clearRange;
window.getRange = getRange;
window.hasRange = hasRange;
window.startLongPress = startLongPress;
window.cancelLongPress = cancelLongPress;
window.updateDragSelectionOver = updateDragSelectionOver;
