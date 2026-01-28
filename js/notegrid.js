

const cells = () => document.querySelectorAll('.cell');
let activeSubIndex = null; // Tracks which of the 4 circles is selected (0-3)
let isEditMulti = false;

let fingerMap = new Map();
fingerMap.set("lh-index", 0);
fingerMap.set("lh-thumb", 1);
fingerMap.set("rh-index", 2);
fingerMap.set("rh-thumb", 3);

// Hand Sticking State (Parallel to innerLabels)
// 'R' = Right, 'L' = Left, null/'' = Default/Auto
window.innerHands = [];

window.labelNotation = localStorage.getItem('labelNotation') || 'musical';

window.toggleSticking = function (index) {
  const current = window.innerHands[index];
  let next = null;
  if (!current) next = 'R';
  else if (current === 'R') next = 'L';
  else next = null; // Back to auto

  window.innerHands[index] = next;
  renderAllMeasures();
};

window.getEffectiveHand = function (index) {
  const manual = window.innerHands[index];
  if (manual) return manual;

  // Default Logic
  if (mode === '8') {
    return (index % 2 === 0) ? 'R' : 'L';
  } else {
    // 16th note default (Standard Alternating: R L R L)
    const pos = index % 4;
    return (pos === 0 || pos === 2) ? 'R' : 'L';
  }
};

window.invertRange = function (start, end) {
  const cells = document.querySelectorAll('.cell');
  const max = Math.min(window.innerHands.length, cells.length);
  const limit = Math.min(end + 1, max); // end is inclusive in range, loop is exclusive

  for (let i = start; i < limit; i++) {
    const current = window.getEffectiveHand(i);
    const flipped = (current === 'R' ? 'L' : 'R');
    window.innerHands[i] = flipped;
  }
  renderAllMeasures();
};

window.invertFollowing = function (startIndex) {
  window.invertRange(startIndex, Infinity);
};

function setCols(n) {
  // Apply to the measures wrapper (it cascades to measure children)
  if (measuresEl) measuresEl.style.setProperty('--cols', String(n));
}

function labelForStep(i) {
  const ts = (typeof window.getTimeSignature === 'function') ? window.getTimeSignature() : '4/4';
  let [num, den] = ts.split('/');
  den = Number(den) || 4;

  const base = (mode === '16') ? 16 : 8;
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

function clearGridDom() {
  if (measuresEl) measuresEl.innerHTML = '';
}

function clearSelection() {
  selectedIndex = null;
  caretIndex = null; // Reset caret so play starts from 0
  anchorIndex = null; // Reset anchor
  activeSubIndex = null;
  cells().forEach(c => {
    c.classList.remove('selected');
    c.classList.remove('multi-selected');
    c.querySelectorAll('.sub-dot').forEach(s => {
      s.classList.remove('selected');
      s.classList.remove('active');
    });
  });
  isEditMulti = false;
}

function applySelection(i) {
  selectedIndex = i;
  cells().forEach((c, idx) => c.classList.toggle('selected', idx === i));
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

      // quad circles
      const quad = document.createElement('div');
      quad.className = 'quad-container';

      // Left Hand Column (Bottom: Thumb, Top: Index)
      const leftCol = document.createElement('div');
      leftCol.className = 'hand-column left';
      ['lh-index', 'lh-thumb'].forEach(pos => {
        const dot = document.createElement('div');
        dot.className = `sub-dot ${pos}`;
        dot.dataset = `${fingerMap.get(pos)}`;
        leftCol.appendChild(dot);
      });

      // Right Hand Column (Bottom: Thumb, Top: Index)
      const rightCol = document.createElement('div');
      rightCol.className = 'hand-column right';
      ['rh-index', 'rh-thumb'].forEach(pos => {
        const dot = document.createElement('div');
        dot.className = `sub-dot ${pos}`;
        dot.dataset = `${fingerMap.get(pos)}`;
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
      const lbl = innerLabels[g] || '';

      // Set inner label of multi-mode cells OR single-note cells
      const isMultiCell = Array.isArray(lbl);
      // inner.textContent = lbl;

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
      }
      else {
        // Set multi-note cell labels
        cell.classList.add('multi-mode');
        const allSubs = cell.querySelectorAll('.sub-dot');
        for (let idx = 0; idx < allSubs.length; idx++) {
          allSubs[idx].textContent = lbl[idx];
        };
      }

      // Apply label classes 
      if (typeof setInnerLabel === 'function') {
        // setInnerLabel expects the cell to already exist in DOM order;
        // Here we are building. So we apply classes manually:
        cell.classList.remove('label-d', 'label-t', 'label-s', 'label-n');

        if (lbl !== '') cell.classList.add('has-label');

        if (!isMultiCell) {
          // Set single-note cell classes
          if (lbl === 'D') cell.classList.add('label-d');
          else if (lbl === 'T') cell.classList.add('label-t');
          else if (lbl === 'S') cell.classList.add('label-s');
          else if (lbl === 'S') cell.classList.add('label-s');
          else cell.classList.add('label-n'); // Default to number style for all other inputs (custom pitches etc)

          // Assign hand side (Auto or Manual)
          const sticking = window.innerHands[g];

          if (sticking === 'R') {
            cell.classList.add('hand-r', 'force-hand-r');
            cell.dataset.sticking = 'R';
          } else if (sticking === 'L') {
            cell.classList.add('hand-l', 'force-hand-l');
            cell.dataset.sticking = 'L';
          } else {
            // Default Logic
            if (mode === '8') {
              cell.classList.add((i % 2 === 0) ? 'hand-r' : 'hand-l');
            } else {
              const pos = i % 4;
              cell.classList.add((pos === 0 || pos === 2) ? 'hand-r' : 'hand-l');
            }
          }

          // Downbeat/Upbeat logic (Independent of hand)
          if (mode === '8') {
            cell.classList.add((i % 2 === 0) ? 'downbeat' : 'upbeat');
          } else {
            const pos = i % 4;
            cell.classList.add((pos === 0 || pos === 2) ? 'downbeat' : 'upbeat');
          }

          // Right-click to toggle Sticking (Shift = Invert Following)
          cell.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (window.HistoryManager) window.HistoryManager.pushState(); // SAVE STATE
            if (e.shiftKey) {
              window.invertFollowing(g);
            } else {
              window.toggleSticking(g);
            }
          });
        }
      }

      // Attach your existing cell listeners:
      // - pointerdown/move for long-press selection
      // - click for caret / shift-range
      attachCellListeners(cell);

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
  let label = Array.isArray(innerLabels) ? (innerLabels[i] || '') : '';
  // Deep copy if it is a multi-cell array, so we don't store a reference
  if (Array.isArray(label)) {
    label = [...label];
  }
  return { label };
}

function applyBeat(i, beat) {
  // Adjust if your state storage differs:
  const cell = allCells()[i];

  let val = beat.label || '';
  // Deep copy on paste/apply so multiple pastes don't share references
  if (Array.isArray(val)) {
    val = [...val];
  }

  if (typeof setInnerLabel === 'function') setInnerLabel(i, val);
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
  if (window.HistoryManager) window.HistoryManager.pushState();

  const startAt = (caretIndex !== null) ? caretIndex : (getRange()?.start ?? 0);
  const cells = allCells();
  const max = cells.length - 1;

  for (let k = 0; k < beatClipboard.steps.length; k++) {
    const idx = startAt + k;
    if (idx > max) break;

    // Direct Model Update (like assignChordToSelectedCell)
    // beatClipboard.steps[k] is { label: ... } from snapshotBeat
    let val = beatClipboard.steps[k].label;

    // DEEP COPY to prevent shared references
    if (Array.isArray(val)) {
      val = [...val];
    }

    innerLabels[idx] = val;
  }

  // Full Render to apply classes (multi-mode vs single)
  renderAllMeasures();

  // Keep caret at end of paste
  const endIdx = clampIndex(startAt + beatClipboard.steps.length - 1);
  setCaret(endIdx);
  setRange(startAt, endIdx);
}

function deleteSelection() {
  const r = getRange();
  if (!r) return;
  if (window.HistoryManager) window.HistoryManager.pushState();

  // Update model directly
  for (let i = r.start; i <= r.end; i++) {
    innerLabels[i] = '';
  }

  // Full render to restore 'ghost' state with correct hand/beat classes
  renderAllMeasures();
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

function setInnerLabel(i, value) {
  const cell = cells()[i];
  if (!cell) return;

  // if (!Array.isArray(innerLabels[i]) && activeSubIndex == null) {
  if (activeSubIndex == null) {

    // Set single note

    innerLabels[i] = value;
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
    else cell.classList.add('label-n'); // Default to number style

    cell.classList.remove('multi-mode');

  } else {

    // Set sub notes

    // If we haven't initialized an array for this index, do it now
    if (!Array.isArray(innerLabels[i])) {
      innerLabels[i] = [innerLabels[i] || '', '', '', ''];
    }

    // If a specific quadrant is selected, update only that one
    if (activeSubIndex !== null) {
      innerLabels[i][activeSubIndex] = value;
    }

    // else ?

    const labels = innerLabels[i].filter(l => l !== '');
    const isMulti = cell.classList.contains('multi-mode');

    cell.classList.toggle('multi-mode', isMulti);
    cell.classList.toggle('has-label', labels.length > 0);

    const subs = Array.from(cell.querySelectorAll('.sub-dot'));

    innerLabels[i].forEach((label, idx) => {
      subs[idx].textContent = label;
      subs[idx
      ].classList.toggle('active', !!label);
    });
  }
}

function attachCellListeners(cell) {
  // Pointer selection
  cell.addEventListener('click', (ev) => {
    ev.stopPropagation();

    // If we double-clicked, then [isEditMulti] is true
    // if (isEditMulti) {

    // }

    // 1. Get the physical coordinates of the click
    const x = ev.clientX;
    const y = ev.clientY;

    // 2. Use elementFromPoint to find what was ACTUALLY touched
    // This ignores the Pointer Capture redirection.
    const actualTarget = document.elementFromPoint(x, y);
    const subDot = actualTarget?.closest('.sub-dot');

    // 1. Calculate the index immediately so it is available for all logic
    const i = indexFromCellEl(cell);
    if (i < 0) return;

    // CHECK EDIT HANDS MODE
    if (window.editHandsMode) {
      if (window.HistoryManager) window.HistoryManager.pushState();
      window.toggleSticking(i);
      setCaret(i); // Update selection so "Flip Rest" knows where to start
      return;
    }

    if (subDot && isEditMulti) {
      // Transition to multi-mode visually
      cell.classList.add('multi-mode');

      const allSubs = Array.from(cell.querySelectorAll('.sub-dot'));
      activeSubIndex = allSubs.indexOf(subDot);

      // Clear other selections and highlight this specific finger-dot
      cells().forEach(c => {
        c.querySelectorAll('.sub-dot').forEach(s => s.classList.remove('selected'));
      });
      subDot.classList.add('selected');

      // Use the 'i' we calculated at the top
      setCaret(i);
      return;
    }

    // 3. STANDARD CELL CLICK (RESET QUADRANTS)
    activeSubIndex = null;
    cells().forEach(c => {
      c.querySelectorAll('.sub-dot').forEach(s => s.classList.remove('selected'));
    });

    // Optional: Only remove multi-mode if the cell is empty
    const labels = innerLabels[i] || [];
    if (Array.isArray(labels)) {
      if (labels.filter(l => l !== '').length <= 1) {
        cell.classList.remove('multi-mode');
      }
    } else {
      cell.classList.remove('multi-mode');
    }

    if (longPressFired) {
      longPressFired = false;
      return;
    }

    if (selecting && anchorIndex !== null) {
      setCaret(i);
      setRange(anchorIndex, i);
      selecting = false;
      return;
    }

    if (ev.shiftKey) {
      if (anchorIndex === null) anchorIndex = (caretIndex ?? i);
      setCaret(i);
      setRange(anchorIndex, i);
      return;
    }

    selecting = false;
    anchorIndex = i;
    setCaret(i);

    // Ensure single click sets a range of 1 so Copy works
    if (typeof setRange === 'function') setRange(i, i);
  });

  cell.addEventListener('dblclick', (ev) => {
    ev.stopPropagation();

    isEditMulti = true;

    // Set .cell.multi-selected .hand-column.left .sub-dot
    cell.classList.add('multi-selected');
    const allSubs = Array.from(cell.querySelectorAll('.sub-dot'));
    allSubs.forEach(s => s.classList.add('active'));
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
  });

  cell.addEventListener('pointercancel', () => cancelLongPress());
}

// ==== CHORD INJECTION LOGIC ====

window.assignChordToSelectedCell = function (labels) {
  // Find selected cell
  const cells = document.querySelectorAll('.cell');
  let selectedIndex = -1;
  for (let i = 0; i < cells.length; i++) {
    if (cells[i].classList.contains('selected')) {
      selectedIndex = i;
      break;
    }
  }

  if (selectedIndex === -1) return false;

  if (window.HistoryManager) window.HistoryManager.pushState();

  // Slots: 0=LI, 1=LT, 2=RI, 3=RT
  const slots = ['', '', '', ''];

  // Filter for Numbers (1-9) vs Others
  // We assume user rules apply to numbered notes
  const numericLabels = [];
  const otherLabels = [];

  labels.forEach(l => {
    const n = parseInt(l);
    if (!isNaN(n)) numericLabels.push(n);
    else otherLabels.push(l);
  });

  numericLabels.sort((a, b) => a - b);

  // Split into Left (Evens) and Right (Odds)
  // Assumption: 1,3,5,7... are Right. 2,4,6,8... are Left.
  let rightNotes = numericLabels.filter(n => n % 2 !== 0);
  let leftNotes = numericLabels.filter(n => n % 2 === 0);

  const usedNotes = new Set();
  let rightPairFound = false;
  let leftPairFound = false;

  // RULE 1: Right Side Pair (Odds)
  // "If a chord contains 2 notes that are next to each other on the right side"
  if (rightNotes.length >= 2) {
    for (let i = 0; i < rightNotes.length - 1; i++) {
      const n1 = rightNotes[i];     // Lower
      const n2 = rightNotes[i + 1];   // Higher

      // Assign: Lower -> RT (3), Higher -> RI (2)
      slots[3] = String(n1);
      slots[2] = String(n2);

      usedNotes.add(n1);
      usedNotes.add(n2);
      rightPairFound = true;
      break;
    }
  }

  // RULE 2: Left Side Pair (Evens)
  // "Same rules apply for the left side... higher -> LI, lower -> LT"
  if (leftNotes.length >= 2) {
    for (let i = 0; i < leftNotes.length - 1; i++) {
      const n1 = leftNotes[i];     // Lower
      const n2 = leftNotes[i + 1];   // Higher

      if (!slots[0] && !slots[1]) { // If free
        slots[0] = String(n2); // Higher -> LI
        slots[1] = String(n1); // Lower -> LT

        usedNotes.add(n1);
        usedNotes.add(n2);
        leftPairFound = true;
        break;
      }
    }
  }

  // Handle Third Note / Remainder
  const remainder = numericLabels.filter(n => !usedNotes.has(n));
  otherLabels.forEach(l => remainder.push(l));

  remainder.forEach(note => {
    note = String(note);
    // If Right Pair triggered (Rule 1): Third note -> Left Index (0)
    if (rightPairFound && !leftPairFound) {
      if (!slots[0]) slots[0] = note;
      else if (!slots[1]) slots[1] = note; // Fallback
      else if (!slots[2]) slots[2] = note;
      else if (!slots[3]) slots[3] = note;
    }
    // If Left Pair triggered (Rule 2): Third note -> Right Index (2)
    else if (leftPairFound && !rightPairFound) {
      if (!slots[2]) slots[2] = note;
      else if (!slots[3]) slots[3] = note; // Fallback
      else if (!slots[0]) slots[0] = note;
      else if (!slots[1]) slots[1] = note;
    }
    else {
      // No pairs, or pairs on both sides (full).
      // Fill empty slots
      if (!slots[0]) slots[0] = note;
      else if (!slots[2]) slots[2] = note;
      else if (!slots[1]) slots[1] = note;
      else if (!slots[3]) slots[3] = note;
    }
  });

  // Apply to Grid
  // This enters "Multi-Mode" for the cell
  innerLabels[selectedIndex] = slots; // Array of 4

  // Trigger DOM Update
  renderAllMeasures();

  return true;
};


