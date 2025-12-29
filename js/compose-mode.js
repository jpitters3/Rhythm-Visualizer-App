const COMPOSE_KEY = 'groovepan_compose_mode';
let composeOn = (localStorage.getItem(COMPOSE_KEY) === 'on');

const composeBtn = document.getElementById('composeBtn');

function updateComposeUI(){
  if (!composeBtn) return;
  composeBtn.classList.toggle('active', composeOn);
  composeBtn.textContent = composeOn ? 'Compose: On' : 'Compose: Off';
  document.body.classList.toggle('composeOn', composeOn);
}

composeBtn?.addEventListener('click', () => {
  composeOn = !composeOn;
  localStorage.setItem(COMPOSE_KEY, composeOn ? 'on' : 'off');
  updateComposeUI();
});
updateComposeUI();

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
  const cell = cells()[next];
  cell?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
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