import { gridA, gridB } from './grid-context.js';
import { spellNote } from './utils.js';
import { activeGrid, currentUser, setActiveGrid } from './state.js';
import { stop, setBeats, setSubdivision } from './noteplayer.js';
import { getScale } from './state.js';
import { setCaret, setRange, clearRange, getRange, updateDragSelectionOver, startLongPress, cancelLongPress, hasRange } from './range-selection.js';
import { HistoryManager } from './history.js';
import { editHandsMode, isEditMulti, multiEditSessionSlot, longPressFired, setLongPressFired, setIsEditMulti, setMultiEditSessionSlot, labelNotation, isEditFlam, setIsEditFlam } from './state.js';
import { TransportRegistry } from './transport-ui.js';
import { isReviewing, getFeedbackForStep, showFeedbackTooltip, copyLogsForStep, getExpectedNoteForStep } from './coaching-mode.js';
import { Bus, BUS_EVENT } from './bus.js';
import { checkExportVisibility } from './controls.js';
import { confirm } from './alert.js';
import { getNoteX } from './handpanmap.js';

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

  // Hands alternate at the 8th-note level.
  // subdivision ≥ 4 (16th notes) → alternate every 2 steps; otherwise every step.
  const handStride = (c.subdivision || 2) >= 4 ? 2 : 1;
  return (Math.floor(index / handStride) % 2 === 0) ? 'R' : 'L';
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

const MOBILE_MAX_COLS = 8;
function smartMobileCols(s) {
  if (!window.matchMedia('(max-width: 768px)').matches) return s;
  if (s <= MOBILE_MAX_COLS) return s;
  for (let d = MOBILE_MAX_COLS; d >= 2; d--) {
    if (s % d === 0) return d;
  }
  return MOBILE_MAX_COLS;
}
const capCols = n => smartMobileCols(n);

export function setCols(n, ctx = activeGrid) {
  // Apply to the measures wrapper (it cascades to measure children)
  const measuresEl = ctx.container;
  if (measuresEl) measuresEl.style.setProperty('--cols', String(capCols(n)));
}

export function labelForStep(i, ctx = activeGrid) {
  const sub = ctx.subdivision || 2;

  if (labelNotation === 'numeric') {
    return String(i + 1);
  }

  const beatNumber = Math.floor(i / sub) + 1;
  const pos = i % sub;

  if (pos === 0) return String(beatNumber);

  // Subdivision labels based on steps-per-beat
  if (sub === 4) {
    if (pos === 1) return 'e';
    if (pos === 2) return '&';
    if (pos === 3) return 'a';
  } else if (sub === 2) {
    if (pos === 1) return '&';
  } else if (sub === 3) {
    if (pos === 1) return '²';
    if (pos === 2) return '³';
  }

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
  Bus.emit(BUS_EVENT.CARET_CHANGED);
}

export function updateMultiCursor(ctx = activeGrid) {
  cells(ctx).forEach(c => c.querySelectorAll('.sub-dot').forEach(s => s.classList.remove('selected')));
  if (!isEditMulti || multiEditSessionSlot === null || multiEditSessionSlot >= 4) return;
  if (ctx.caretIndex === null) return;
  const cell = Array.from(cells(ctx)).find(c => +c.dataset.index === ctx.caretIndex);
  cell?.querySelector(`.sub-dot[data-idx="${multiEditSessionSlot}"]`)?.classList.add('selected');
}

export function applySelection(i, ctx = activeGrid) {
  ctx.caretIndex = i;
  cells(ctx).forEach((c, idx) => c.classList.toggle('selected', idx === i));
}

export function resetGridToDefault(ctx = activeGrid) {
  ctx.innerHands = [];
  setDualGrid(false);
  clearGrid(ctx);
  setBeats(4); setSubdivision(2);
  ctx.setMeasures(2);
  renderAllMeasures(ctx);
}

function resolveLabelText(lbl, pref, isMulti = false, subIdx = null) {
  if (isMulti) {
    let subText = lbl[subIdx] || '';
    if (subText === '0' || subText === 'Ding') {
      return (pref === 'Numbers') ? 'D' : '';
    }
    if (pref === 'Pitches' && subText !== '' && getScale) {
      const scale = getScale();
      if (scale && scale.map) {
        const pitch = scale.map[subText];
        if (pitch) return spellNote(pitch, Object.values(scale.map));
      }
    }
    return subText;
  }

  const isDing = (lbl === '0' || lbl === 'Ding');
  if (isDing) {
    return (pref === 'Pitches') ? '' : 'D';
  }

  if (pref === 'Pitches' && lbl !== '' && getScale) {
    const scale = getScale();
    if (scale && scale.map) {
      let pitch = scale.map[lbl];
      if (!pitch && isDing) pitch = scale.ding;
      if (pitch) {
        return spellNote(pitch, Object.values(scale.map));
      }
    }
  }
  return lbl;
}

export function updateGridLabels(ctx = activeGrid) {
  if (!ctx || !ctx.container) return;
  const pref = localStorage.getItem('handpanLabelPref') || 'Numbers';
  const allCells = ctx.container.querySelectorAll('.cell');

  allCells.forEach(cell => {
    const g = parseInt(cell.dataset.index);
    if (isNaN(g)) return;
    const lbl = ctx.innerLabels[g] || '';
    const isMultiCell = checkCellIsMultiMode(lbl);

    if (!isMultiCell) {
      const inner = cell.querySelector('.inner');
      if (inner) {
        const displayText = resolveLabelText(lbl, pref, false);
        inner.textContent = displayText;

        // Ding Egg handles
        if (lbl === '0' || lbl === 'Ding') {
          cell.classList.toggle('visual-ding', pref === 'Pitches');
        } else {
          cell.classList.remove('visual-ding');
        }
      }
    } else {
      const allSubs = cell.querySelectorAll('.sub-dot');
      allSubs.forEach((sub, sIdx) => {
        sub.textContent = resolveLabelText(lbl, pref, true, sIdx);
        const isSubDing = lbl[sIdx] === '0' || lbl[sIdx] === 'Ding';
        sub.classList.toggle('visual-ding', isSubDing && pref === 'Pitches');
      });
    }
  });
}

export function renderAllMeasures(ctx = activeGrid) {
  const measuresEl = ctx.container;
  if (!measuresEl) return;

  const s = ctx.stepsPerMeasure;
  const rawSteps = Array.isArray(ctx.innerLabels) ? ctx.innerLabels.length : 0;
  const measureCount = Math.max(1, Math.ceil(rawSteps / s));
  // Ensure innerLabels is aligned to a whole number of measures.
  // If stepsPerMeasure changed (e.g. time sig / mode change), the array may be
  // a non-multiple of s, which causes cursor wrap and duplicate-paste bugs.
  const targetLength = measureCount * s;
  if (Array.isArray(ctx.innerLabels) && ctx.innerLabels.length < targetLength) {
    ctx.innerLabels.push(...Array(targetLength - ctx.innerLabels.length).fill(''));
  }
  if (Array.isArray(ctx.innerHands) && ctx.innerHands.length < targetLength) {
    ctx.innerHands.push(...Array(targetLength - ctx.innerHands.length).fill(null));
  }
  if (!Array.isArray(ctx.innerFlams) || ctx.innerFlams.length < targetLength) {
    const existing = Array.isArray(ctx.innerFlams) ? ctx.innerFlams : [];
    ctx.innerFlams = [...existing, ...Array(targetLength - existing.length).fill('')];
  }
  const totalSteps = targetLength;

  measuresEl.innerHTML = '<div class="measures-scroller"></div>';
  const scroller = measuresEl.firstChild;

  const pref = localStorage.getItem('handpanLabelPref') || 'Numbers';

  for (let m = 0; m < measureCount; m++) {
    const row = document.createElement('div');
    row.className = 'measure-row';
    if (s >= 16) row.classList.add('sixteen-beats');
    else if (s >= 12) row.classList.add('twelve-beats');
    if (s > 4 && s <= 6) row.classList.add('fewer-beats');
    if (s <= 4) row.classList.add('four-beats');

    const header = document.createElement('div');
    header.className = 'measure-header';
    header.textContent = `Measure ${m + 1}`;
    row.appendChild(header);

    const labels = document.createElement('div');
    labels.className = 'labels';
    labels.style.setProperty('--cols', String(capCols(s)));

    const grid = document.createElement('div');
    grid.className = 'grid';
    grid.style.setProperty('--cols', String(capCols(s)));

    const labelCols = capCols(s);

    // Build labels + cells
    for (let i = 0; i < s; i++) {
      // label — on mobile, only render labels for the first row
      if (m % 4 == 0 && i < labelCols) {
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

      // Flam circle (grace note — always in DOM, shown via CSS when has-flam / flam-editing)
      const flamCircle = document.createElement('div');
      flamCircle.className = 'flam-circle';
      cell.appendChild(flamCircle);

      // Global index
      const g = (m * s) + i;
      const lbl = ctx.innerLabels[g] || '';

      const isMultiCell = checkCellIsMultiMode(lbl);

      if (!isMultiCell) {
        inner.textContent = resolveLabelText(lbl, pref, false);
        if (lbl === '0' || lbl === 'Ding') {
          cell.classList.toggle('visual-ding', pref === 'Pitches');
        }
      } else {
        cell.classList.add('multi-mode');
        const allSubs = cell.querySelectorAll('.sub-dot');
        for (let idx = 0; idx < allSubs.length; idx++) {
          allSubs[idx].textContent = resolveLabelText(lbl, pref, true, idx);
          allSubs[idx].classList.toggle('active', !!lbl[idx]);
          const isSubDing = lbl[idx] === '0' || lbl[idx] === 'Ding';
          allSubs[idx].classList.toggle('visual-ding', isSubDing && pref === 'Pitches');
        };
      }

      cell.dataset.index = g;

      // Flam (grace note) content
      const flamLbl = ctx.innerFlams && ctx.innerFlams[g];
      if (flamLbl) {
        flamCircle.textContent = resolveLabelText(flamLbl, pref, false);
        cell.classList.add('has-flam');
      }
      if (ctx.id === 'A' && g === ctx.caretIndex && isEditFlam) {
        cell.classList.add('flam-editing');
      }

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
    scroller.appendChild(row);

    // Horizontal line
    const hr = document.createElement('hr');
    scroller.appendChild(hr);
  }

  // Notify listeners (e.g. Presentation Mode) that DOM was rebuilt
  Bus.emit(BUS_EVENT.GRID_RENDERED, { gridId: ctx.id });

  if (ctx.id === 'A') {
    checkExportVisibility();
  }
}

export function clearGrid(ctx = activeGrid) {
  if (HistoryManager) HistoryManager.pushState();
  const s = ctx.stepsPerMeasure;
  ctx.innerLabels = Array(ctx.measures * s).fill('');
  ctx.innerHands = Array(ctx.measures * s).fill(null);
  ctx.innerFlams = Array(ctx.measures * s).fill('');
  renderAllMeasures(ctx);
  ctx.step = 0;
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
  if (isReviewing && isReviewing()) return; // BLOCK EDITING
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
  if (isReviewing && isReviewing()) return; // BLOCK EDITING
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
  if (isReviewing && isReviewing()) return; // BLOCK EDITING
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

    if (ctx.innerLabels[i].some(l => !!l)) {
      cell.classList.add('multi-mode');
    }

    const pref = localStorage.getItem('handpanLabelPref') || 'Numbers';
    const labels = ctx.innerLabels[i].filter(l => l !== '');
    cell.classList.toggle('has-label', labels.length > 0);

    const subs = Array.from(cell.querySelectorAll('.sub-dot'));
    ctx.innerLabels[i].forEach((label, idx) => {
      subs[idx].textContent = resolveLabelText(ctx.innerLabels[i], pref, true, idx);
      const isSubDing = label === '0' || label === 'Ding';
      subs[idx].classList.toggle('visual-ding', isSubDing && pref === 'Pitches');
    });
  }

  if (ctx.id === 'A') {
    checkExportVisibility();
  }
}

export function setInnerFlam(i, value, ctx = activeGrid) {
  if (!Array.isArray(ctx.innerFlams)) ctx.innerFlams = Array(ctx.innerLabels.length).fill('');
  ctx.innerFlams[i] = value || '';

  const cell = cells(ctx)[i];
  if (!cell) return;

  let flamCircle = cell.querySelector('.flam-circle');
  if (!flamCircle) {
    flamCircle = document.createElement('div');
    flamCircle.className = 'flam-circle';
    cell.appendChild(flamCircle);
  }

  if (value) {
    const pref = localStorage.getItem('handpanLabelPref') || 'Numbers';
    flamCircle.textContent = resolveLabelText(value, pref, false);
    cell.classList.add('has-flam');
  } else {
    flamCircle.textContent = '';
    cell.classList.remove('has-flam');
  }
}

function activateMultiMode(cell, ctx) {
  setIsEditMulti(true);
  cell.classList.add('multi-selected');
  const allSubs = Array.from(cell.querySelectorAll('.sub-dot'));
  allSubs.forEach(s => s.classList.add('active'));
  updateMultiCursor(ctx);
}

const DOUBLE_TAP_MS = 350;

function attachCellListeners(cell, ctx = activeGrid) {
  let lastTapTime = 0;

  // Pointer selection
  cell.addEventListener('click', async (ev) => {
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
                const confirmChallenge = await confirm(`I detected a mistake:\n"${feedback}"\n\nDid you play a '${expected}' correctly?\n\nClick OK to train me to hear it better next time.`);
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

    // iOS Safari's `dblclick` is synthesized from the double-tap-to-zoom
    // gesture recognizer, which .cell's `touch-action: none` (needed so the
    // long-press/drag-select handling below gets raw touch input) disables
    // entirely — so a real double-tap there never produces a dblclick.
    // Detect it manually from click timing instead; mouse input already gets
    // a native dblclick, so this only needs to run for touch/coarse pointers.
    if (window.matchMedia('(pointer: coarse)').matches) {
      const now = Date.now();
      if (now - lastTapTime < DOUBLE_TAP_MS) {
        lastTapTime = 0;
        activateMultiMode(cell, ctx);
      } else {
        lastTapTime = now;
      }
    }

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
      const slotIdx = allSubs.indexOf(subDot);
      activeSubIndex = slotIdx;
      setMultiEditSessionSlot(slotIdx);

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

    // Plain tap on a touchscreen: just move the caret so the user can write
    // into the cell as normal. Deliberately does NOT set a range — that's
    // what triggers the selection toolbar/mobile selection-mode UI, which on
    // a touch device should only appear from a long-press (see startLongPress
    // below), not a quick tap — otherwise every tap-to-write hides the
    // handpan. On desktop (fine/mouse pointer) a plain click has always
    // opened the selection menu directly; there's no long-press gesture to
    // fall back on there, so keep that behaviour.
    ctx.selecting = false;
    if (window.matchMedia('(pointer: coarse)').matches) {
      clearRange(ctx);
      ctx.anchorIndex = i;
      setCaret(i, ctx);
    } else {
      ctx.anchorIndex = i;
      setCaret(i, ctx);
      setRange(i, i, ctx);
    }
  });

  cell.addEventListener('dblclick', (ev) => {
    ev.stopPropagation();
    if (isReviewing && isReviewing()) return; // BLOCK EDITING
    activateMultiMode(cell, ctx);
  });

  cell.addEventListener('pointerdown', (ev) => {
    if (ev.button !== undefined && ev.button !== 0) return;
    if (typeof startLongPress === 'function') startLongPress(cell);
    cell.setPointerCapture?.(ev.pointerId);
  });

  cell.addEventListener('pointermove', (ev) => {
    if (ctx.selecting) {
      ev.preventDefault();
      // setPointerCapture (below) retargets every pointer event to this same
      // cell regardless of where the pointer actually is, so resolve the
      // real cell under the pointer instead of using this listener's own
      // `cell` closure — otherwise dragging never extends past the anchor.
      const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.cell');
      if (target && typeof updateDragSelectionOver === 'function') updateDragSelectionOver(target, ctx);
    }
  });

  cell.addEventListener('pointerup', () => {
    if (typeof cancelLongPress === 'function') cancelLongPress();
    ctx.selecting = false;
  });

  cell.addEventListener('pointercancel', () => {
    if (typeof cancelLongPress === 'function') cancelLongPress();
  });

  // Right-click hand sticking — desktop mouse only
  cell.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (ev.button !== 2) return;
    if (isReviewing && isReviewing()) return; // BLOCK EDITING

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
  if (isReviewing && isReviewing()) return false; // BLOCK EDITING
  // Find selected cell
  const gridCells = cells(ctx);
  let selIdx = ctx.caretIndex ?? -1;

  if (selIdx === -1) return false;

  if (HistoryManager) HistoryManager.pushState();

  // Slots: 0=LI, 1=LT, 2=RI, 3=RT
  const slots = ['', '', '', ''];

  // Exactly two notes played together: no same-hand assumption — the
  // physically further-left note goes to the left index, the further-right
  // note goes to the right index. Only 3+ simultaneous notes imply one hand
  // is covering two of them (thumb + index) via the pairing logic below.
  if (labels.length === 2) {
    const xs = labels.map(l => getNoteX(l));
    if (xs[0] !== null && xs[1] !== null) {
      const [a, b] = labels;
      if (xs[0] <= xs[1]) { slots[0] = String(a); slots[2] = String(b); }
      else { slots[0] = String(b); slots[2] = String(a); }
      ctx.innerLabels[selIdx] = slots;
      renderAllMeasures(ctx);
      return true;
    }
  }

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

// Listen for automation events (useful for tests without exposing globals)
if (typeof window !== 'undefined') {
  window.addEventListener('notegrid:setNote', (e) => {
    const { index, note, ctx } = e.detail || {};
    if (typeof index === 'number') {
      if (typeof setInnerLabel === 'function') {
        const targetGrid = ctx || (typeof activeGrid !== 'undefined' ? activeGrid : null);
        setInnerLabel(index, note || '', targetGrid);
      }
    }
  });

  window.addEventListener('notegrid:render', (e) => {
    if (typeof renderAllMeasures === 'function') {
      const targetGrid = e.detail?.ctx || (typeof activeGrid !== 'undefined' ? activeGrid : null);
      renderAllMeasures(targetGrid);
    }
  });
}

// Click outside to clear selection (caret and range)
window.addEventListener('click', (e) => {
  if (
    (activeGrid.caretIndex !== null || hasRange(activeGrid)) &&
    !e.target.closest('.cell') &&
    !e.target.closest('.measure-tools') &&
    !e.target.closest('.sel-bar') &&
    !e.target.closest('.hp-dot') &&
    !e.target.closest('.hp-overlay') &&
    !e.target.closest('.handpan-tabs') &&
    !e.target.closest('#ghostBtn')
  ) {
    clearSelection(activeGrid);
  }
});
