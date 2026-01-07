/* ==== Layout and structure of the notes ==== */

const cells = () => document.querySelectorAll('.cell');

function setCols(n) {
  // Apply to the measures wrapper (it cascades to measure children)
  if (measuresEl) measuresEl.style.setProperty('--cols', String(n));
}

function labelForStep(i) {
  if (mode === '8') {
    const beatNumber = Math.floor(i / 2) + 1;
    return (i % 2 === 0) ? String(beatNumber) : '+';
  }
  const beatNumber = Math.floor(i / 4) + 1;
  const pos = i % 4;
  if (pos === 0) return String(beatNumber);
  if (pos === 1) return 'e';
  if (pos === 2) return '&';
  return 'a';
}

function clearGridDom() {
  if (measuresEl) measuresEl.innerHTML = '';
}

function clearSelection() {
  selectedIndex = null;
  cells().forEach(c => c.classList.remove('selected'));
}

function applySelection(i) {
  selectedIndex = i;
  cells().forEach((c, idx) => c.classList.toggle('selected', idx === i));
}

function setInnerLabel(i, value) {
  innerLabels[i] = value;
  const cell = cells()[i];
  if (!cell) return;

  const inner = cell.querySelector('.inner');
  if (inner) inner.textContent = value;

  cell.classList.remove('label-d', 'label-t', 'label-s', 'label-n', 'has-label');
  const v = String(value || '');
  
  // ghost = no label set
  cell.classList.toggle('ghost', !v);

  if (!v) return;
  cell.classList.add('has-label');

  if (v === 'D') cell.classList.add('label-d');
  else if (v === 'T') cell.classList.add('label-t');
  else if (v === 'S') cell.classList.add('label-s');
  else if (/^[0-9]$/.test(v)) cell.classList.add('label-n');

}

function renderAllMeasures() {
  if (!measuresEl) {
    // fallback: if you still render into #grid, you can adapt this
    console.warn('measuresEl not found. renderAllMeasures() skipped.');
    return;
  }

  const s = getStepCountPerMeasure();
  const totalSteps = Array.isArray(innerLabels) ? innerLabels.length : 0;
  const measureCount = Math.max(1, Math.ceil(totalSteps / s));

  measuresEl.innerHTML = '';

  for (let m = 0; m < measureCount; m++) {
    const row = document.createElement('div');
    row.className = 'measure-row';

    // Optional: measure header + ⋮ menu later
    const header = document.createElement('div');
    header.className = 'measure-header';
    header.textContent = `Measure ${m + 1}`;
    row.appendChild(header);

    const labels = document.createElement('div');
    labels.className = 'labels';
    labels.style.setProperty('--cols', String(s));

    const grid = document.createElement('div');
    grid.className = 'grid';
    grid.style.setProperty('--cols', String(s));

    // Build labels + cells
    for (let i = 0; i < s; i++) {
      
      // label
      if (m % 4 == 0) {
        const lab = document.createElement('div');
        lab.textContent = labelForStep(i); // use your existing label function (per-measure)
        labels.appendChild(lab);
      }

      // cell
      const cell = document.createElement('div');
      cell.className = 'cell';

      const inner = document.createElement('div');
      inner.className = 'inner';
      cell.appendChild(inner);

      // Ghost note dot
      const ghost = document.createElement('div');
      ghost.className = 'ghost-dot';
      cell.appendChild(ghost);

      // Global index
      const g = (m * s) + i;

      const lbl = innerLabels[g] || '';
      inner.textContent = lbl;
      // Apply label classes using your existing function
      // This will add label-d/label-t/label-s/label-n classes
      if (typeof setInnerLabel === 'function') {
        // setInnerLabel expects the cell to already exist in DOM order;
        // Here we are building. So we apply classes manually:
        cell.classList.remove('label-d', 'label-t', 'label-s', 'label-n');

        if (lbl !== '') cell.classList.add('has-label');

        if (lbl === 'D') cell.classList.add('label-d');
        else if (lbl === 'T') cell.classList.add('label-t');
        else if (lbl === 'S') cell.classList.add('label-s');
        else if (/^[0-9]$/.test(lbl)) cell.classList.add('label-n');
      }

      // Assign hand side for visuals (per your existing logic)
      // IMPORTANT: this uses your current mode mapping (8ths/16ths)
      if (mode === '8') {
        cell.classList.add((i % 2 === 0) ? 'hand-r' : 'hand-l');
        cell.classList.add((i % 2 === 0) ? 'downbeat' : 'upbeat');
      } else {
        const pos = i % 4;
        cell.classList.add((pos === 0 || pos === 2) ? 'hand-r' : 'hand-l');
        cell.classList.add((pos === 0 || pos === 2) ? 'downbeat' : 'upbeat');
      }

      // Attach your existing cell listeners:
      // - pointerdown/move for long-press selection
      // - click for caret / shift-range
      attachCellListeners(cell, g);

      grid.appendChild(cell);
    }

    row.appendChild(labels);
    row.appendChild(grid);
    measuresEl.appendChild(row);

    // Horizontal line running through each measure
    const hr = document.createElement('hr');
    measuresEl.appendChild(hr);
  }

  // After re-render, update selection visuals
  updateRangeUI?.();
  measures = measureCount;
}

// ===== SELECTION ACTIONS ===== //

function snapshotBeat(i) {
  // Adjust if your state storage differs:
  const label = Array.isArray(innerLabels) ? (innerLabels[i] || '') : '';
  return { label };
}

function applyBeat(i, beat) {
  // Adjust if your state storage differs:
  const cell = allCells()[i];

  if (typeof setInnerLabel === 'function') setInnerLabel(i, beat.label || '');
}

function setBeatToGhost(i) {
  // Your ghost behavior may be "no label + default dot".
  // We'll implement as clearing label + turning OFF accent.
  const cell = allCells()[i];
  if (typeof setInnerLabel === 'function') setInnerLabel(i, '');
}

function copySelection() {
  const r = getRange();
  if (!r) return;

  const steps = [];
  for (let i = r.start; i <= r.end; i++) steps.push(snapshotBeat(i));

  beatClipboard = { type: 'beats', steps, length: steps.length };
  if (selPasteBtn) selPasteBtn.disabled = false;
}

function pasteSelection() {
  if (!beatClipboard || beatClipboard.type !== 'beats') return;

  const startAt = (caretIndex !== null) ? caretIndex : (getRange()?.start ?? 0);
  const cells = allCells();
  const max = cells.length - 1;

  for (let k = 0; k < beatClipboard.steps.length; k++) {
    const idx = startAt + k;
    if (idx > max) break;
    applyBeat(idx, beatClipboard.steps[k]);
  }

  // Keep caret at end of paste
  setCaret(clampIndex(startAt + beatClipboard.steps.length - 1));
  setRange(startAt, clampIndex(startAt + beatClipboard.steps.length - 1));
}

function deleteSelection() {
  const r = getRange();
  if (!r) return;

  for (let i = r.start; i <= r.end; i++) setBeatToGhost(i);

  // Keep caret at start
  setCaret(r.start);
  setRange(r.start, r.start);
}

selCopyBtn?.addEventListener('click', () => copySelection());
selPasteBtn?.addEventListener('click', () => pasteSelection());
selDeleteBtn?.addEventListener('click', () => deleteSelection());
selCancelBtn?.addEventListener('click', () => {
  clearRange();
  // Also clear caret ring if you want:
  // clearSelection?.();
});

function attachCellListeners(cell, globalIndex) {
  // Pointer selection
  cell.addEventListener('click', (ev) => {
    ev.stopPropagation();

    const i = indexFromCellEl(cell);
    if (i < 0) return;

    // If we are already in selection mode (from a previous long-press), 
    // allow a simple tap to define the new end of the range
    if (selecting && anchorIndex !== null) {
      setCaret(i);
      setRange(anchorIndex, i);
      return;
    }

    // If long-press just fired, swallow the click that follows it.
    if (longPressFired) {
      longPressFired = false;
      return;
    }

    // Desktop range select (Shift+click)
    if (ev.shiftKey) {
      if (anchorIndex === null) anchorIndex = (caretIndex ?? i);
      setCaret(i);
      setRange(anchorIndex, i);
      return;
    }

    // Normal click: caret only, range collapses to single
    selecting = false;
    anchorIndex = i;
    setCaret(i);
    setRange(i, i);

    // // Click selects (Esc clears selection)
    // if (selectedIndex === globalIndex) clearSelection();
    // else applySelection(globalIndex);
  });

  cell.addEventListener('pointerdown', (ev) => {
    // Only left-click / primary touch
    if (ev.button !== undefined && ev.button !== 0) return;
  
    // Start long-press for touch devices
    startLongPress(cell);
  
    // Capture pointer so we keep getting move events
    cell.setPointerCapture?.(ev.pointerId);
  });
  
  cell.addEventListener('pointermove', (ev) => {
    // If user is dragging during selection mode, expand range
    if (selecting) {
      ev.preventDefault(); // Force the browser to ignore scrolling while selecting
      updateDragSelectionOver(cell);
    }
  });
  
  cell.addEventListener('pointerup', () => {
    cancelLongPress();
    // If long-press fired, we stay in selection mode until cancel
  });
  
  cell.addEventListener('pointercancel', () => cancelLongPress());
}
