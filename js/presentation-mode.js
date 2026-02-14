/* ===== PRESENTATION MODE ===== */
import { gridA, activeGrid } from './grid-context.js';
import { labelForStep } from './notegrid.js';
import { addTickObserver, getPlaybackPosition } from './noteplayer.js';
import { TransportRegistry } from './transport-ui.js';
import { Bus, BUS_EVENT } from './bus.js';

export const PRESENT_KEY = 'groovepan_presentation_mode';
export const PRESENT_MODE_KEY = 'groovepan_presentation_mode_view';

let lastMeasureIndex = -1;

let presentBtn, exitPresent;

// View State
let presentationViewMode = 'stream'; // 'measure' | 'stream'
let streamCanvas = null;
let streamCtx = null;

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
    ensureStreamCanvasReady();
    handleStreamResize();
    drawHighway(gridA);
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

  // Subscribe to Tick to sync View (ONLY for Measure Mode)
  addTickObserver((ctx, notes, hands) => {
    if (ctx && ctx.id === 'A') {
      // Highway (Stream Mode) runs on its own high-frequency rAF loop.
      // We only use the rhythmic tick for the static Measure Mode.
      if (presentationViewMode === 'measure') {
        const step = ctx.step;
        updatePresentationView(step, ctx);
      }
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
function ensureStreamCanvasReady() {
  const measuresEl = document.getElementById('measures');
  if (measuresEl) measuresEl.style.display = 'none';

  let streamContainer = document.getElementById('stream-view');
  if (!streamContainer) {
    streamContainer = document.createElement('div');
    streamContainer.id = 'stream-view';
    streamContainer.className = 'stream-view';
    document.body.appendChild(streamContainer);
  }
  streamContainer.style.display = 'block';

  if (!streamCanvas) {
    streamCanvas = document.createElement('canvas');
    streamCanvas.id = 'stream-canvas';
    streamContainer.appendChild(streamCanvas);
    streamCtx = streamCanvas.getContext('2d');
  }
}

function handleStreamResize() {
  if (!streamCanvas) return;
  const streamContainer = document.getElementById('stream-view');
  if (!streamContainer) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = streamContainer.getBoundingClientRect();

  // Only resize/reset if dimensions actually changed
  if (streamCanvas.width !== rect.width * dpr || streamCanvas.height !== rect.height * dpr) {
    streamCanvas.width = rect.width * dpr;
    streamCanvas.height = rect.height * dpr;
    streamCanvas.style.width = `${rect.width}px`;
    streamCanvas.style.height = `${rect.height}px`;
    streamCtx.scale(dpr, dpr);
  }
}

function updateStreamView(currentStep, ctx) {
  ensureStreamCanvasReady();
  handleStreamResize();
}

function drawHighway(ctx) {
  if (!streamCtx || !streamCanvas) return;

  const dpr = window.devicePixelRatio || 1;
  const w = streamCanvas.width / dpr;
  const h = streamCanvas.height / dpr;
  const pos = getPlaybackPosition(ctx);

  const stepWidth = 120; // Matches CSS var --stream-cell-width
  const centerY = h / 2;
  const centerX = w / 2;

  const totalSteps = ctx.cells.length;

  streamCtx.save();
  streamCtx.clearRect(0, 0, w, h);

  // 1. Horizontal track line
  streamCtx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  streamCtx.lineWidth = 1;
  streamCtx.beginPath();
  streamCtx.moveTo(0, centerY);
  streamCtx.lineTo(w, centerY);
  streamCtx.stroke();

  // Theme Detection (pull once)
  const isDark = document.body.classList.contains('dark');
  const handRCol = isDark ? '#fd0380' : '#610a42'; // Right/Ding
  const handLCol = isDark ? 'rgb(30, 121, 232)' : 'rgb(2, 68, 150)'; // Left/Tak
  const cellBgCol = isDark ? '#222233' : '#ffffff';

  // 4. Draw Components (Sliding Window for Seamless Looping)
  const currentTotalStep = pos.step + pos.fraction;

  // Calculate window of visible steps
  const stepsOnScreen = Math.ceil(w / stepWidth);
  const firstVisibleStep = Math.floor(currentTotalStep - (centerX / stepWidth)) - 1;
  const lastVisibleStep = firstVisibleStep + stepsOnScreen + 2;

  for (let j = firstVisibleStep; j <= lastVisibleStep; j++) {
    if (j < 0) continue; // Don't draw before pattern start
    const i = j % totalSteps;
    const x = centerX + (j * stepWidth) - (currentTotalStep * stepWidth);

    const cell = ctx.cells[i];
    const isMeasureStart = (i % ctx.stepsPerMeasure === 0);

    // 4a. Lines (Measure/Step)
    streamCtx.beginPath();
    if (isMeasureStart) {
      streamCtx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      streamCtx.lineWidth = 2;
      streamCtx.moveTo(x, centerY - 100);
      streamCtx.lineTo(x, centerY + 100);
      streamCtx.stroke();

      streamCtx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      streamCtx.font = '24px Inter, system-ui';
      streamCtx.textAlign = 'left';
      streamCtx.fillText(`${(i / ctx.stepsPerMeasure) + 1}`, x + 10, centerY - 110);
    } else {
      streamCtx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      streamCtx.lineWidth = 1;
      streamCtx.moveTo(x, centerY - 40);
      streamCtx.lineTo(x, centerY + 40);
      streamCtx.stroke();
    }

    // 4b. Draw Note Cell
    const rawLabel = ctx.innerLabels[i];
    const hand = (ctx.innerHands && ctx.innerHands[i]) ? ctx.innerHands[i] : (i % 2 === 0 ? 'R' : 'L');
    const baseCol = hand === 'L' ? handLCol : handRCol;

    const isVisualDing = cell.classList.contains('visual-ding');

    // BUTTERY EASING: Pulse note as it passes center
    // stepProgress is 0 at hit, 1.0 one full beat later
    const stepProgress = currentTotalStep - j;
    let scale = 1.0;
    if (stepProgress >= 0 && stepProgress < 1.0) {
      const ease = Math.pow(1.0 - stepProgress, 3); // Cubic ease out
      scale = 1.0 + (ease * 0.35);
    } else if (isVisualDing) {
      scale = 1.35; // Snappy highlight for user hits
    }

    const radius = 42 * scale;

    // 4c. Background Circle
    streamCtx.beginPath();
    streamCtx.arc(x, centerY, radius, 0, Math.PI * 2);
    streamCtx.fillStyle = cellBgCol;
    streamCtx.fill();

    if (rawLabel) {
      // 4d. Labelled Note
      const displayLabel = Array.isArray(rawLabel) ? rawLabel.join('') : String(rawLabel);
      streamCtx.globalAlpha = 0.68;
      streamCtx.fillStyle = baseCol;
      streamCtx.fill();
      streamCtx.globalAlpha = 1.0;

      // Coaching Highlights
      if (cell.classList.contains('coach-correct')) {
        highlightCell(x, centerY, radius, '#2ecc71', true);
      } else if (cell.classList.contains('coach-timing')) {
        highlightCell(x, centerY, radius, '#f1c40f', false);
      } else if (cell.classList.contains('coach-wrong')) {
        highlightCell(x, centerY, radius, '#e74c3c', false);
      } else if (cell.classList.contains('coach-missed')) {
        streamCtx.globalAlpha = 0.3;
        streamCtx.setLineDash([5, 5]);
        streamCtx.strokeStyle = '#e74c3c';
        streamCtx.lineWidth = 3;
        streamCtx.stroke();
        streamCtx.setLineDash([]);
        streamCtx.globalAlpha = 1.0;
      }

      // 4e. Note Text
      streamCtx.fillStyle = '#ffffff';
      streamCtx.font = `bold ${Math.floor(40 * scale)}px Inter, system-ui`;
      streamCtx.textAlign = 'center';
      streamCtx.textBaseline = 'middle';
      streamCtx.fillText(displayLabel, x, centerY + 2);
    } else {
      // 4f. Ghost Note Dot
      streamCtx.beginPath();
      streamCtx.arc(x, centerY, 6 * scale, 0, Math.PI * 2);
      streamCtx.fillStyle = baseCol;
      streamCtx.globalAlpha = 0.75;
      streamCtx.fill();
      streamCtx.globalAlpha = 1.0;
    }
  }

  // 5. "Now" Line
  const nowGlow = 15 + Math.pow(1.0 - pos.fraction, 2) * 20; // Pulsing glow
  streamCtx.strokeStyle = 'rgba(255, 237, 0, 0.9)';
  streamCtx.lineWidth = 4;
  streamCtx.shadowBlur = nowGlow;
  streamCtx.shadowColor = 'rgba(255, 237, 0, 0.6)';
  streamCtx.beginPath();
  streamCtx.moveTo(centerX, 0);
  streamCtx.lineTo(centerX, h);
  streamCtx.stroke();

  streamCtx.restore();
}

function highlightCell(x, y, r, color, glow) {
  streamCtx.save();
  if (glow) {
    streamCtx.shadowBlur = 15;
    streamCtx.shadowColor = color;
  }
  streamCtx.strokeStyle = color;
  streamCtx.lineWidth = 3;
  streamCtx.beginPath();
  streamCtx.arc(x, y, r, 0, Math.PI * 2);
  streamCtx.stroke();
  streamCtx.restore();
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