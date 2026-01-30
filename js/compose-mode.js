const COMPOSE_KEY = 'groovepan_compose_mode';
let composeOn = (localStorage.getItem(COMPOSE_KEY) === 'on');

const composeBtn = document.getElementById('composeBtn');

function updateComposeUI() {
  if (!composeBtn) return;
  composeBtn.classList.toggle('active', composeOn);
  document.body.classList.toggle('composeOn', composeOn);

  // Lock the handpan section on mobile
  for (const lockable of [handpanSection, ghostNoteSection]) {
    lockable.classList.toggle('locked', composeOn);
  }
  scrollToPatternGrid(composeOn);
}

composeBtn?.addEventListener('click', () => {
  composeOn = !composeOn;
  localStorage.setItem(COMPOSE_KEY, composeOn ? 'on' : 'off');
  updateComposeUI();
});

function totalSteps(ctx = window.activeGrid) {
  return ctx.innerLabels.length;
}

function clampIndex(i, ctx = window.activeGrid) {
  const n = totalSteps(ctx);
  if (n <= 0) return 0;
  return (i % n + n) % n; // wrap
}

function advanceSelection(delta = 1, ctx = window.activeGrid) {
  if (ctx.caretIndex === null) return;

  const next = clampIndex(ctx.caretIndex + delta, ctx);
  if (typeof applySelection === 'function') applySelection(next, ctx);
  setCaret(next, ctx);
  if (typeof clearRange === 'function') clearRange(ctx);

  // Nice UX: keep selection visible when you have many measures
  const s = (typeof getStepCountPerMeasure === 'function') ? getStepCountPerMeasure(ctx) : 16;
  const gridCells = cells(ctx);
  let cell = gridCells[next - s]; // Scroll to one measure before the next cell
  cell = cell ? cell : gridCells[next];
  cell?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function writeToSelected(label, { advance = true } = {}, ctx = window.activeGrid) {
  if (window.HistoryManager) window.HistoryManager.pushState();
  if (ctx.caretIndex === null) return;

  if (typeof setInnerLabel === 'function') setInnerLabel(ctx.caretIndex, label, ctx);

  // If clearing a note (especially if it was multi-mode), force render to restore classes
  if (!label && typeof renderAllMeasures === 'function') {
    renderAllMeasures(ctx);
  }

  // Compose advance unless Alt is held
  if (composeOn && advance) advanceSelection(1, ctx);
}

function labelFromHandpanDot(dotNote) {
  return dotNote;
}

function scrollToPatternGrid(composeOn, ctx = window.activeGrid) {
  if (composeOn) {
    const i = ctx.caretIndex ? ctx.caretIndex : 0;
    let cell = cells(ctx)[i];
    cell?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
}