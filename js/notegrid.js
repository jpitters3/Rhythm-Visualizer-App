const cells = (ctx = window.activeGrid) => ctx.cells;
let activeSubIndex = null; // Still global for UI selection state, or move to activeGrid? 
// Let's keep UI selection state in the context to support independent selections.

window.toggleSticking = function (index, ctx = window.activeGrid) {
  // 1. Get current effective hand (could be manual or auto)
  const currentEffective = window.getEffectiveHand(index, ctx);

  // 2. Temporarily clear manual so we see what 'Natural' is
  const savedManual = ctx.innerHands[index];
  ctx.innerHands[index] = null;
  const natural = window.getEffectiveHand(index, ctx);

  // 3. Determine the 'Alternative' (flip of current)
  const alternative = (currentEffective === 'R' ? 'L' : 'R');

  // 4. Decision: If the alternative is the natural state, we don't need a manual override
  if (alternative === natural) {
    ctx.innerHands[index] = null;
  } else {
    ctx.innerHands[index] = alternative;
  }

  renderAllMeasures(ctx);
};

window.getEffectiveHand = function (index, ctx = window.activeGrid) {
  const manual = ctx.innerHands[index];
  if (manual) return manual;

  // Default Logic
  if (ctx.mode === '8') {
    return (index % 2 === 0) ? 'R' : 'L';
  } else {
    // 16th note default (Standard Alternating: R L R L)
    const pos = index % 4;
    return (pos === 0 || pos === 2) ? 'R' : 'L';
  }
};

window.invertRange = function (start, end, ctx = window.activeGrid) {
  const gridCells = cells(ctx);
  const max = Math.min(ctx.innerHands.length, gridCells.length);
  const limit = Math.min(end + 1, max); // end is inclusive in range, loop is exclusive

  for (let i = start; i < limit; i++) {
    const current = window.getEffectiveHand(i, ctx);
    const flipped = (current === 'R' ? 'L' : 'R');
    ctx.innerHands[i] = flipped;
  }
  renderAllMeasures(ctx);
};

window.invertFollowing = function (startIndex, ctx = window.activeGrid) {
  window.invertRange(startIndex, Infinity, ctx);
};

function setCols(n, ctx = window.activeGrid) {
  // Apply to the measures wrapper (it cascades to measure children)
  const measuresEl = ctx.container;
  if (measuresEl) measuresEl.style.setProperty('--cols', String(n));
}

function labelForStep(i, ctx = window.activeGrid) {
  const ts = (typeof window.getTimeSignature === 'function') ? window.getTimeSignature() : '4/4';
  let [num, den] = ts.split('/');
  den = Number(den) || 4;

  const base = (ctx.mode === '16') ? 16 : 8;
  const stride = base / den;

  if (window.labelNotation === 'numeric') {
    return String(i + 1);
  }

  const beatNumber = Math.floor(i / stride) + 1;
  const sub = i % stride;

  if (sub === 0) return String(beatNumber);

  // Subdivision labels
  if (Math.abs(stride - 4) < 0.1) {
    if (sub === 1) return 'e';
    if (sub === 2) return '&';
    if (sub === 3) return 'a';
  } else if (Math.abs(stride - 2) < 0.1) {
    if (sub === 1) return '&';
  } else if (Math.abs(stride - 1) < 0.1) {
    // 1 step per beat
    return '';
  }

  // Fallback for odd meters
  return '';
}

function clearGridDom(ctx = window.activeGrid) {
  const measuresEl = ctx.container;
  if (measuresEl) measuresEl.innerHTML = '';
}

function clearSelection(ctx = window.activeGrid) {
  ctx.caretIndex = null;
  ctx.anchorIndex = null;
  ctx.selecting = false;
  activeSubIndex = null;
  cells(ctx).forEach(c => {
    c.classList.remove('selected');
    c.classList.remove('multi-selected');
    c.querySelectorAll('.sub-dot').forEach(s => {
      s.classList.remove('selected');
      s.classList.remove('active');
    });
  });
  window.isEditMulti = false;
}

function applySelection(i, ctx = window.activeGrid) {
  ctx.caretIndex = i;
  cells(ctx).forEach((c, idx) => c.classList.toggle('selected', idx === i));
}

function renderAllMeasures(ctx = window.activeGrid) {
  const measuresEl = ctx.container;
  if (!measuresEl) return;

  const s = getStepCountPerMeasure(ctx);
  const totalSteps = Array.isArray(ctx.innerLabels) ? ctx.innerLabels.length : 0;
  const measureCount = Math.max(1, Math.ceil(totalSteps / s));

  measuresEl.innerHTML = '';

  for (let m = 0; m < measureCount; m++) {
    const row = document.createElement('div');
    row.className = 'measure-row';

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
        lab.textContent = labelForStep(i, ctx);
        labels.appendChild(lab);
      }

      // cell
      const cell = document.createElement('div');
      cell.className = 'cell';

      const inner = document.createElement('div');
      inner.className = 'inner';
      cell.appendChild(inner);

      // quad circles
      const quad = document.createElement('div');
      quad.className = 'quad-container';

      // Left Column
      const leftCol = document.createElement('div');
      leftCol.className = 'hand-column left';
      ['lh-index', 'lh-thumb'].forEach((pos, pIdx) => {
        const dot = document.createElement('div');
        dot.className = `sub-dot ${pos}`;
        dot.dataset.idx = pIdx; // 0, 1
        leftCol.appendChild(dot);
      });

      // Right Column
      const rightCol = document.createElement('div');
      rightCol.className = 'hand-column right';
      ['rh-index', 'rh-thumb'].forEach((pos, pIdx) => {
        const dot = document.createElement('div');
        dot.className = `sub-dot ${pos}`;
        dot.dataset.idx = pIdx + 2; // 2, 3
        rightCol.appendChild(dot);
      });

      quad.appendChild(leftCol);
      quad.appendChild(rightCol);
      cell.appendChild(quad);

      // Ghost note dot
      const ghost = document.createElement('div');
      ghost.className = 'ghost-dot';
      cell.appendChild(ghost);

      // Global index
      const g = (m * s) + i;
      const lbl = ctx.innerLabels[g] || '';

      const isMultiCell = window.checkCellIsMultiMode(lbl);

      if (!isMultiCell) {
        // Set single-note cell labels
        // Resolve Display Text (Number vs Pitch)
        let displayText = lbl;
        const pref = localStorage.getItem('handpanLabelPref');
        if (pref === 'Pitches' && lbl !== '' && window.getScale) {
          const scale = window.getScale();
          if (scale && scale.map) {
            // Find pitch for this label
            let pitch = scale.map[lbl];

            // Special handling for Ding if mapped differently
            if (!pitch && (lbl === 'D' || lbl === 'Ding')) pitch = scale.ding;
            if (pitch) {
              // Format: "C#4" -> "C#" (cleaner for grid)
              displayText = pitch.replace('s', '#').replace(/[0-9]/g, '');

              // Visual Ding Logic
              const isDing = (lbl === '0' || lbl === 'D' || lbl === 'Ding');
              if (isDing) {
                cell.classList.add('visual-ding');
                displayText = ''; // Clear text so we see the egg
              }
            }
          }
        }
        inner.textContent = displayText;
      } else {
        cell.classList.add('multi-mode');
        const allSubs = cell.querySelectorAll('.sub-dot');
        for (let idx = 0; idx < allSubs.length; idx++) {
          allSubs[idx].textContent = lbl[idx];
        };
      }

      cell.dataset.index = g;
      if (lbl !== '') cell.classList.add('has-label');
      if (lbl === 'D') cell.classList.add('label-d');
      else if (lbl === 'T') cell.classList.add('label-t');
      else if (lbl === 'S') cell.classList.add('label-s');
      else if (lbl === '?') cell.classList.add('label-q');
      else if (lbl !== '') cell.classList.add('label-n');

      if (ctx.id === 'A' && g === ctx.caretIndex) cell.classList.add('selected');

      // Hand sticking
      const hand = window.getEffectiveHand(g, ctx);
      const isManual = !!ctx.innerHands[g];
      if (isManual) {
        cell.classList.add(hand === 'R' ? 'force-hand-r' : 'force-hand-l');
        cell.classList.add('manual-hand');
      } else {
        cell.classList.add(hand === 'R' ? 'downbeat' : 'upbeat');
      }

      attachCellListeners(cell, ctx);
      grid.appendChild(cell);
    }
    row.appendChild(labels);
    row.appendChild(grid);
    measuresEl.appendChild(row);

    // Horizontal line
    const hr = document.createElement('hr');
    measuresEl.appendChild(hr);
  }

  // After re-render, update selection visuals
  if (typeof updateRangeUI === 'function') updateRangeUI(ctx);
  if (ctx.id === 'A') window.measures = measureCount;
}

// ===== SELECTION ACTIONS ===== //

function snapshotBeat(i, ctx = window.activeGrid) {
  // Adjust if your state storage differs:
  let label = Array.isArray(ctx.innerLabels) ? (ctx.innerLabels[i] || '') : '';
  // Deep copy if it is a multi-cell array, so we don't store a reference
  if (window.checkCellIsMultiMode(label)) {
    label = [...label];
  }
  return { label };
}

function applyBeat(i, beat, ctx = window.activeGrid) {
  // Adjust if your state storage differs:
  let val = beat.label || '';
  // Deep copy on paste/apply so multiple pastes don't share references
  if (window.checkCellIsMultiMode(val)) {
    val = [...val];
  }

  if (typeof setInnerLabel === 'function') setInnerLabel(i, val, ctx);
}

function setBeatToGhost(i, ctx = window.activeGrid) {
  // Your ghost behavior may be "no label + default dot".
  // We'll implement as clearing label + turning OFF accent.
  if (typeof setInnerLabel === 'function') setInnerLabel(i, '', ctx);
}

function copySelection(ctx = window.activeGrid) {
  const r = (typeof getRange === 'function') ? getRange(ctx) : null;
  if (!r) return;

  const steps = [];
  for (let i = r.start; i <= r.end; i++) {
    steps.push(snapshotBeat(i, ctx));
  }

  beatClipboard = { type: 'beats', steps: steps };
  if (selPasteBtn) selPasteBtn.disabled = false;
}

function pasteSelection(ctx = window.activeGrid) {
  if (!beatClipboard || beatClipboard.type !== 'beats') return;
  if (window.HistoryManager) window.HistoryManager.pushState();

  const startAt = (ctx.caretIndex !== null) ? ctx.caretIndex : ((typeof getRange === 'function') ? getRange(ctx)?.start ?? 0 : 0);
  const gridCells = cells(ctx);
  const max = gridCells.length - 1;

  for (let k = 0; k < beatClipboard.steps.length; k++) {
    const idx = startAt + k;
    if (idx > max) break;

    // Direct Model Update (like assignChordToSelectedCell)
    // beatClipboard.steps[k] is { label: ... } from snapshotBeat
    let val = beatClipboard.steps[k].label;

    // DEEP COPY to prevent shared references
    if (window.checkCellIsMultiMode(val)) {
      val = [...val];
    }

    ctx.innerLabels[idx] = val;
  }

  // Full Render to apply classes (multi-mode vs single)
  renderAllMeasures(ctx);

  // Keep caret at end of paste
  const endIdx = Math.min(max, startAt + beatClipboard.steps.length - 1);
  if (typeof setCaret === 'function') setCaret(endIdx, ctx);
  if (typeof setRange === 'function') setRange(startAt, endIdx, ctx);
}

function deleteSelection(ctx = window.activeGrid) {
  const r = (typeof getRange === 'function') ? getRange(ctx) : null;
  if (!r) return;
  if (window.HistoryManager) window.HistoryManager.pushState();

  // Update model directly
  for (let i = r.start; i <= r.end; i++) {
    ctx.innerLabels[i] = '';
  }

  // Full render to restore 'ghost' state with correct hand/beat classes
  renderAllMeasures(ctx);
}

// EVENT LISTENERS //

selCopyBtn?.addEventListener('click', () => copySelection());
selPasteBtn?.addEventListener('click', () => pasteSelection());
selDeleteBtn?.addEventListener('click', () => deleteSelection());
selCancelBtn?.addEventListener('click', () => {
  clearRange();
  // Also clear caret ring if you want:
  // clearSelection?.();
});

function setInnerLabel(i, value, ctx = window.activeGrid) {
  const cell = cells(ctx)[i];
  if (!cell) return;

  if (activeSubIndex == null) {
    // Set single note
    ctx.innerLabels[i] = value;
    const inner = cell.querySelector('.inner');
    if (inner) inner.textContent = value;

    cell.classList.remove('label-d', 'label-t', 'label-s', 'label-n', 'label-q', 'has-label');
    const v = String(value || '');

    // ghost = no label set
    cell.classList.toggle('ghost', !v);

    if (!v) return;
    cell.classList.add('has-label');

    if (v === 'D') cell.classList.add('label-d');
    else if (v === 'T') cell.classList.add('label-t');
    else if (v === 'S') cell.classList.add('label-s');
    else if (v === '?') cell.classList.add('label-q');
    else cell.classList.add('label-n'); // Default to number style

    cell.classList.remove('multi-mode');

  } else {
    // Set sub notes
    if (!window.checkCellIsMultiMode(ctx.innerLabels[i])) {
      ctx.innerLabels[i] = [ctx.innerLabels[i] || '', '', '', ''];
    }

    if (activeSubIndex !== null) {
      ctx.innerLabels[i][activeSubIndex] = value;
    }

    const labels = ctx.innerLabels[i].filter(l => l !== '');
    cell.classList.toggle('has-label', labels.length > 0);

    const subs = Array.from(cell.querySelectorAll('.sub-dot'));
    ctx.innerLabels[i].forEach((label, idx) => {
      subs[idx].textContent = label;
      subs[idx].classList.toggle('active', !!label);
    });
  }
}

function attachCellListeners(cell, ctx = window.activeGrid) {
  // Pointer selection
  cell.addEventListener('click', (ev) => {
    ev.stopPropagation();

    // Set activeGrid on click
    window.activeGrid = ctx;

    const x = ev.clientX;
    const y = ev.clientY;
    const actualTarget = document.elementFromPoint(x, y);
    const subDot = actualTarget?.closest('.sub-dot');

    const i = parseInt(cell.dataset.index);
    if (isNaN(i)) return;

    // CHECK EDIT HANDS MODE
    if (window.editHandsMode) {
      if (window.HistoryManager) window.HistoryManager.pushState();
      window.toggleSticking(i, ctx);
      setCaret(i, ctx);
      return;
    }

    if (subDot && isEditMulti) {
      cell.classList.add('multi-mode');
      const allSubs = Array.from(cell.querySelectorAll('.sub-dot'));
      activeSubIndex = allSubs.indexOf(subDot);

      // Clear other selections in THIS grid
      cells(ctx).forEach(c => {
        c.querySelectorAll('.sub-dot').forEach(s => s.classList.remove('selected'));
      });
      subDot.classList.add('selected');

      setCaret(i, ctx);
      return;
    }

    // 3. STANDARD CELL CLICK (RESET QUADRANTS)
    activeSubIndex = null;
    cells(ctx).forEach(c => {
      c.querySelectorAll('.sub-dot').forEach(s => s.classList.remove('selected'));
    });

    const lbl = ctx.innerLabels[i] || [];
    if (!window.checkCellIsMultiMode(lbl) || lbl.filter(l => l !== '').length <= 1) {
      cell.classList.remove('multi-mode');
    }

    if (window.longPressFired) {
      window.longPressFired = false;
      return;
    }

    const gridCcaretIndex = ctx.caretIndex;
    const gridAnchorIndex = ctx.anchorIndex;

    if (ctx.selecting && gridAnchorIndex !== null) {
      setCaret(i, ctx);
      setRange(gridAnchorIndex, i, ctx);
      ctx.selecting = false;
      return;
    }

    if (ev.shiftKey) {
      const anchor = gridAnchorIndex !== null ? gridAnchorIndex : (gridCcaretIndex ?? i);
      ctx.anchorIndex = anchor;
      setCaret(i, ctx);
      setRange(anchor, i, ctx);
      return;
    }

    ctx.selecting = false;
    ctx.anchorIndex = i;
    setCaret(i, ctx);

    if (typeof setRange === 'function') setRange(i, i, ctx);
  });

  cell.addEventListener('dblclick', (ev) => {
    ev.stopPropagation();
    window.isEditMulti = true;
    cell.classList.add('multi-selected');
    const allSubs = Array.from(cell.querySelectorAll('.sub-dot'));
    allSubs.forEach(s => s.classList.add('active'));
  });

  cell.addEventListener('pointerdown', (ev) => {
    if (ev.button !== undefined && ev.button !== 0) return;
    if (typeof startLongPress === 'function') startLongPress(cell);
    cell.setPointerCapture?.(ev.pointerId);
  });

  cell.addEventListener('pointermove', (ev) => {
    if (ctx.selecting) {
      ev.preventDefault();
      if (typeof updateDragSelectionOver === 'function') updateDragSelectionOver(cell, ctx);
    }
  });

  cell.addEventListener('pointerup', () => {
    if (typeof cancelLongPress === 'function') cancelLongPress();
  });

  cell.addEventListener('pointercancel', () => {
    if (typeof cancelLongPress === 'function') cancelLongPress();
  });

  // Right-click hand sticking
  cell.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();

    const i = parseInt(cell.dataset.index);
    if (isNaN(i)) return;

    if (window.HistoryManager) window.HistoryManager.pushState();
    window.toggleSticking(i, ctx);

    // Only move caret/selection if NOT a multi-note cell
    // (Prevents visual clutter/accidental overwrite on chords)
    const lbl = ctx.innerLabels[i];
    const isMulti = window.checkCellIsMultiMode(lbl);
    if (!isMulti) setCaret(i, ctx);
  });
}

window.checkCellIsMultiMode = function (label) {
  return Array.isArray(label);
}

// ==== CHORD INJECTION LOGIC ====

window.assignChordToSelectedCell = function (labels, ctx = window.activeGrid) {
  // Find selected cell
  const gridCells = cells(ctx);
  let selIdx = ctx.caretIndex ?? -1;

  if (selIdx === -1) return false;

  if (window.HistoryManager) window.HistoryManager.pushState();

  // Slots: 0=LI, 1=LT, 2=RI, 3=RT
  const slots = ['', '', '', ''];

  // Filter for Numbers (1-9) vs Others
  const numericLabels = [];
  const otherLabels = [];

  labels.forEach(l => {
    const n = parseInt(l);
    if (!isNaN(n)) numericLabels.push(n);
    else otherLabels.push(l);
  });

  numericLabels.sort((a, b) => a - b);

  let rightNotes = numericLabels.filter(n => n % 2 !== 0);
  let leftNotes = numericLabels.filter(n => n % 2 === 0);

  const usedNotes = new Set();
  let rightPairFound = false;
  let leftPairFound = false;

  if (rightNotes.length >= 2) {
    for (let i = 0; i < rightNotes.length - 1; i++) {
      const n1 = rightNotes[i];
      const n2 = rightNotes[i + 1];
      slots[3] = String(n1);
      slots[2] = String(n2);
      usedNotes.add(n1);
      usedNotes.add(n2);
      rightPairFound = true;
      break;
    }
  }

  if (leftNotes.length >= 2) {
    for (let i = 0; i < leftNotes.length - 1; i++) {
      const n1 = leftNotes[i];
      const n2 = leftNotes[i + 1];
      if (!slots[0] && !slots[1]) {
        slots[0] = String(n2);
        slots[1] = String(n1);
        usedNotes.add(n1);
        usedNotes.add(n2);
        leftPairFound = true;
        break;
      }
    }
  }

  const remainder = numericLabels.filter(n => !usedNotes.has(n));
  otherLabels.forEach(l => remainder.push(l));

  remainder.forEach(note => {
    note = String(note);
    if (rightPairFound && !leftPairFound) {
      if (!slots[0]) slots[0] = note;
      else if (!slots[1]) slots[1] = note;
      else if (!slots[2]) slots[2] = note;
      else if (!slots[3]) slots[3] = note;
    }
    else if (leftPairFound && !rightPairFound) {
      if (!slots[2]) slots[2] = note;
      else if (!slots[3]) slots[3] = note;
      else if (!slots[0]) slots[0] = note;
      else if (!slots[1]) slots[1] = note;
    }
    else {
      if (!slots[0]) slots[0] = note;
      else if (!slots[2]) slots[2] = note;
      else if (!slots[1]) slots[1] = note;
      else if (!slots[3]) slots[3] = note;
    }
  });

  // Apply to Grid
  // This enters "Multi-Mode" for the cell
  ctx.innerLabels[selIdx] = slots;

  // Trigger DOM Update
  renderAllMeasures(ctx);

  return true;
};


