import { activeGrid } from './grid-context.js';
import { setCaret, clearRange } from './range-selection.js';
import { setInnerLabel, renderAllMeasures, setActiveSubIndex, updateMultiCursor } from './notegrid.js';
import { HistoryManager } from './history.js';
import { isReviewing } from './coaching-mode.js';
import { AUTO_ADVANCE_KEY } from './config.js';
import { isEditMulti, multiEditSessionSlot, advanceMultiEditSessionSlot, freePlay } from './state.js';

// Auto-advance: after writing a note, the caret moves to the next step
let autoAdvance = (localStorage.getItem(AUTO_ADVANCE_KEY) === 'on');

const autoAdvanceBtns = document.querySelectorAll('.auto-advance-btn');

export function updateAutoAdvanceUI() {
  autoAdvanceBtns.forEach(btn => {
    btn.classList.toggle('active', autoAdvance);
    btn.setAttribute('aria-pressed', String(autoAdvance));
  });
  document.body.classList.toggle('auto-advance', autoAdvance);
}

autoAdvanceBtns.forEach(btn => {
  btn.addEventListener('click', () => setAutoAdvance(!autoAdvance));
});

function totalSteps(ctx) {
  return (ctx || activeGrid).innerLabels.length;
}

export function clampIndex(i, ctx) {
  const c = ctx || activeGrid;
  const n = totalSteps(c);
  if (n <= 0) return 0;
  return (i % n + n) % n; // wrap
}

export function advanceSelection(delta = 1, ctx) {
  const c = ctx || activeGrid;
  if (c.caretIndex === null) return;

  const next = clampIndex(c.caretIndex + delta, c);

  setCaret(next, c);
  clearRange(c);
}

export function writeToSelected(label, { advance = true } = {}, ctx) {
  if (isReviewing && isReviewing()) return; // BLOCK EDITING
  const c = ctx || activeGrid;
  if (HistoryManager) HistoryManager.pushState();
  if (c.caretIndex === null) return;

  setInnerLabel(c.caretIndex, label, c);

  // If clearing a note (especially if it was multi-mode), force render to restore classes
  if (!label) {
    renderAllMeasures(c);
  }

  // Compose advance unless Alt is held
  if (autoAdvance && advance) advanceSelection(1, c);
}

/**
 * Write a note label respecting the active multi-edit session.
 * When a session is active (double-click started it), writes to the current
 * session slot and advances the cursor. Otherwise falls back to writeToSelected.
 */
export function writeToSession(label, { advance = true } = {}, ctx) {
  if (freePlay) return; // playing the pan, not writing to the grid
  if (isEditMulti && multiEditSessionSlot !== null) {
    if (multiEditSessionSlot >= 4) return;
    setActiveSubIndex(multiEditSessionSlot);
    writeToSelected(label, { advance: false }, ctx);
    setActiveSubIndex(null);
    advanceMultiEditSessionSlot();
    updateMultiCursor(ctx || activeGrid);
  } else {
    writeToSelected(label, { advance }, ctx);
  }
}

// Expose for other modules
export function getAutoAdvance() { return autoAdvance; }
export function setAutoAdvance(val) {
  autoAdvance = val;
  localStorage.setItem(AUTO_ADVANCE_KEY, val ? 'on' : 'off');
  updateAutoAdvanceUI();
}