import { activeGrid } from './grid-context.js';
import { setCaret, clearRange, applySelection } from './range-selection.js';
import { cells, setInnerLabel, renderAllMeasures } from './notegrid.js';
import { getStepCountPerMeasure } from './measure-actions.js';

export const COMPOSE_KEY = 'groovepan_compose_mode';
let composeOn = (localStorage.getItem(COMPOSE_KEY) === 'on');

const composeBtn = document.getElementById('composeBtn');
// handpanSection / ghostNoteSection are likely globals from index.html (IDs) or other scripts.
// We'll trust they exist on window or DOM query them.
const handpanSection = document.getElementById('handpanSection');
const ghostNoteSection = document.getElementById('ghostNoteSection');


export function updateComposeUI() {
  if (!composeBtn) return;
  composeBtn.classList.toggle('active', composeOn);
  document.body.classList.toggle('composeOn', composeOn);

  // Lock the handpan section on mobile
  if (handpanSection) handpanSection.classList.toggle('locked', composeOn);
  if (ghostNoteSection) ghostNoteSection.classList.toggle('locked', composeOn);

  scrollToPatternGrid(composeOn);
}

if (composeBtn) {
  composeBtn.addEventListener('click', () => {
    composeOn = !composeOn;
    localStorage.setItem(COMPOSE_KEY, composeOn ? 'on' : 'off');
    updateComposeUI();
  });
}

function totalSteps(ctx) {
  return (ctx || activeGrid).innerLabels.length;
}

function clampIndex(i, ctx) {
  const c = ctx || activeGrid;
  const n = totalSteps(c);
  if (n <= 0) return 0;
  return (i % n + n) % n; // wrap
}

function advanceSelection(delta = 1, ctx) {
  const c = ctx || activeGrid;
  if (c.caretIndex === null) return;

  const next = clampIndex(c.caretIndex + delta, c);
  // applySelection(next, c); // Not exported? It's applySelectionLocal inside, but exposed as window.applySelection?
  // Check range-selection.js... it exported setCaret.
  // compose-mode calls applySelection?
  // Let's check imports.
  // Actually, we imported applySelection from range-selection.js if it exists.
  // In previous steps, range-selection.js had applySelection available?
  // Wait, range-selection.js exported setCaret, setRange, clearRange... 
  // It has a local 'applySelectionLocal'.
  // But notegrid.js exposed window.applySelection = applySelection.
  // We should prefer setCaret if it does the job.
  // setCaret calls applySelectionLocal.

  setCaret(next, c);
  // Optimization: setCaret clears range? No, setRange(i,i) does.
  // setCaret usually handles single selection.

  clearRange(c); // Ensure range is cleared

  // Nice UX: keep selection visible when you have many measures
  const s = getStepCountPerMeasure(c);
  const gridCells = cells(c);
  let cell = gridCells[next - s]; // Scroll to one measure before the next cell
  cell = cell ? cell : gridCells[next];
  cell?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

export function writeToSelected(label, { advance = true } = {}, ctx) {
  const c = ctx || activeGrid;
  if (window.HistoryManager) window.HistoryManager.pushState();
  if (c.caretIndex === null) return;

  setInnerLabel(c.caretIndex, label, c);

  // If clearing a note (especially if it was multi-mode), force render to restore classes
  if (!label) {
    renderAllMeasures(c);
  }

  // Compose advance unless Alt is held
  if (composeOn && advance) advanceSelection(1, c);
}

function labelFromHandpanDot(dotNote) {
  return dotNote;
}

function scrollToPatternGrid(composeOn, ctx) {
  const c = ctx || activeGrid;
  if (composeOn) {
    const i = c.caretIndex ? c.caretIndex : 0;
    let cell = cells(c)[i];
    cell?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
}

// Expose for other modules
export function getComposeOn() { return composeOn; }
export function setComposeOn(val) {
  composeOn = val;
  localStorage.setItem(COMPOSE_KEY, val ? 'on' : 'off');
  updateComposeUI();
}

// ==== WINDOW EXPOSE ====
window.writeToSelected = writeToSelected;
window.updateComposeUI = updateComposeUI;
window.getComposeOn = getComposeOn;
window.setComposeOn = setComposeOn;
window.advanceSelection = advanceSelection;