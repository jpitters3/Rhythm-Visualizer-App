import { gridA, gridB } from './grid-context.js';
import { activeGrid, setActiveGrid } from './state.js';
import { getTimeSignature, calculateSteps } from './rhythm-core.js';
import { stop } from './noteplayer.js';
import { getScale } from './state.js';
import { setCaret, setRange, clearRange, getRange, updateDragSelectionOver, startLongPress, cancelLongPress } from './range-selection.js';
import { HistoryManager } from './history.js';
import { editHandsMode, isEditMulti, longPressFired, setLongPressFired, setIsEditMulti, labelNotation } from './state.js';
import { TransportRegistry } from './transport-ui.js';
import { isReviewing, getFeedbackForStep, showFeedbackTooltip, copyLogsForStep, getExpectedNoteForStep } from './coaching-mode.js';
import { Bus, BUS_EVENT } from './bus.js';
import { checkExportVisibility } from './controls.js';

export const cells = (ctx) => (ctx || activeGrid).cells;
export let activeSubIndex = null;

// A setter to allow other modules to clear activeSubIndex
export function setActiveSubIndex(val) {
  activeSubIndex = val;
}

export function toggleSticking(index, ctx = activeGrid) {
  // 1. Get current effective hand (could be manual or auto)
  const currentEffective = getEffectiveHand(index, ctx);

  // 2. Temporarily clear manual so we see what 'Natural' is
  const savedManual = ctx.innerHands[index];
  ctx.innerHands[index] = null;
  const natural = getEffectiveHand(index, ctx);

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

export function getEffectiveHand(index, ctx) {
  const c = ctx || activeGrid;
  const manual = c.innerHands[index];
  if (manual) return manual;

  // Default Logic
  if (c.mode === '8') {
    return (index % 2 === 0) ? 'R' : 'L';
  } else {
    // 16th note default (Standard Alternating: R L R L)
    const pos = index % 4;
    return (pos === 0 || pos === 2) ? 'R' : 'L';
  }
};

export function invertRange(start, end, ctx = activeGrid) {
  const gridCells = cells(ctx);
  const max = Math.min(ctx.innerHands.length, gridCells.length);
  const limit = Math.min(end + 1, max); // end is inclusive in range, loop is exclusive

  for (let i = start; i < limit; i++) {
    const current = getEffectiveHand(i, ctx);
    const flipped = (current === 'R' ? 'L' : 'R');
    ctx.innerHands[i] = flipped;
  }
  renderAllMeasures(ctx);
};

export function invertFollowing(startIndex, ctx = activeGrid) {
  invertRange(startIndex, Infinity, ctx);
};

export function setCols(n, ctx = activeGrid) {
  // Apply to the measures wrapper (it cascades to measure children)
  const measuresEl = ctx.container;
  if (measuresEl) measuresEl.style.setProperty('--cols', String(n));
}

export function labelForStep(i, ctx = activeGrid) {
  const ts = getTimeSignature();
  let [num, den] = ts.split('/');
  den = Number(den) || 4;

  const base = (ctx.mode === '16') ? 16 : 8;
  const stride = base / den;

  if (labelNotation === 'numeric') {
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

export function clearGridDom(ctx = activeGrid) {
  const measuresEl = ctx.container;
  if (measuresEl) measuresEl.innerHTML = '';
}

export function clearSelection(ctx = activeGrid) {
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
  setIsEditMulti(false);
}

export function applySelection(i, ctx = activeGrid) {
  ctx.caretIndex = i;
  cells(ctx).forEach((c, idx) => c.classList.toggle('selected', idx === i));
}

export function renderAllMeasures(ctx = activeGrid) {
  const measuresEl = ctx.container;
  if (!measuresEl) return;

  const s = ctx.stepsPerMeasure; // Used to be getStepCountPerMeasure(ctx)
  const totalSteps = Array.isArray(ctx.innerLabels) ? ctx.innerLabels.length : 0;
  const measureCount = Math.max(1, Math.ceil(totalSteps / s));

  measuresEl.innerHTML = '';

  for (let m = 0; m < measureCount; m++) {
    const row = document.createElement('div');
    row.className = 'measure-row';
    if (s === 12) row.classList.add('twelve-beats');
    if (s <= 6) row.classList.add('fewer-beats');

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

      const isMultiCell = checkCellIsMultiMode(lbl);

      if (!isMultiCell) {
        // Set single-note cell labels
        // Resolve Display Text (Number vs Pitch)
        let displayText = lbl;
        const isDing = (lbl === '0' || lbl === 'Ding');

        const pref = localStorage.getItem('handpanLabelPref') || 'Numbers';

        if (isDing) {
          if (pref === 'Pitches') {
            cell.classList.add('visual-ding');
            displayText = ''; // Use egg, hide text
          } else {
            cell.classList.remove('visual-ding');
            displayText = 'D'; // Numbers mode: show 'D'
          }
        } else {
          cell.classList.remove('visual-ding');
          if (pref === 'Pitches' && lbl !== '' && getScale) {
            const scale = getScale();
            if (scale && scale.map) {
              // Find pitch for this label
              let pitch = scale.map[lbl];

              // Special handling for Ding if mapped differently
              if (!pitch && isDing) pitch = scale.ding;
              if (pitch) {
                // Format: "C#4" -> "C#" (cleaner for grid)
                displayText = pitch.replace('s', '#').replace(/[0-9]/g, '');
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
      if (lbl === 'Ding') cell.classList.add('label-ding');
      else if (lbl === 'T') cell.classList.add('label-t');
      else if (lbl === 'S') cell.classList.add('label-s');
      else if (lbl === '?') cell.classList.add('label-q');
      else if (lbl !== '') cell.classList.add('label-n');

      if (ctx.id === 'A' && g === ctx.caretIndex) cell.classList.add('selected');

      // Hand sticking
      const hand = getEffectiveHand(g, ctx);
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

  // Notify listeners (e.g. Presentation Mode) that DOM was rebuilt
  Bus.emit(BUS_EVENT.GRID_RENDERED, { gridId: ctx.id });

  if (ctx.id === 'A') {
    checkExportVisibility();
  }
}

// ===== SELECTION ACTIONS ===== //

export let beatClipboard = null;

function snapshotBeat(i, ctx = activeGrid) {
  // Adjust if your state storage differs:
  let label = Array.isArray(ctx.innerLabels) ? (ctx.innerLabels[i] || '') : '';
  // Deep copy if it is a multi-cell array, so we don't store a reference
  if (checkCellIsMultiMode(label)) {
    label = [...label];
  }
  return { label };
}

function applyBeat(i, beat, ctx = activeGrid) {
  // Adjust if your state storage differs:
  let val = beat.label || '';
  // Deep copy on paste/apply so multiple pastes don't share references
  if (checkCellIsMultiMode(val)) {
    val = [...val];
  }

  setInnerLabel(i, val, ctx); // internal call
}

export function setBeatToGhost(i, ctx = activeGrid) {
  // Your ghost behavior may be "no label + default dot".
  // We'll implement as clearing label + turning OFF accent.
  setInnerLabel(i, '', ctx);
}

export function copySelection(ctx = activeGrid) {
  const r = (typeof getRange === 'function') ? getRange(ctx) : null;
  if (!r) return;

  const steps = [];
  for (let i = r.start; i <= r.end; i++) {
    steps.push(snapshotBeat(i, ctx));
  }

  beatClipboard = { type: 'beats', steps: steps };
  const btn = document.getElementById('selPasteBtn');
  if (btn) btn.disabled = false;
}

export function pasteSelection(ctx = activeGrid) {
  if (!beatClipboard || beatClipboard.type !== 'beats') return;
  if (HistoryManager) HistoryManager.pushState();

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
    if (checkCellIsMultiMode(val)) {
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

export function deleteSelection(ctx = activeGrid) {
  const r = (typeof getRange === 'function') ? getRange(ctx) : null;
  if (!r) return;
  if (HistoryManager) HistoryManager.pushState();

  // Update model directly
  for (let i = r.start; i <= r.end; i++) {
    ctx.innerLabels[i] = '';
  }

  // Full render to restore 'ghost' state with correct hand/beat classes
  renderAllMeasures(ctx);
}

export function setInnerLabel(i, value, ctx = activeGrid) {
  const cell = cells(ctx)[i];
  if (!cell) return;

  if (activeSubIndex == null) {
    // Set single note
    ctx.innerLabels[i] = value;
    const inner = cell.querySelector('.inner');
    const v = String(value || '');
    const isDing = (v === 'Ding' || v === '0');
    const pref = localStorage.getItem('handpanLabelPref') || 'Numbers';

    if (inner) {
      if (isDing) {
        inner.textContent = (pref === 'Pitches') ? '' : 'D';
      } else {
        inner.textContent = value;
      }
    }

    cell.classList.remove('label-ding', 'label-t', 'label-s', 'label-n', 'label-q', 'has-label', 'visual-ding');

    if (isDing && pref === 'Pitches') cell.classList.add('visual-ding');

    // ghost = no label set
    cell.classList.toggle('ghost', !v);

    if (!v) return;
    cell.classList.add('has-label');

    if (v === 'Ding') cell.classList.add('label-ding');
    else if (v === 'T') cell.classList.add('label-t');
    else if (v === 'S') cell.classList.add('label-s');
    else if (v === '?') cell.classList.add('label-q');
    else cell.classList.add('label-n'); // Default to number style

    cell.classList.remove('multi-mode');

  } else {
    // Set sub notes
    if (!checkCellIsMultiMode(ctx.innerLabels[i])) {
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

  if (ctx.id === 'A') {
    checkExportVisibility();
  }
}

function attachCellListeners(cell, ctx = activeGrid) {
  // Pointer selection
  cell.addEventListener('click', (ev) => {
    ev.stopPropagation();

    // Set activeGrid on click
    setActiveGrid(ctx);

    // --- REVIEW MODE INTERCEPTION ---
    if (isReviewing && isReviewing()) {
      const gIndex = parseInt(cell.dataset.index);
      if (!isNaN(gIndex)) {
        const feedback = getFeedbackForStep(gIndex);
        if (feedback) {
          if (longPressFired) {
            // ... existing long press logic ...
            copyLogsForStep(gIndex).then(copied => {
              const status = copied ? " (Logs copied!)" : " (No logs)";
              showFeedbackTooltip(cell, feedback + status);
              setLongPressFired(false);
            });
          } else {
            // QUICK CLICK: Check for "Wrong Note" or "Missed Note" to offer Challenge
            // Simple heuristic based on feedback string
            const isError = feedback.includes('Wrong') || feedback.includes('Missed') || feedback.includes('Misclassified');

            if (isError) {
              // Challenge Logic
              const expected = getExpectedNoteForStep(gIndex);
              if (expected) {
                const confirmChallenge = confirm(`I detected a mistake:\n"${feedback}"\n\nDid you play a '${expected}' correctly?\n\nClick OK to train me to hear it better next time.`);
                if (confirmChallenge) {
                  Bus.emit(BUS_EVENT.CHALLENGE_CORRECTION, { targetNote: expected });
                }
              } else {
                showFeedbackTooltip(cell, feedback);
              }
            } else {
              showFeedbackTooltip(cell, feedback);
            }
          }
        }
      }
      return; // BLOCK EDITING
    }

    const x = ev.clientX;
    const y = ev.clientY;
    const actualTarget = document.elementFromPoint(x, y);
    const subDot = actualTarget?.closest('.sub-dot');

    const i = parseInt(cell.dataset.index);
    if (isNaN(i)) return;

    // CHECK EDIT HANDS MODE
    if (editHandsMode) {
      if (HistoryManager) HistoryManager.pushState();
      toggleSticking(i, ctx);
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
    if (!checkCellIsMultiMode(lbl)) {
      cell.classList.remove('multi-mode');
    }

    if (longPressFired) {
      setLongPressFired(false);
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
    setIsEditMulti(true);
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

    if (HistoryManager) HistoryManager.pushState();
    toggleSticking(i, ctx);

    // Only move caret/selection if NOT a multi-note cell
    // (Prevents visual clutter/accidental overwrite on chords)
    const lbl = ctx.innerLabels[i];
    const isMulti = checkCellIsMultiMode(lbl);
    if (!isMulti) setCaret(i, ctx);
  });
}

export function checkCellIsMultiMode(label) {
  return Array.isArray(label);
}

export function setDualGrid(next) {
  const mB = document.getElementById('measures-B');
  const cB = document.getElementById('controls-B');
  const btn = document.getElementById('dualModeBtn');
  if (!mB || !cB || !btn) return;

  mB.style.display = next ? 'block' : 'none';
  cB.style.display = next ? 'flex' : 'none';
  btn.classList.toggle('active', next);

  if (next) {
    if (gridB.innerLabels.length === 0) {
      const s = gridA.stepsPerMeasure;
      gridB.innerLabels = Array(gridA.measures * s).fill('');
      gridB.innerHands = Array(gridA.measures * s).fill(null);
    }
    renderAllMeasures(gridB);
  } else {
    stop(gridB, false);
    TransportRegistry.updateAll(gridB);
  }
}

// ==== CHORD INJECTION LOGIC ====

export function assignChordToSelectedCell(labels, ctx = activeGrid) {
  // Find selected cell
  const gridCells = cells(ctx);
  let selIdx = ctx.caretIndex ?? -1;

  if (selIdx === -1) return false;

  if (HistoryManager) HistoryManager.pushState();

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

// ===== INITIALIZATION =====
export function initNoteGrid() {
  // Attach selection button event listeners
  document.getElementById('selCopyBtn')?.addEventListener('click', () => copySelection());
  document.getElementById('selPasteBtn')?.addEventListener('click', () => pasteSelection());
  document.getElementById('selDeleteBtn')?.addEventListener('click', () => deleteSelection());
  document.getElementById('selCancelBtn')?.addEventListener('click', () => {
    clearRange(); // imported from range-selection.js
  });
}
