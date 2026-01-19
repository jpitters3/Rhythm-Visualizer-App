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

/* ===== PRESENTATION CONTROLS PROXY ===== */
function initPresentationControls() {
  const pControls = document.getElementById('presentationControls');
  if (!pControls) return;

  // Metronome
  const metroBtn = document.getElementById('metroBtn');
  const pMetroBtn = document.getElementById('presentMetroBtn');
  if (metroBtn && pMetroBtn) {
    pMetroBtn.addEventListener('click', () => {
      metroBtn.click();
      syncPresentationControls();
    });
  }

  // BPM
  const bpmInput = document.getElementById('bpmInput');
  const pBpmInput = document.getElementById('presentBpmInput');
  const pBpmVal = document.getElementById('presentBpmVal');
  if (bpmInput && pBpmInput) {
    pBpmInput.addEventListener('input', (e) => {
      bpmInput.value = e.target.value;
      bpmInput.dispatchEvent(new Event('input'));
      if (pBpmVal) pBpmVal.textContent = e.target.value;
    });
  }

  // Play/Stop
  const playBtn = document.getElementById('playBtn');
  const pPlayBtn = document.getElementById('presentPlayBtn');
  if (playBtn && pPlayBtn) {
    pPlayBtn.addEventListener('click', () => {
      playBtn.click();
      syncPresentationControls();
    });
  }
}

function syncPresentationControls() {
  const pControls = document.getElementById('presentationControls');
  if (!pControls || pControls.style.display === 'none') {
    // If hidden, maybe we should show it if in presentation mode
    if (document.body.classList.contains('present')) {
      pControls.style.display = 'flex';
      // Initialize values once on show
    } else {
      return;
    }
  } else if (!document.body.classList.contains('present')) {
    pControls.style.display = 'none';
    return;
  }

  // Sync Values from Real -> Proxy
  const tsNum = document.getElementById('tsNum');
  const pTsNum = document.getElementById('presentTsNum');
  if (tsNum && pTsNum && pTsNum.value !== tsNum.value) pTsNum.value = tsNum.value;

  const tsDen = document.getElementById('tsDen');
  const pTsDen = document.getElementById('presentTsDen');
  if (tsDen && pTsDen && pTsDen.value !== tsDen.value) pTsDen.value = tsDen.value;

  const metroBtn = document.getElementById('metroBtn');
  const pMetroBtn = document.getElementById('presentMetroBtn');
  if (metroBtn && pMetroBtn) {
    const isActive = metroBtn.classList.contains('active');
    pMetroBtn.classList.toggle('active', isActive);
    pMetroBtn.style.opacity = isActive ? '1' : '0.5';
  }

  const playBtn = document.getElementById('playBtn');
  const pPlayBtn = document.getElementById('presentPlayBtn');
  if (playBtn && pPlayBtn) {
    // Copy text content (Play/Stop symbol)
    pPlayBtn.textContent = playBtn.textContent;
    // Copy class (active/playing)
    const isPlaying = playBtn.classList.contains('playing') || playBtn.textContent !== '►';
    pPlayBtn.classList.toggle('playing', isPlaying);
  }

  const bpmInput = document.getElementById('bpmInput');
  const pBpmInput = document.getElementById('presentBpmInput');
  const pBpmVal = document.getElementById('presentBpmVal');
  if (bpmInput && pBpmInput && pBpmInput.value !== bpmInput.value) {
    pBpmInput.value = bpmInput.value;
    if (pBpmVal) pBpmVal.textContent = bpmInput.value;
  }
}

// Hook into the Update Loop
const originalUpdateView = window.updatePresentationView;
window.updatePresentationView = function (step) {
  // Run original
  if (originalUpdateView) originalUpdateView(step);
  // Run sync
  syncPresentationControls();
};

// Hook into Init
document.addEventListener('DOMContentLoaded', initPresentationControls);