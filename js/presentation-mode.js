/* ===== PRESENTATION MODE ===== */
var lastMeasureIndex = -1;
async function enterFullscreenIfPossible() {
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen();
    }
  } catch {
    // ignore
  }
}

async function exitFullscreenIfPossible() {
  try {
    if (document.fullscreenElement && document.exitFullscreen) {
      await document.exitFullscreen();
    }
  } catch {
    // ignore
  }
}

async function setPresentation(on) {
  document.body.classList.toggle('present', on);
  localStorage.setItem(PRESENT_KEY, on ? 'on' : 'off');
  presentBtn.classList.toggle('active', on);
  presentBtn.textContent = on ? '⛶' : '⛶';
  exitPresent.style.display = on ? 'inline-flex' : 'none';

  if (on) {
    await enterFullscreenIfPossible();
    lastMeasureIndex = -1; // Reset cache
    updatePresentationView(0); // Initialize view
  } else {
    await exitFullscreenIfPossible();
  }
}


function updatePresentationView(currentStep) {
  const isPresenting = document.body.classList.contains('present');
  if (!isPresenting) return;

  // Calculate current measure index
  const stepsPerMeasure = (typeof STEPS !== 'undefined') ? STEPS : 16;
  const lookahead = Math.floor(stepsPerMeasure / 8);
  const totalMeasureCount = (typeof measures !== 'undefined') ? measures : 1;
  const totalSteps = totalMeasureCount * stepsPerMeasure;

  const visualStep = (currentStep + lookahead) % totalSteps;
  const currentMeasureIndex = Math.floor(visualStep / stepsPerMeasure);

  console.log(`[Present] updateView: step=${currentStep} idx=${currentMeasureIndex} last=${lastMeasureIndex}`);

  // OPTIMIZATION: Only update DOM if measure changed
  if (currentMeasureIndex === lastMeasureIndex) {
    console.log(`[Present] Skipped (Index match)`);
    return;
  }
  lastMeasureIndex = currentMeasureIndex;

  const measuresEl = document.getElementById('measures');
  if (!measuresEl) { console.warn('[Present] measuresEl not found!'); return; }
  const measureRows = Array.from(measuresEl.getElementsByClassName('measure-row'));
  console.log(`[Present] Found ${measureRows.length} rows`);

  measureRows.forEach((row, index) => {
    // Reset classes
    row.classList.remove('current-measure', 'next-measure', 'next-measure-2');

    if (index === currentMeasureIndex) {
      row.classList.add('current-measure');
    } else if (index === currentMeasureIndex + 1) {
      row.classList.add('next-measure');
    } else if (index === currentMeasureIndex + 2) {
      row.classList.add('next-measure-2');
    }
  });

  // Handle looping (e.g. if at end, show start as next?)
  // User didn't strictly request looping visual, but it's nice.
  // For now, simple linear view.

  updateStaticHeader(stepsPerMeasure);
}

function updateStaticHeader(cols) {
  const container = document.getElementById('static-measure-labels');
  if (!container) return;

  // Only update if needed (length changed) or empty
  if (container.children.length === cols) return;

  container.innerHTML = '';
  container.style.display = 'grid'; // Ensure it's active
  container.style.setProperty('--cols', String(cols));

  for (let i = 0; i < cols; i++) {
    const el = document.createElement('div');
    if (typeof labelForStep === 'function') {
      el.textContent = labelForStep(i);
    } else {
      // Fallback if notegrid.js not loaded? (Unlikely)
      el.textContent = (i % 2 === 0) ? (Math.floor(i / 4) + 1) : '';
    }
    container.appendChild(el);
  }
}

function resetPresentationView() {
  lastMeasureIndex = -1;
  console.log('[Present] Cache reset via resetPresentationView');
}

// Make it global
window.updatePresentationView = updatePresentationView;
window.setPresentation = setPresentation;
window.resetPresentationView = resetPresentationView;

// Initialize Presentation Mode
document.addEventListener('DOMContentLoaded', () => {
  if (localStorage.getItem(PRESENT_KEY) === 'on') {
    // Restore UI state immediately
    document.body.classList.add('present');
    const btn = document.getElementById('presentBtn');
    if (btn) btn.classList.add('active');
    const exit = document.getElementById('exitPresent');
    if (exit) exit.style.display = 'inline-flex';

    // Force initial render (even if empty pattern, it sets up structure)
    updatePresentationView(0);
  }
});

// Detect externally triggered Fullscreen exit (e.g. Esc key by user)
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && document.body.classList.contains('present')) {
    // User exited fullscreen (e.g. via Esc), so we switch off presentation layout
    setPresentation(false);
  }
});