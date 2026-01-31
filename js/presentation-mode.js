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
    updatePresentationView(0, window.gridA); // Initialize view
  } else {
    await exitFullscreenIfPossible();
    const pControls = document.getElementById('presentationControls');
    if (pControls) pControls.style.display = 'none';
  }
}


function updatePresentationView(currentStep, ctx = window.gridA) {
  // Only sync presentation view with Grid A
  if (ctx.id !== 'A') return;

  const isPresenting = document.body.classList.contains('present');
  if (!isPresenting) return;

  // Calculate current measure index
  const stepsPerMeasure = (typeof getStepCountPerMeasure === 'function')
    ? getStepCountPerMeasure(ctx)
    : ((ctx && ctx.mode === '8') ? 8 : 16);
  const lookahead = Math.floor(stepsPerMeasure / 8);
  const totalMeasureCount = ctx ? ctx.measures : 1;
  const totalSteps = totalMeasureCount * stepsPerMeasure;

  const visualStep = (currentStep + lookahead) % totalSteps;
  const currentMeasureIndex = Math.floor(visualStep / stepsPerMeasure);

  //console.log(`[Present] updateView: step=${currentStep} idx=${currentMeasureIndex} last=${lastMeasureIndex}`);

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

  updateStaticHeader(stepsPerMeasure, ctx);
}

function updateStaticHeader(cols, ctx = window.gridA) {
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
      el.textContent = labelForStep(i, ctx);
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
    // User exited fullscreen, switch off
    setPresentation(false);
  }
});

document.addEventListener('mozfullscreenchange', () => {
  if (!document.fullscreenElement && document.body.classList.contains('present')) {
    setPresentation(false);
  }
});

document.addEventListener('webkitfullscreenchange', () => {
  if (!document.fullscreenElement && document.body.classList.contains('present')) {
    setPresentation(false);
  }
});

/* ===== PRESENTATION CONTROLS ===== */
function updatePresentationControlsVisibility(ctx = window.gridA) {
  const pControls = document.getElementById('presentationControls');
  if (!pControls) return;

  if (document.body.classList.contains('present')) {
    pControls.style.display = 'flex';
    // Registry update is handled by the playback loop, 
    // but we can trigger it here to ensure it's fresh on show.
    if (window.TransportRegistry) window.TransportRegistry.updateAll(ctx);
  } else {
    pControls.style.display = 'none';
  }
}

// Hook into the Update Loop
const originalUpdateView = window.updatePresentationView;
window.updatePresentationView = function (step, ctx) {
  if (originalUpdateView) originalUpdateView(step, ctx);
  updatePresentationControlsVisibility(ctx);
};