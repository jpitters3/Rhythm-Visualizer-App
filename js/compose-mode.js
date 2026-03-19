import { activeGrid } from './grid-context.js';
import { setCaret, clearRange } from './range-selection.js';
import { setInnerLabel, renderAllMeasures } from './notegrid.js';
import { HistoryManager } from './history.js';
import { isReviewing } from './coaching-mode.js';
import { COMPOSE_KEY } from './config.js';

let composeOn = (localStorage.getItem(COMPOSE_KEY) === 'on');

const composeBtns = document.querySelectorAll('.compose-btn');

export function updateComposeUI() {
  if (!composeBtns) return;
  composeBtns.forEach(btn => {
    btn.classList.toggle('active', composeOn);
  });
  document.body.classList.toggle('composeOn', composeOn);
}

if (composeBtns) {
  composeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      composeOn = !composeOn;
      localStorage.setItem(COMPOSE_KEY, composeOn ? 'on' : 'off');
      updateComposeUI();
    });
  });
}

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
  if (composeOn && advance) advanceSelection(1, c);
}

// Expose for other modules
export function getComposeOn() { return composeOn; }
export function setComposeOn(val) {
  composeOn = val;
  localStorage.setItem(COMPOSE_KEY, val ? 'on' : 'off');
  updateComposeUI();
}