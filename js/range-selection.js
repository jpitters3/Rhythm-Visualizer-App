function allCells() {
  return Array.from(document.querySelectorAll('.cell'));
}

function clampIndex(i) {
  const max = allCells().length - 1;
  return Math.max(0, Math.min(max, i));
}

function hasRange() {
  return rangeStart !== null && rangeEnd !== null;
}

function getRange() {
  if (!hasRange()) return null;
  const a = Math.min(rangeStart, rangeEnd);
  const b = Math.max(rangeStart, rangeEnd);
  return { start: a, end: b, length: (b - a + 1) };
}

function clearRange() {
  rangeStart = null;
  rangeEnd = null;
  anchorIndex = null;
  selecting = false;
  updateRangeUI();
}

function setCaret(i) {
  caretIndex = i;
  // If you already use selectedIndex, keep them in sync:
  if (typeof selectedIndex !== 'undefined') selectedIndex = i;
  // Your existing caret ring:
  if (typeof applySelection === 'function') applySelection(i);
}

function setRange(a, b) {
  rangeStart = a;
  rangeEnd = b;
  updateRangeUI();
}

function updateRangeUI() {
  const cells = allCells();
  cells.forEach(c => c.classList.remove('range', 'range-start', 'range-end')); //

  const r = getRange();
  if (r) {
    for (let i = r.start; i <= r.end; i++) {
      const cell = cells[i];
      if (!cell) continue;
      cell.classList.add('range');
      if (i === r.start) cell.classList.add('range-start');
      if (i === r.end) cell.classList.add('range-end');
    }
  }

  // Update action bar
  const count = r ? r.length : 0;
  if (selBar) {
    selBar.style.display = (count > 1) ? 'flex' : 'none';  // show only for multi-select; change to >=1 if you prefer
  }
  if (selBarText) selBarText.textContent = `${count} selected`;
  if (selPasteBtn) selPasteBtn.disabled = !beatClipboard;
}

// ===== MOBILE LONG-PRESS RANGE SELECTION =====
let longPressTimer = null;
let longPressFired = false;

function indexFromCellEl(cellEl) {
  const cells = allCells();
  return cells.indexOf(cellEl);
}

function startLongPress(cellEl) {
  clearTimeout(longPressTimer);
  longPressFired = false;

  const idx = indexFromCellEl(cellEl);
  if (idx < 0) return;

  longPressTimer = setTimeout(() => {
    longPressFired = true;
    selecting = true;

    // Add Haptic Feedback
    // if ('vibrate' in navigator) {
    //   navigator.vibrate(50); // Short 50ms pulse
    // }

    anchorIndex = idx;
    setCaret(idx);
    setRange(idx, idx);
  }, 450);
}

function cancelLongPress() {
  clearTimeout(longPressTimer);
  longPressTimer = null;
}

function updateDragSelectionOver(cellEl) {
  if (!selecting || !anchorIndex && anchorIndex !== 0) return;
  const idx = indexFromCellEl(cellEl);
  if (idx < 0) return;
  setCaret(idx);
  setRange(anchorIndex, idx);
}
