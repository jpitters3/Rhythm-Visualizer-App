/* ===== PRESENTATION MODE ===== */
import { gridA, activeGrid } from './grid-context.js';
import { labelForStep } from './notegrid.js';
import { addTickObserver } from './noteplayer.js';
import { TransportRegistry } from './transport-ui.js';
import { Bus, BUS_EVENT } from './bus.js';

export const PRESENT_KEY = 'groovepan_presentation_mode';
export const PRESENT_MODE_KEY = 'groovepan_presentation_mode_view';

let lastMeasureIndex = -1;

let presentBtn, exitPresent;

// View State
let presentationViewMode = 'stream'; // 'measure' | 'stream'

export function setPresentationMode(mode) {
  if (['measure', 'stream'].includes(mode)) {
    presentationViewMode = mode;
    localStorage.setItem(PRESENT_MODE_KEY, mode);

    // Refresh view if active
    if (document.body.classList.contains('present')) {
      // Toggle Classes on Body for CSS styling
      document.body.classList.toggle('mode-stream', mode === 'stream');
      document.body.classList.toggle('mode-measure', mode === 'measure');

      lastMeasureIndex = -1; // Force full re-render
      // We need to access gridA, so we import it (already imported)
      // updating view will happen on next tick or manually?
      // better to pass gridA if we can, but we are inside module scope.
      // imported gridA is live binding.
      if (typeof gridA !== 'undefined') {
        updatePresentationView(gridA.step, gridA);
      }
    }
  }
}

export function getPresentationMode() {
  return presentationViewMode;
}


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

let animationFrameId;

function animatePresentation() {
  if (!document.body.classList.contains('present')) return;

  if (presentationViewMode === 'stream') {
    const streamContainer = document.getElementById('stream-view');
    if (streamContainer && gridA.playing && gridA.lastTickTime) {
      const now = performance.now();
      const timeSinceTick = now - gridA.lastTickTime;

      // Calculate step duration based on BPM and grid mode
      // 16th mode = 4 steps per beat. 8th mode = 2 steps per beat.
      const stepsPerBeat = (gridA.mode === '8') ? 2 : 4;
      const beatDuration = 60000 / gridA.bpm;
      const stepDuration = beatDuration / stepsPerBeat;

      const fraction = Math.min(1, Math.max(0, timeSinceTick / stepDuration));

      // Handle wrap-around logic for smooth display
      // If step is 0, we are transitioning from length-1 to 0.
      // We want to display (length-1) + fraction.
      let baseStep = gridA.step - 1;
      if (baseStep < 0) baseStep = gridA.cells.length - 1;

      // Special case: if we just wrapped to 0, gridA.step is 0.
      // visual position should go from (length-1) -> (length).
      // But our CSS transform uses --current-step.
      // If --current-step jumps from 15.9 to 0, track jumps RIGHT.
      // We need the visual to stay at 15.9... then 16.0... 
      // But the track only has 16 cells (0-15).
      // Ideally we render 2 copies of the track for infinite scroll.
      // For now, let's accept the jump at 0 or clamp it?
      // The user said "Highway", implying continuous.
      // If we don't duplicate, we loop.
      // Let's just use the calculated smooth step for now.
      // If baseStep is length-1, we show (length-1) + fraction.

      const smoothStep = baseStep + fraction;
      streamContainer.style.setProperty('--current-step', smoothStep);
    }
  }

  animationFrameId = requestAnimationFrame(animatePresentation);
}

export async function setPresentation(on) {
  document.body.classList.toggle('present', on);
  // Get the default mode view from local storage
  const defaultMode = localStorage.getItem(PRESENT_MODE_KEY || 'measure');
  setPresentationMode(defaultMode);
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
    animatePresentation(); // Start Loop
  } else {
    await exitFullscreenIfPossible();
    const pControls = document.getElementById('presentationControls');
    if (pControls) pControls.style.display = 'none';
    cancelAnimationFrame(animationFrameId);

    // cleanup view
    const streamContainer = document.getElementById('stream-view');
    if (streamContainer) streamContainer.style.display = 'none';

    const measuresEl = document.getElementById('measures');
    if (measuresEl) measuresEl.style.display = 'block';

    document.body.classList.remove('mode-stream', 'mode-measure');
  }
}


function updatePresentationView(currentStep, ctx = gridA) {
  if (ctx.id !== 'A') return;
  if (!document.body.classList.contains('present')) return;

  if (presentationViewMode === 'stream') {
    updateStreamView(currentStep, ctx);
  } else {
    updateMeasureView(currentStep, ctx);
  }
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

  // Mode Selector
  const modeSelect = document.getElementById('presentModeSelect');
  if (modeSelect) {
    // Set initial value
    modeSelect.value = localStorage.getItem(PRESENT_MODE_KEY) || 'measure';

    modeSelect.addEventListener('change', (e) => {
      setPresentationMode(e.target.value);
    });
  }

  if (localStorage.getItem(PRESENT_KEY) === 'on') {
    // Restore UI state immediately
    document.body.classList.add('present');
    const btn = document.getElementById('presentBtn');
    if (btn) btn.classList.add('active');
    const exit = document.getElementById('exitPresent');
    if (exit) exit.style.display = 'inline-flex';

    // Force initial render
    document.body.classList.toggle('mode-stream', presentationViewMode === 'stream');
    document.body.classList.toggle('mode-measure', presentationViewMode === 'measure');
    updatePresentationView(0, gridA);
    animatePresentation();
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

// === MEASURE VIEW (Classic Page Turn) === //
function updateMeasureView(currentStep, ctx) {
  // Calculate current measure index
  const stepsPerMeasure = ctx.stepsPerMeasure;
  const lookahead = Math.floor(stepsPerMeasure / 8); // Small lookahead for page turn
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

  // Hide Stream View if likely present
  const streamEl = document.getElementById('stream-view');
  if (streamEl) streamEl.style.display = 'none';
  measuresEl.style.display = 'block';

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

// === STREAM VIEW (Highway) === //
function updateStreamView(currentStep, ctx) {
  const measuresEl = document.getElementById('measures');
  if (measuresEl) measuresEl.style.display = 'none';

  let streamContainer = document.getElementById('stream-view');
  if (!streamContainer) {
    // Create Stream DOM Structure if missing
    streamContainer = document.createElement('div');
    streamContainer.id = 'stream-view';
    streamContainer.className = 'stream-view';

    // The "Now" Line
    const nowLine = document.createElement('div');
    nowLine.className = 'stream-now-line';
    streamContainer.appendChild(nowLine);

    // The Moving Track
    const track = document.createElement('div');
    track.className = 'stream-track';
    streamContainer.appendChild(track);

    document.body.appendChild(streamContainer);
  }
  streamContainer.style.display = 'block';

  // Render Track Content (Only if cache invalid or empty)
  const track = streamContainer.querySelector('.stream-track');

  // Simple check: if track is empty or grid changed (we can use lastMeasureIndex as a dirty flag relative to ID)
  // For now, let's just use a simple heuristic or checking children. 
  // Ideally we listen to GRID_RENDERED to rebuild the track.
  if (lastMeasureIndex === -1 && track) {
    renderStreamTrack(track, ctx);
    lastMeasureIndex = 0; // Mark as rendered
  }

  // Update Position
  // We need to calculate the offset based on currentStep + micro-timing (offset)
  // For smoothness, we might want to use the high-res time from NotePlayer if available, 
  // but for now, step-based + CSS transition is a good start.

  const stepWidth = 100; // px per step (defined in CSS)
  const offset = currentStep * stepWidth; // Move track Left

  // Center alignment: Screen Center - Offset
  // Actually, we want the "Current Step" to be at the "Now Line" (Center of screen)
  // So Track Transform = translateX(50vw - (currentStep * stepWidth) - (stepWidth/2))

  // But wait, "Step 0" should be at the line.
  // We can do this via CSS var
  streamContainer.style.setProperty('--current-step', currentStep);
}

function renderStreamTrack(track, ctx) {
  track.innerHTML = '';
  // Clone cells from the main grid? Or rebuild?
  // Rebuilding is safer to strip event listeners and extra classes.

  const totalSteps = ctx.cells.length;

  // Label Row
  // track.appendChild(...)

  ctx.cells.forEach((originalCell, i) => {
    const clone = originalCell.cloneNode(true);
    // Strip IDs to avoid duplicates
    clone.id = '';
    // Remove selection/interaction classes
    clone.classList.remove('selected', 'caret', 'active');

    // Ensure accurate sizing
    clone.style.width = 'var(--stream-cell-width)';

    // Add Measure Markers
    if (i % ctx.stepsPerMeasure === 0) {
      clone.classList.add('measure-start');
      const num = (i / ctx.stepsPerMeasure) + 1;
      clone.setAttribute('data-measure-num', num);
    }

    track.appendChild(clone);
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