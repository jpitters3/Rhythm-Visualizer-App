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
let presentationViewMode = localStorage.getItem(PRESENT_MODE_KEY) || 'measure'; // Default to measure for consistency
let streamCanvas = null;
let streamCtx = null;

// Dashboard State & Aesthetics
let isDashboardOpen = false;
let isMicLoading = false;
export const Aesthetics = {
  sparks: true,
  trails: true,
  glow: true
};

const sparks = []; // { x, y, vx, vy, alpha, color }

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
    updateSparks();
    drawHighway(gridA);
  }

  animationFrameId = requestAnimationFrame(animatePresentation);
}

function updateSparks() {
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.x += s.vx;
    s.y += s.vy;
    s.alpha *= 0.92;
    if (s.alpha < 0.01) sparks.splice(i, 1);
  }
}

function createBurst(x, y, color) {
  if (!Aesthetics.sparks) return;
  for (let i = 0; i < 12; i++) {
    sparks.push({
      x, y,
      vx: (Math.random() - 0.5) * 12,
      vy: (Math.random() - 0.5) * 12,
      alpha: 1.0,
      color
    });
  }
}

export async function setPresentation(on) {
  document.body.classList.toggle('present', on);
  // Get the default mode view from local storage
  const defaultMode = localStorage.getItem(PRESENT_MODE_KEY) || 'measure';
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
    // Sync dashboard selectors if open
    if (isDashboardOpen) syncDashboardSelectors();
  });

  initDashboard();
}

/**
 * Immersive Dashboard Logic
 */
function initDashboard() {
  const dashBtn = document.getElementById('dashboardBtn');
  const closeBtn = document.getElementById('closeDashboardBtn');
  const dashOverlay = document.getElementById('presentationDashboard');

  if (!dashBtn || !dashOverlay) return;

  const toggleDash = (on) => {
    isDashboardOpen = on;
    dashOverlay.style.display = on ? 'flex' : 'none';
    if (on) syncDashboardSelectors();
  };

  dashBtn.onclick = (e) => { e.stopPropagation(); toggleDash(true); };
  closeBtn.onclick = (e) => { e.stopPropagation(); toggleDash(false); };
  dashOverlay.onclick = (e) => { if (e.target === dashOverlay) toggleDash(false); };

  // 1. Mic & Coach Toggles (Fire-and-forget triggers)
  const dashMicBtn = document.getElementById('dashMicBtn');
  const dashCoachBtn = document.getElementById('dashCoachBtn');

  const updateToggleUI = () => {
    const micActive = document.getElementById('micBtn')?.classList.contains('active');
    const coachActive = document.getElementById('coachingHUD')?.style.display === 'block';

    if (micActive) isMicLoading = false;

    if (dashMicBtn) {
      dashMicBtn.classList.toggle('active', micActive);
      dashMicBtn.classList.toggle('loading', isMicLoading);

      if (isMicLoading) {
        dashMicBtn.textContent = '🎤 Waiting...';
      } else {
        dashMicBtn.textContent = micActive ? '🎤 Listening: On' : '🎤 Listening: Off';
      }
    }
    if (dashCoachBtn) {
      dashCoachBtn.classList.toggle('active', coachActive);
      dashCoachBtn.textContent = coachActive ? '🎓 Coach: On' : '🎓 Coach: Off';
    }
  };

  if (dashMicBtn) {
    dashMicBtn.onclick = () => {
      const micActive = document.getElementById('micBtn')?.classList.contains('active');
      if (!micActive) isMicLoading = true;
      document.getElementById('micBtn')?.click();
      updateToggleUI();
    };
  }

  if (dashCoachBtn) {
    dashCoachBtn.onclick = () => {
      document.getElementById('coachModeBtn')?.click();
      // Small delay to let classes settle
      // setTimeout(updateToggleUI, 100);
      updateToggleUI();
    };
  }

  // 2. Pattern & Scale Synchronization
  const dashPSelect = document.getElementById('dashPatternSelect');
  const dashSSelect = document.getElementById('dashScaleSelect');

  if (dashPSelect) {
    dashPSelect.onchange = () => {
      const mainPSelect = document.getElementById('patternSelect');
      if (mainPSelect) {
        mainPSelect.value = dashPSelect.value;
        mainPSelect.dispatchEvent(new Event('change'));
      }
    };
  }

  if (dashSSelect) {
    dashSSelect.onchange = () => {
      const mainSSelect = document.getElementById('scaleSelect');
      if (mainSSelect) {
        mainSSelect.value = dashSSelect.value;
        mainSSelect.dispatchEvent(new Event('change'));
      }
    };
  }

  // 3. Aesthetics
  const bindAesthetic = (id, key) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.onclick = () => {
      Aesthetics[key] = !Aesthetics[key];
      btn.classList.toggle('active', Aesthetics[key]);
    };
  };

  bindAesthetic('dashSparksBtn', 'sparks');
  bindAesthetic('dashTrailsBtn', 'trails');
  bindAesthetic('dashGlowBtn', 'glow');

  // === DYNAMIC WORLD & CATEGORY MANAGEMENT ===
  const setWorld = (worldIdOrFilename) => {
    // 1. Determine Category and Filename
    let category = 'none';
    let filename = null;

    if (worldIdOrFilename === 'none') {
      category = worldIdOrFilename;
    } else if (worldIdOrFilename && worldIdOrFilename.endsWith('.mp4')) {
      filename = worldIdOrFilename;
      // Extract category from filename logic
      const bg = window.VIDEO_BACKGROUNDS?.find(b => b.filename === filename);
      category = bg ? bg.category.toLowerCase() : 'other';
    } else {
      // It's a category request (e.g. from a button)
      category = worldIdOrFilename.toLowerCase();
      // Load preference for this category or pick first
      const prefFilename = localStorage.getItem(`gp_bg_${category}`);
      if (prefFilename) {
        filename = prefFilename;
      } else {
        const firstInCat = window.VIDEO_BACKGROUNDS?.find(b => b.category.toLowerCase() === category);
        filename = firstInCat ? firstInCat.filename : null;
      }
    }

    // 2. Update State
    Aesthetics.world = category;
    Aesthetics.filename = filename;
    localStorage.setItem('aesthetic_world', category);
    if (filename) localStorage.setItem(`gp_bg_${category}`, filename);

    // 3. Update UI Buttons & Dropdown Sync
    const atmosphereBtnContainer = document.getElementById('dashAtmosphereButtons');
    if (atmosphereBtnContainer) {
      atmosphereBtnContainer.querySelectorAll('.dash-pill').forEach(btn => {
        const btnId = btn.getAttribute('data-category');
        if (btnId) btn.classList.toggle('active', btnId === category);
      });
    }

    const worldSelect = document.getElementById('aestheticWorldSelect');
    if (worldSelect) {
      worldSelect.value = filename || category;
    }

    // 4. Update DOM Classes
    const streamView = document.getElementById('stream-view');
    if (streamView) {
      // CSS-generated worlds
      streamView.classList.remove('css-tron-mode', 'css-nature-mode', 'css-sky-mode', 'css-beach-mode');

      // Video Background Management
      let videoBg = document.getElementById('video-bg');

      if (filename) {
        streamView.classList.add('video-mode');
        const videoSrc = `assets/backgrounds/${filename}`;

        if (!videoBg) {
          videoBg = document.createElement('video');
          videoBg.id = 'video-bg';
          videoBg.src = videoSrc;
          videoBg.autoplay = true;
          videoBg.loop = true;
          videoBg.muted = true;
          videoBg.playsInline = true;
          streamView.insertBefore(videoBg, streamView.firstChild);
        } else {
          if (!videoBg.src.endsWith(videoSrc)) {
            videoBg.src = videoSrc;
          }
          if (videoBg.paused) videoBg.play().catch(e => { });
          videoBg.style.display = 'block';
        }
      } else if (videoBg) {
        videoBg.pause();
        videoBg.style.display = 'none';
      }

      if (category === 'css-tron') streamView.classList.add('css-tron-mode');
      if (category === 'css-beach') streamView.classList.add('css-beach-mode');
      if (category === 'css-sky') streamView.classList.add('css-sky-mode');
    }
  };

  // Populate Dynamic Atmosphere UI
  const atmosphereBtnContainer = document.getElementById('dashAtmosphereButtons');
  const worldSelect = document.getElementById('aestheticWorldSelect');

  if (window.VIDEO_BACKGROUNDS) {
    // 1. Identify Unique Categories
    const categories = new Set();
    window.VIDEO_BACKGROUNDS.forEach(bg => categories.add(bg.category));

    // 2. Generate Buttons
    if (atmosphereBtnContainer) {
      // Static ones first
      const createBtn = (cat, label, icon) => {
        const btn = document.createElement('button');
        btn.className = 'dash-pill';
        btn.setAttribute('data-category', cat.toLowerCase());
        btn.textContent = `${icon} ${label}`;
        btn.onclick = () => setWorld(cat.toLowerCase());
        atmosphereBtnContainer.appendChild(btn);
        return btn;
      };

      createBtn('none', 'None', '');

      categories.forEach(cat => {
        const lowerCat = cat.toLowerCase();
        switch (lowerCat) {
          case 'nature':
            createBtn(cat, cat, '🌿');
            break;
          case 'sky':
            createBtn(cat, cat, '☁️');
            break;
          default:
            break;
        }
      });
    }

    // 3. Populate Dropdown (Grouped)
    if (worldSelect) {
      worldSelect.style.display = 'block';
      let html = `<option value="none">None (Standard)</option>`;
      html += `<optgroup label="Minimal">`;
      html += `<option value="css-tron">Tron Grid</option>`;
      html += `<option value="css-beach">Beach</option>`;
      html += `<option value="css-sky">Sky</option>`;
      html += `</optgroup>`;

      // Grouped Video Backgrounds
      categories.forEach(cat => {
        html += `<optgroup label="${cat}">`;
        window.VIDEO_BACKGROUNDS.filter(b => b.category === cat).forEach(bg => {
          html += `<option value="${bg.filename}">${bg.displayName}</option>`;
        });
        html += `</optgroup>`;
      });

      worldSelect.innerHTML = html;
      worldSelect.onchange = (e) => setWorld(e.target.value);
    }
  }

  // Init
  const savedWorld = localStorage.getItem('aesthetic_world') || 'none';
  setTimeout(() => {
    // Resolve initial filename if it's a category
    if (savedWorld !== 'none' && savedWorld !== 'tron' && savedWorld !== 'nature') {
      const pref = localStorage.getItem(`gp_bg_${savedWorld}`);
      setWorld(pref || savedWorld);
    } else {
      setWorld(savedWorld);
    }
  }, 100);

  // Periodic UI update (for state changes initiated elsewhere)
  setInterval(() => {
    if (isDashboardOpen) updateToggleUI();
  }, 500);
}

function syncDashboardSelectors() {
  const dashPSelect = document.getElementById('dashPatternSelect');
  const dashSSelect = document.getElementById('dashScaleSelect');
  const mainPSelect = document.getElementById('patternSelect');
  const mainSSelect = document.getElementById('scaleSelect');

  if (dashPSelect && mainPSelect) {
    dashPSelect.innerHTML = mainPSelect.innerHTML;
    dashPSelect.value = mainPSelect.value;
  }
  if (dashSSelect && mainSSelect) {
    dashSSelect.innerHTML = mainSSelect.innerHTML;
    dashSSelect.value = mainSSelect.value;
  }
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

  // 1. Horizontal track line (Only if NOT in Nature mode)
  if (Aesthetics.world !== 'nature') {
    streamCtx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    streamCtx.lineWidth = 1;
    streamCtx.beginPath();
    streamCtx.moveTo(0, centerY);
    streamCtx.lineTo(w, centerY);
    streamCtx.stroke();
  }

  // Theme Detection
  const isDark = document.body.classList.contains('dark');
  const handRCol = isDark ? '#fd0380' : '#610a42';
  const handLCol = isDark ? 'rgb(30, 121, 232)' : 'rgb(2, 68, 150)';

  // Glassmorphism for Nature & Sky Mode
  let cellBgCol = isDark ? '#222233' : '#ffffff';
  let isGlass = false;

  if (Aesthetics.world === 'nature' || Aesthetics.world === 'sky') {
    cellBgCol = 'rgba(255, 255, 255, 0.1)'; // Frosted glass base
    isGlass = true;
  }

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

    // BUTTERY EASING & SPARKS: Pulse note as it passes center
    const stepProgress = currentTotalStep - j;
    let scale = 1.0;

    if (stepProgress >= 0 && stepProgress < 1.0) {
      const ease = Math.pow(1.0 - stepProgress, 3);
      scale = 1.0 + (ease * 0.35 * (Aesthetics.glow ? 1 : 0.5));

      // Trigger Spark Burst on exact hit
      if (stepProgress < 0.05 && rawLabel && !cell._hasSparked) {
        createBurst(x, centerY, baseCol);
        cell._hasSparked = true;
      }
    }

    if (stepProgress > 0.5 || stepProgress < -0.5) {
      cell._hasSparked = false; // Reset for next loop/pass
    }

    if (isVisualDing && !stepProgress) {
      scale = 1.35;
    }

    const radius = 42 * scale;

    // Optional Trail Effect
    if (Aesthetics.trails && stepProgress > 0 && stepProgress < 0.3) {
      streamCtx.beginPath();
      streamCtx.arc(x - (stepProgress * 100), centerY, radius * 0.8, 0, Math.PI * 2);
      streamCtx.fillStyle = baseCol;
      streamCtx.globalAlpha = 0.2 * (1.0 - stepProgress / 0.3);
      streamCtx.fill();
      streamCtx.globalAlpha = 1.0;
    }

    // 4c. Background Circle
    streamCtx.beginPath();
    streamCtx.arc(x, centerY, radius, 0, Math.PI * 2);
    streamCtx.fillStyle = cellBgCol;
    streamCtx.fill();

    if (isGlass) {
      streamCtx.lineWidth = 2;
      streamCtx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      streamCtx.stroke();
    }

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
  const nowGlow = Aesthetics.glow ? (15 + Math.pow(1.0 - pos.fraction, 2) * 20) : 0;
  streamCtx.strokeStyle = 'rgba(255, 237, 0, 0.9)';
  streamCtx.lineWidth = 4;
  if (Aesthetics.glow) {
    streamCtx.shadowBlur = nowGlow;
    streamCtx.shadowColor = 'rgba(255, 237, 0, 0.6)';
  }
  streamCtx.beginPath();
  streamCtx.moveTo(centerX, 0);
  streamCtx.lineTo(centerX, h);
  streamCtx.stroke();
  streamCtx.shadowBlur = 0; // Reset for sparks

  // 6. Draw Sparks
  sparks.forEach(s => {
    streamCtx.globalAlpha = s.alpha;
    streamCtx.fillStyle = s.color;
    streamCtx.beginPath();
    streamCtx.arc(s.x, s.y, 3, 0, Math.PI * 2);
    streamCtx.fill();
  });
  streamCtx.globalAlpha = 1.0;

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