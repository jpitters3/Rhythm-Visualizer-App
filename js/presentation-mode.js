/* ===== PRESENTATION MODE ===== */
import { gridA, activeGrid } from './grid-context.js';
import { labelForStep } from './notegrid.js';
import { addTickObserver, getPlaybackPosition } from './noteplayer.js';
import { TransportRegistry } from './transport-ui.js';
import { Bus, BUS_EVENT } from './bus.js';
import { HANDPAN_MAP } from './handpanmap.js';

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
  sparks: false,
  trails: false,
  glow: true,
  sticking: true,
  proximity: true,
  colors: true,
  comets: false
};

const sparks = []; // { x, y, vx, vy, alpha, color }

export function setPresentationMode(mode) {
  if (['measure', 'stream', 'gravity'].includes(mode)) {
    presentationViewMode = mode;
    localStorage.setItem(PRESENT_MODE_KEY, mode);

    // Refresh view if active
    if (document.body.classList.contains('present')) {
      // Toggle Classes on Body for CSS styling
      document.body.classList.toggle('mode-stream', mode === 'stream');
      document.body.classList.toggle('mode-measure', mode === 'measure');
      document.body.classList.toggle('mode-gravity', mode === 'gravity');

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
  } else if (presentationViewMode === 'gravity') {
    ensureStreamCanvasReady(); // Reusing the same canvas container
    handleStreamResize();
    updateSparks();
    drawGravity(gridA);
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

    document.body.classList.remove('mode-stream', 'mode-measure', 'mode-gravity');
  }
}


function updatePresentationView(currentStep, ctx = gridA) {
  if (ctx.id !== 'A') return;
  if (!document.body.classList.contains('present')) return;

  if (presentationViewMode === 'stream' || presentationViewMode === 'gravity') {
    updateStreamView(currentStep, ctx); // Canvas handles both
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
  const bindAesthetic = (id, key, addBodyClass = false) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.onclick = () => {
      Aesthetics[key] = !Aesthetics[key];
      btn.classList.toggle('active', Aesthetics[key]);

      if (addBodyClass) {
        document.body.classList.toggle('no-sticking', !Aesthetics[key]);
      }
    };
  };

  bindAesthetic('dashSparksBtn', 'sparks');
  bindAesthetic('dashTrailsBtn', 'trails');
  bindAesthetic('dashGlowBtn', 'glow');
  bindAesthetic('dashIntervalBtn', 'interval');
  bindAesthetic('dashStickingBtn', 'sticking', true);
  bindAesthetic('dashProximityBtn', 'proximity');
  bindAesthetic('dashColorsBtn', 'colors');
  bindAesthetic('dashCometsBtn', 'comets');

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
  if (totalSteps === 0) return; // Defensive: DOM not ready

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
    if (!cell) continue; // Defensive guard

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
      const notationPref = localStorage.getItem('handpanLabelPref') || 'Numbers';
      const showEgg = isVisualDing && notationPref === 'Pitches';

      if (showEgg) {
        const eggW = radius * 0.40;
        const eggH = radius * 0.45;
        // Double White Ring
        streamCtx.strokeStyle = '#ffffff';
        streamCtx.lineWidth = 2;

        // Outer Ring
        streamCtx.beginPath();
        streamCtx.ellipse(x, centerY, eggW - 2, eggH - 2, 0, 0, Math.PI * 2);
        streamCtx.stroke();

        // Inner Ring
        streamCtx.beginPath();
        streamCtx.ellipse(x, centerY, eggW - 6, eggH - 6, 0, 0, Math.PI * 2);
        streamCtx.stroke();
      } else {
        const textToDraw = (notationPref === 'Numbers' && (rawLabel === '0' || rawLabel === 'Ding')) ? 'D' : displayLabel;
        streamCtx.fillStyle = '#ffffff';
        streamCtx.font = `bold ${Math.floor(40 * scale)}px Inter, system-ui`;
        streamCtx.textAlign = 'center';
        streamCtx.textBaseline = 'middle';
        streamCtx.fillText(textToDraw, x, centerY + 2);
      }
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
}

// Helper to convert hex to rgb string for rgba gradients
function hexToRgb(hex) {
  // If it's already an rgb/rgba string, try to extract numbers
  if (hex.startsWith('rgb')) {
    const match = hex.match(/\d+/g);
    if (match && match.length >= 3) {
      return `${match[0]}, ${match[1]}, ${match[2]}`;
    }
    return "255, 255, 255"; // Fallback
  }

  // Clean hex
  hex = hex.replace(/^#/, '');
  if (hex.length === 3) {
    hex = hex.split('').map(char => char + char).join('');
  }

  const bigint = parseInt(hex, 16);
  if (isNaN(bigint)) return "255, 255, 255";

  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;

  return `${r}, ${g}, ${b}`;
}

// === GRAVITY VIEW (Radial Inward) === //
function drawGravity(ctx) {
  if (!streamCtx || !streamCanvas) return;

  const dpr = window.devicePixelRatio || 1;
  const w = streamCanvas.width / dpr;
  const h = streamCanvas.height / dpr;
  const pos = getPlaybackPosition(ctx);

  const centerY = h / 2;
  const centerX = w / 2;

  const totalSteps = ctx.cells.length;
  if (totalSteps === 0) return;

  streamCtx.save();
  streamCtx.clearRect(0, 0, w, h);

  // Theme & Colors
  const isDark = document.body.classList.contains('dark');
  const handRCol = isDark ? '#fd0380' : '#610a42';
  const handLCol = isDark ? 'rgb(30, 121, 232)' : 'rgb(2, 68, 150)';
  let cellBgCol = isDark ? '#222233' : '#ffffff';
  let isGlass = false;

  if (Aesthetics.world === 'nature' || Aesthetics.world === 'sky') {
    cellBgCol = 'rgba(255, 255, 255, 0.1)';
    isGlass = true;
  }

  // 1. Locate Handpan and Tonefields dynamically
  const hpImg = document.getElementById('handpanImg');
  let hpRect = { left: 0, top: 0, width: 400, height: 400 };

  if (hpImg && hpImg.width > 0) {
    hpRect = hpImg.getBoundingClientRect();
  }

  const canvasRect = streamCanvas.getBoundingClientRect();

  // Calculate Handpan center relative to canvas (Canvas is usually absolute full screen)
  const hpCenterX = (hpRect.left - canvasRect.left) + (hpRect.width / 2);
  const hpCenterY = (hpRect.top - canvasRect.top) + (hpRect.height / 2);
  const hpRadius = (hpRect.width / 2) || 200;

  // 2. Sliding Window Calculation
  const currentTotalStep = pos.step + pos.fraction;
  const LOOKAHEAD_STEPS = 16; // How many steps in the future to draw
  const SPEED_FACTOR = 40; // Pixels per step 

  if (ctx.playing) {
    const seenProximityTargets = new Set();
    for (let j = Math.floor(currentTotalStep); j <= Math.ceil(currentTotalStep) + LOOKAHEAD_STEPS; j++) {
      const i = j % totalSteps;
      const cell = ctx.cells[i];
      const rawLabel = ctx.innerLabels[i];

      if (!cell || !rawLabel || rawLabel === '') continue;

      // Time Delta (0 = impact)
      const dt = j - currentTotalStep;
      if (dt < -0.5) continue; // Don't draw things that have already passed (unless trailing out)

      // Calculate Target Coordinates
      const strLabel = String(rawLabel);
      let targetX = centerX;
      let targetY = centerY;

      // Fallback if HANDPAN_MAP is missing: Arrange notes in a simple circle
      let isFallback = false;

      if (HANDPAN_MAP && HANDPAN_MAP[strLabel]) {
        const NOTE_CONFIG = HANDPAN_MAP[strLabel];

        // NOTE_CONFIG x and y are percentages (0-100) of the handpan bounds.
        targetX = (hpRect.left - canvasRect.left) + (NOTE_CONFIG.x / 100) * hpRect.width;
        targetY = (hpRect.top - canvasRect.top) + (NOTE_CONFIG.y / 100) * hpRect.height;

      } else if (strLabel === 'Ding' || strLabel === 'Tak' || strLabel === 'Slap') {
        // Center hits
        targetX = hpCenterX;
        targetY = hpCenterY;
      } else {
        // Fallback positioning (pseudo-random circle based on label string)
        isFallback = true;
        const fallbackAngle = (strLabel.charCodeAt(0) * 45) * (Math.PI / 180);
        const tr = hpRadius * 0.7;
        targetX = hpCenterX + tr * Math.cos(fallbackAngle);
        targetY = hpCenterY + tr * Math.sin(fallbackAngle);
      }

      // Spawn Vector Definition (From Center extending outward)
      // To make it fall IN, the starting point needs to be "dt" distance AWAY along the vector passing through the center to the target.
      // If it's a center hit (Ding), we need a fallback aesthetic vector, like straight up.
      let vx = targetX - hpCenterX;
      let vy = targetY - hpCenterY;
      let vLen = Math.sqrt(vx * vx + vy * vy);

      if (vLen < 1) {
        vx = 0; vy = -1; vLen = 1; // Fall straight down for center notes
      }

      // Normalize and scale by time*speed
      const nx = vx / vLen;
      const ny = vy / vLen;

      let visualDt = dt;
      if (Aesthetics.interval && dt > 0) {
        // We want the comet to rest at destination (0.0) when 0 < dt <= 1.0
        // We want it to rest at distance 1.0 when 1.0 < dt <= 2.0, etc.
        const targetHoverDist = Math.max(0, Math.ceil(dt) - 1);
        const frac = dt - Math.floor(dt); // 0.99 down to 0.00 inside the tier

        // 'extraHover' adds distance to push it back up to the PREVIOUS tier's resting spot.
        let extraHover = 0;

        if (dt > 1.0) {
          // For the first 65% of the beat time (frac from 0.99 down to 0.35), 
          // the comet rests at the HIGHER tier (+1 distance).
          if (frac > 0.35) {
            extraHover = 1.0;
          } else {
            // In the final 35% of the beat time (frac from 0.35 down to 0.00),
            // it gets sucked forward (extraHover drops from 1.0 down to 0.0)
            let pull = frac / 0.35; // 1.0 (far away) down to 0.0 (arrived at targetHoverDist)
            extraHover = Math.pow(pull, 1.5);
          }
        }

        visualDt = targetHoverDist + extraHover;
      }

      const distanceOffset = visualDt * SPEED_FACTOR;

      const drawX = targetX + (nx * distanceOffset);
      const drawY = targetY + (ny * distanceOffset);

      // Fade in from distance
      let alpha = 1.0;

      if (!Aesthetics.sticking) {
        if (visualDt > LOOKAHEAD_STEPS - 2) {
          alpha = (LOOKAHEAD_STEPS - visualDt) / 2.0;
        }
        if (visualDt < 0) {
          alpha = 1.0 + (visualDt * 2.0); // Fade out instantly after hit
          if (alpha < 0) alpha = 0;
        }

        if (alpha <= 0) continue;
      }

      // Color Logic
      const stepsAway = Math.max(0, Math.floor(dt));

      let cr = 1, cg = 1, cb = 1, co = 1;

      // Drawing Logic (Orb)
      const hand = (ctx.innerHands && ctx.innerHands[i]) ? ctx.innerHands[i] : (i % 2 === 0 ? 'R' : 'L');

      if (Aesthetics.sticking) {
        if (hand === 'R') {
          // n-1: var(--up-fill) rgb(97, 10, 66);
          cr = 97; cg = 10; cb = 66;
        } else {
          // n-1: var(--down-fill) rgb(2, 68, 150);
          cr = 2; cg = 68; cb = 150;
        }

        if (stepsAway === 0) {
          co = 0.6;
        } else {
          co = 0;
        }
      }
      else {
        co = 0.35;
        if (stepsAway < 1) {
          // n-1: Green (dt between 0 and 1)
          cr = 34; cg = 197; cb = 94;
        } else if (stepsAway < 2) {
          // n-2: Yellow
          cr = 234; cg = 179; cb = 8;
        } else if (stepsAway < 3) {
          // n-3: Orange
          cr = 255; cg = 140; cb = 0;
        } else if (stepsAway < 4) {
          // n-4: Red
          cr = 255; cg = 0; cb = 0;
        } else if (stepsAway < 5) {
          // n-5: Indigo
          cr = 79; cg = 70; cb = 239;
        } else {
          // n-6 or less: Deep purple
          cr = 148; cg = 41; cb = 184;
        }
      }

      const baseCol = `rgb(${cr}, ${cg}, ${cb})`;

      // Proximity Colouring Overlay on Tonefield
      if (Aesthetics.proximity && dt > 0 && stepsAway < 3) {
        const targetKey = `${Math.round(targetX)},${Math.round(targetY)}`;
        if (!seenProximityTargets.has(targetKey)) {
          seenProximityTargets.add(targetKey);

          streamCtx.beginPath();
          streamCtx.arc(targetX, targetY, 35, 0, Math.PI * 2);
          streamCtx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, ${co})`;
          streamCtx.fill();
        }
      }

      if (!Aesthetics.colors) {
        // Fixed: Deep purple
        cr = 148; cg = 41; cb = 184;
      }

      let drawRadius = 20;
      streamCtx.globalAlpha = alpha;

      // On the step before target, add an animation pulse and white flash
      let flashCr = cr, flashCg = cg, flashCb = cb;
      if (dt > 0 && dt <= 1.0) {
        const popTime = 1.0 - dt;
        const popScale = Math.exp(-6 * popTime); // High at dt=1, decals to 0 as dt=0
        drawRadius += (popScale * 12);

        // Interpolate towards White based on popScale
        flashCr = Math.round(cr + (255 - cr) * popScale);
        flashCg = Math.round(cg + (255 - cg) * popScale);
        flashCb = Math.round(cb + (255 - cb) * popScale);

        if (Aesthetics.comets) {
          // Glow flash
          streamCtx.beginPath();
          streamCtx.arc(drawX, drawY, drawRadius + (popScale * 25), 0, Math.PI * 2);
          streamCtx.fillStyle = `rgba(255, 255, 255, ${0.6 * popScale})`; // Bright white halo
          streamCtx.fill();
        }
      }

      const drawCol = `rgb(${flashCr}, ${flashCg}, ${flashCb})`;

      if (Aesthetics.comets) {
        // Optional Trail Effect (Comet Tail)
        if (Aesthetics.trails && dt > 0) {
          // The trail extends BACKWARD along the vector (positive nx, ny because nx is target -> source direction)
          // Shorter tail as it gets closer to 0 so it visually burns up on impact
          const maxTail = 150 + (dt * 50);
          const tailLength = Math.min(maxTail, dt * 200); // Rapidly shrinks to 0 in the final beat
          const tailX = drawX + (nx * tailLength);
          const tailY = drawY + (ny * tailLength);

          // Create a gradient that fades out towards the end of the tail
          const gradient = streamCtx.createLinearGradient(drawX, drawY, tailX, tailY);
          gradient.addColorStop(0, `rgba(${cr}, ${cg}, ${cb}, ${alpha * 0.8})`);
          gradient.addColorStop(1, `rgba(${cr}, ${cg}, ${cb}, 0)`);

          // Draw a tapering polygon from the sides of the orb to the tail point
          // Perpendicular vector for the width of the orb
          const px = -ny;
          const py = nx;

          const width = drawRadius * 0.8; // Slightly narrower than full radius for aerodynamics

          streamCtx.beginPath();
          // Left edge of orb
          streamCtx.moveTo(drawX + (px * width), drawY + (py * width));
          // Right edge of orb
          streamCtx.lineTo(drawX - (px * width), drawY - (py * width));
          // Tip of the tail
          streamCtx.lineTo(tailX, tailY);
          streamCtx.closePath();

          streamCtx.fillStyle = gradient;
          streamCtx.fill();
        }

        // Orb Background
        streamCtx.beginPath();
        streamCtx.arc(drawX, drawY, drawRadius, 0, Math.PI * 2);
        streamCtx.fillStyle = cellBgCol;
        streamCtx.fill();

        if (isGlass) {
          streamCtx.lineWidth = 2;
          streamCtx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
          streamCtx.stroke();
        }

        // Inner Color
        streamCtx.globalAlpha = alpha * 0.8;
        streamCtx.fillStyle = drawCol;
        streamCtx.fill();
        streamCtx.globalAlpha = alpha;
      }

      // Hit Expansion
      if (dt < 0.1 && dt > -0.1 && !cell._hasSparkedGrav) {
        let sc = 1.0;
        if (Aesthetics.glow) sc = 1.5;
        streamCtx.beginPath();
        streamCtx.arc(targetX, targetY, drawRadius * sc, 0, Math.PI * 2);
        streamCtx.strokeStyle = baseCol;
        streamCtx.lineWidth = 4;
        streamCtx.stroke();

        createBurst(targetX, targetY, baseCol);
        cell._hasSparkedGrav = true;
      }

      if (dt > 0.5) {
        cell._hasSparkedGrav = false;
      }

      if (Aesthetics.comets) {
        // Note Text
        const notationPref = localStorage.getItem('handpanLabelPref') || 'Numbers';
        const displayLabel = Array.isArray(rawLabel) ? rawLabel.join('') : String(rawLabel);
        const textToDraw = (notationPref === 'Numbers' && (displayLabel === '0' || displayLabel === 'Ding')) ? 'D' : displayLabel;

        streamCtx.fillStyle = '#ffffff';
        streamCtx.font = `bold 18px Inter, system-ui`;
        streamCtx.textAlign = 'center';
        streamCtx.textBaseline = 'middle';
        streamCtx.fillText(textToDraw, drawX, drawY + 1);

        // Coaching Highlight
        if (cell.classList.contains('coach-wrong') || cell.classList.contains('coach-missed')) {
          highlightCell(drawX, drawY, drawRadius, '#e74c3c', false);
        }
      }
    }
  } // end if (ctx.playing)

  // Draw Sparks
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