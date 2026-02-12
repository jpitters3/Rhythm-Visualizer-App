/* ===== PRESENTATION MODE ===== */
import { gridA, activeGrid } from './grid-context.js';
import { labelForStep } from './notegrid.js';
import { addTickObserver } from './noteplayer.js';
import { TransportRegistry } from './transport-ui.js';
import { Bus, BUS_EVENT } from './bus.js';

export const PRESENT_KEY = 'groovepan_presentation_mode';

let lastMeasureIndex = -1;

let presentBtn, exitPresent;


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

export async function setPresentation(on) {
  document.body.classList.toggle('present', on);
  localStorage.setItem(PRESENT_KEY, on ? 'on' : 'off');

  if (presentBtn) {
    presentBtn.classList.toggle('active', on);
    presentBtn.textContent = on ? '⛶' : '⛶';
  }

  if (exitPresent) {
    exitPresent.style.display = on ? 'inline-flex' : 'none';
  }

  if (on) {
    await enterFullscreenIfPossible();
    lastMeasureIndex = -1; // Reset cache
    updatePresentationView(0, gridA); // Initialize view
    updatePresentationControlsVisibility(gridA);
  } else {
    await exitFullscreenIfPossible();
    const pControls = document.getElementById('presentationControls');
    if (pControls) pControls.style.display = 'none';
  }
}


function updatePresentationView(currentStep, ctx = gridA) {
  // Only sync presentation view with Grid A
  if (ctx.id !== 'A') return;

  const isPresenting = document.body.classList.contains('present');
  if (!isPresenting) return;

  // Calculate current measure index
  const stepsPerMeasure = ctx.stepsPerMeasure;
  const lookahead = Math.floor(stepsPerMeasure / 8);
  const totalMeasureCount = ctx ? ctx.measures : 1;
  const totalSteps = totalMeasureCount * stepsPerMeasure;

  const visualStep = (currentStep + lookahead) % totalSteps;
  const currentMeasureIndex = Math.floor(visualStep / stepsPerMeasure);

  // OPTIMIZATION: Only update DOM if measure changed
  if (currentMeasureIndex === lastMeasureIndex) {
    return;
  }
  lastMeasureIndex = currentMeasureIndex;

  const measuresEl = document.getElementById('measures');
  if (!measuresEl) { return; }
  const measureRows = Array.from(measuresEl.getElementsByClassName('measure-row'));

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

  updateStaticHeader(stepsPerMeasure, ctx);
}

function updateStaticHeader(cols, ctx = gridA) {
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
      el.textContent = (i % 2 === 0) ? (Math.floor(i / 4) + 1) : '';
    }
    container.appendChild(el);
  }
}

export function resetPresentationView() {
  lastMeasureIndex = -1;
}

// Initialize Presentation Mode
export function initPresentation() {
  presentBtn = document.getElementById('presentBtn');
  exitPresent = document.getElementById('exitPresent');

  if (localStorage.getItem(PRESENT_KEY) === 'on') {
    // Restore UI state immediately
    document.body.classList.add('present');
    const btn = document.getElementById('presentBtn');
    if (btn) btn.classList.add('active');
    const exit = document.getElementById('exitPresent');
    if (exit) exit.style.display = 'inline-flex';

    // Force initial render (even if empty pattern, it sets up structure)
    // We can assume gridA is available since we import it
    updatePresentationView(0, gridA);
  }

  // Subscribe to Tick to sync View
  addTickObserver((ctx, notes, hands) => {
    // Current step in ctx is updated at end of tick, or beginning? 
    // noteplayer.js: "c.step++" happens at end of tick.
    // Observer is called with "c, activeNotes, activeHands".
    // We should use c.step.
    if (ctx && ctx.id === 'A') {
      const step = ctx.step;
      updatePresentationView(step, ctx);
    }
  });

  // Detect externally triggered Fullscreen exit (e.g. Esc key by user)
  document.addEventListener('fullscreenchange', handleFullscreenChange);
  document.addEventListener('mozfullscreenchange', handleFullscreenChange);
  document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

  // Re-sync view when grid is rebuilt (e.g. by Coach Mode or Load)
  Bus.on(BUS_EVENT.GRID_RENDERED, (e) => {
    if (document.body.classList.contains('present')) {
      lastMeasureIndex = -1; // Force update
      const gridId = e.detail?.gridId || 'A';
      if (gridId === 'A') {
        updatePresentationView(gridA.step, gridA);
      }
    }
  });
}

// Detect externally triggered Fullscreen exit (e.g. Esc key by user)
const handleFullscreenChange = () => {
  if (!document.fullscreenElement && document.body.classList.contains('present')) {
    setPresentation(false);
  }
};

/* ===== PRESENTATION CONTROLS ===== */
function updatePresentationControlsVisibility(ctx = gridA) {
  const pControls = document.getElementById('presentationControls');
  if (!pControls) return;

  if (document.body.classList.contains('present')) {
    pControls.style.display = 'flex';
    if (TransportRegistry) TransportRegistry.updateAll(ctx);
  } else {
    pControls.style.display = 'none';
  }
}