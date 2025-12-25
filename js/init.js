// ===== INIT =====
function restorePrefs() {
  if (localStorage.getItem('theme') === 'dark') {
    document.body.classList.add('dark');
  }

const handOn = localStorage.getItem('handSplit') === 'on';
document.body.classList.toggle('handSplit', handOn);
handBtn.classList.toggle('active', handOn);
handBtn.textContent = handOn ? 'Left/Right: On' : 'Left/Right: Off';

metronomeOn = (localStorage.getItem(METRO_KEY) === 'on');
updateMetroUI();

bpmVal.textContent = bpmInput.value;

handpanSoundsOn = (localStorage.getItem(HP_KEY) === 'on');
updateHandpanUI();


  if (localStorage.getItem(PRESENT_KEY) === 'on') {
    document.body.classList.add('present');
    presentBtn.classList.add('active');
    presentBtn.textContent = 'Exit Presentation';
    exitPresent.style.display = 'inline-flex';
  } else {
    exitPresent.style.display = 'none';
  }
}

function runSelfTests() {
  // Existing smoke tests (kept)
  console.assert(document.getElementById('grid') && document.getElementById('labels'), 'Grid/labels elements exist');
  console.assert(cells().length === STEPS, `Expected ${STEPS} cells after buildGrid()`);
  console.assert(labels.children.length === STEPS, `Expected ${STEPS} labels after buildGrid()`);

  // Added: each cell should have a hand side class
  cells().forEach((c) => {
    console.assert(c.classList.contains('hand-l') || c.classList.contains('hand-r'), 'Cell has hand-l/hand-r');
  });

  console.assert(!!metroBtn, 'Metronome button exists');
  console.assert(typeof metroClick === 'function', 'metroClick is a function');

  console.assert(!!presentBtn && !!exitPresent, 'Presentation buttons exist');

  // Added: Hand icons should be defined as mask-images in split mode CSS
  console.assert(getComputedStyle(document.documentElement).getPropertyValue('--hand-icon') !== '', 'Hand icon color var exists');

  // Added: Mode toggle should rebuild correct counts
  const before = STEPS;
  setMode(mode === '8' ? '16' : '8');
  console.assert(STEPS !== before, 'Mode toggle changes step count');
  console.assert(cells().length === STEPS, 'Grid rebuilt to new step count');
  console.assert(labels.children.length === STEPS, 'Labels rebuilt to new step count');
  // revert
  setMode(mode === '8' ? '16' : '8');
  console.assert(cells().length === STEPS, 'Grid rebuilt back');
}

function showFatalError(err) {
  // Ensure we stop any running timers if an error happens during startup
  try { stop(); } catch {}

  console.error(err);
  // Avoid duplicate panels
  if (document.getElementById('__fatal_panel__')) return;
  console.error(err);
  const panel = document.createElement('div');
  panel.id = '__fatal_panel__';
  panel.style.position = 'fixed';
  panel.style.inset = '16px';
  panel.style.zIndex = '9999';
  panel.style.background = 'rgba(0,0,0,0.85)';
  panel.style.color = 'white';
  panel.style.padding = '16px';
  panel.style.borderRadius = '16px';
  panel.style.overflow = 'auto';
  panel.innerHTML = `
    <div style="font-weight:700; font-size:16px; margin-bottom:8px;">App failed to start</div>
    <div style="opacity:.85; margin-bottom:12px;">This prevents the tab from "half-freezing" when there’s a runtime error.</div>
    <pre style="white-space:pre-wrap; line-height:1.35;">${String(err?.stack || err)}</pre>
    <button id="panicStop" style="margin-top:12px; padding:10px 14px; border-radius:999px; border:0; cursor:pointer;">Panic Stop</button>
  `;
  document.body.appendChild(panel);
  panel.querySelector('#panicStop')?.addEventListener('click', () => {
    try { stop(); } catch {}
  });
}

// Global error handlers (helps when a bad edit slips in)
window.addEventListener('error', (e) => {
  // Avoid duplicate panels
  if (document.getElementById('__fatal_panel__')) return;
  showFatalError(e.error || e.message || e);
});

window.addEventListener('unhandledrejection', (e) => {
  if (document.getElementById('__fatal_panel__')) return;
  showFatalError(e.reason || e);
});

// ===== INIT (non-blocking) =====
// Why: if there’s a runtime error or accidental heavy work, Chrome can show “Page Unresponsive” on reload.
// Strategy: render once, then initialize on the next frame, and run self-tests only in debug mode.

const DEBUG = new URLSearchParams(location.search).has('debug');

function safeInit() {
  try {
    restorePrefs();
    buildGrid();
    refreshPatternSelect();
    updatePatternButtons();

    if (DEBUG) runSelfTests();
  } catch (err) {
    showFatalError(err);
  }
}

// Let the browser paint UI first, then init.
requestAnimationFrame(() => {
  // Yield one more tick to keep startup smooth on slower machines.
  setTimeout(safeInit, 0);
});