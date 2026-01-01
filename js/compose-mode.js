const COMPOSE_KEY = 'groovepan_compose_mode';
let composeOn = (localStorage.getItem(COMPOSE_KEY) === 'on');

const composeBtn = document.getElementById('composeBtn');

function updateComposeUI(){
  if (!composeBtn) return;
  composeBtn.classList.toggle('active', composeOn);
  composeBtn.textContent = composeOn ? 'Compose: On' : 'Compose: Off';
  document.body.classList.toggle('composeOn', composeOn);

  // Lock the handpan section on mobile
  for (const lockable of [handpanSection, ghostNoteSection]) {
      lockable.classList.toggle('locked', composeOn);
  }
}

composeBtn?.addEventListener('click', () => {
  composeOn = !composeOn;
  localStorage.setItem(COMPOSE_KEY, composeOn ? 'on' : 'off');
  updateComposeUI();
});

function totalSteps(){
  return measures * STEPS;
}

function clampIndex(i){
  const n = totalSteps();
  if (n <= 0) return 0;
  return (i % n + n) % n; // wrap
}

function advanceSelection(delta = 1){
  if (selectedIndex === null) return;

  const next = clampIndex(selectedIndex + delta);
  applySelection(next);

  // Nice UX: keep selection visible when you have many measures
  let cell = cells()[next-STEPS]; // Scroll to one measure before the next cell
  cell = cell ? cell : cells()[next]; // If we're on the first measure, scroll to the next cell
  cell?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function writeToSelected(label, { advance = true } = {}){
  if (selectedIndex === null) return;

  setInnerLabel(selectedIndex, label);

  // Compose advance unless Alt is held
  if (composeOn && advance) advanceSelection(1);
}

function labelFromHandpanDot(dotNote){
  // dotNote will be 'D', '1'...'8', (and later 'T','S')

  return dotNote;
}

function scrollToPatternGrid()
{
  const composeOn = (localStorage.getItem(COMPOSE_KEY) === 'on');
    if (composeOn) {
      let cell = cells()[0];
      cell?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
}