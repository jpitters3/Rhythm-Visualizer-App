import { dbListPatternsWithData, getSavedPatterns, applyPattern, serializePattern } from './pattern-crud.js';
import { supabase } from './supabase-client.js';
import { gridA, gridB } from './grid-context.js';
import { setDualGrid, clearGrid, renderAllMeasures } from './notegrid.js';
import { start, stop, setTimeSignature } from './noteplayer.js';
import { turnOnMic, turnOffMic } from './transcription.js';
import { isListening } from './state.js';

let wizardState = {
  currentStep: 1,
  flowChoice: null, // 'rhythm-first' or 'melody-first'
  basePatternId: null, // ID of the selected or created base pattern
  overlaySequence: null // The recorded additions
};

// Internal caches for patterns
let cachedUserPatterns = [];
let cachedCommunitySongs = [];

// DOM Elements
let viewCompose;
let step1Dot, step2Dot, step3Dot;
let contentArea;
let nextBtn;
let subtitle;

let isInitialized = false;

export function initComposeWizard() {
  if (isInitialized) return;
  isInitialized = true;

  viewCompose = document.getElementById('view-compose');
  if (!viewCompose) return;

  // Old dot queries removed, progress UI handled dynamically inside renderStep
  contentArea = document.getElementById('cw-content-area');
  nextBtn = document.getElementById('cw-next-btn');
  subtitle = document.getElementById('cw-subtitle');

  // Listen for route changes to '#compose'
  window.addEventListener('routeChanged', (e) => {
    if (e.detail.route === 'compose') {
      resetWizard();
      renderStep(1);
    }
  });

  // Setup Button Listeners
  nextBtn.addEventListener('click', nextStep);
}

function resetWizard() {
  wizardState = {
    currentStep: 1,
    flowChoice: null,
    basePatternId: null,
    overlaySequence: null
  };
}

function nextStep() {
  if (wizardState.currentStep < 3) {
    wizardState.currentStep++;
    renderStep(wizardState.currentStep);
  }
}

function prevStep() {
  if (wizardState.currentStep > 1) {
    wizardState.currentStep--;
    renderStep(wizardState.currentStep);
  }
}

function renderStep(stepIndex) {
  // Update Progress Tracker Header
  for (let i = 1; i <= 4; i++) {
    const stepEl = document.getElementById(`cw-step-${i}`);
    const dotEl = stepEl?.querySelector('.cw-step-dot');
    const labelEl = stepEl?.querySelector('.cw-step-label');
    const lineEl = document.getElementById(`cw-line-${i}`); // Lines 1 to 3 exist

    // Reset all status classes
    if (dotEl) dotEl.className = 'cw-step-dot';
    if (labelEl) labelEl.className = 'cw-step-label';
    if (lineEl) lineEl.className = 'cw-step-line';

    if (i < stepIndex) {
      // Completed Steps
      if (dotEl) dotEl.classList.add('completed');
      if (labelEl) labelEl.classList.add('completed');
      if (lineEl) lineEl.classList.add('completed');
    } else if (i === stepIndex) {
      // Current Active Step
      if (dotEl) dotEl.classList.add('active');
      if (labelEl) labelEl.classList.add('active');
    }
  }

  // Reset content area styling if needed
  contentArea.innerHTML = '';
  nextBtn.style.display = 'block'; // Or hide based on validation later

  let progressTracker = document.getElementById('cw-progress-tracker');

  if (stepIndex === 1) {
    renderStep1();
    if (progressTracker && document.getElementById('cw-wizard-header')) {
      document.getElementById('cw-wizard-header').appendChild(progressTracker);
    }
  } else if (stepIndex === 2) {
    if (wizardState.basePatternId === 'CREATE_NEW') {
      renderStep2();
    } else {
      renderStep3();
    }
  } else if (stepIndex === 3) {
    renderStep3();
  } else if (stepIndex === 4) {
    renderStep4();
    if (progressTracker && document.getElementById('cw-wizard-header')) {
      document.getElementById('cw-wizard-header').appendChild(progressTracker);
    }
  }
}

function renderStep1() {
  subtitle.textContent = "Step 1: Foundation";

  contentArea.innerHTML = `
    <div style="text-align: center; margin-top: 50px;" id="cw-flow-selection">
      <h2 style="font-size: 24px; margin-bottom: 20px;">Choose Your Path</h2>
      <div style="display: flex; gap: 20px; justify-content: center;">
        <div id="flow-rhythm-btn" class="secondary-btn" style="padding: 20px; font-size: 18px; cursor: pointer; width: 250px;">
          🥁 Start with a Rhythm
        </div>
        <div id="flow-melody-btn" class="secondary-btn" style="padding: 20px; font-size: 18px; cursor: pointer; width: 250px;">
          🎹 Start with a Melody
        </div>
      </div>
    </div>
    
    <div id="cw-pattern-selection" style="display: none; margin-top: 40px;">
      <h3 id="cw-pattern-list-title" style="font-size: 20px; margin-bottom: 15px; border-bottom: 1px solid var(--panel-border); padding-bottom: 10px;">Select a Foundation</h3>
      <div id="cw-pattern-list" style="display: flex; flex-direction: column; gap: 10px; max-height: 300px; overflow-y: auto;">
        <!-- Loaded via JS -->
      </div>
    </div>
  `;

  // Temporary Next logic:
  nextBtn.textContent = 'Next Step';
  nextBtn.disabled = true;

  document.getElementById('flow-rhythm-btn').addEventListener('click', (e) => {
    wizardState.flowChoice = 'rhythm-first';
    selectFlow(document.getElementById('flow-rhythm-btn'));
  });

  document.getElementById('flow-melody-btn').addEventListener('click', (e) => {
    wizardState.flowChoice = 'melody-first';
    selectFlow(document.getElementById('flow-melody-btn'));
  });
}

async function selectFlow(clickedBtn) {
  document.getElementById('flow-rhythm-btn').style.borderColor = 'var(--panel-border)';
  document.getElementById('flow-melody-btn').style.borderColor = 'var(--panel-border)';
  clickedBtn.style.borderColor = 'var(--accent-glow)';

  // Show Loading state
  const patternSelectionDiv = document.getElementById('cw-pattern-selection');
  const patternList = document.getElementById('cw-pattern-list');
  const listTitle = document.getElementById('cw-pattern-list-title');
  patternSelectionDiv.style.display = 'block';
  patternList.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-secondary);">Loading library...</div>';

  listTitle.textContent = wizardState.flowChoice === 'rhythm-first' ? 'Select a Rhythm' : 'Select a Melody';

  await loadAllPatterns();
  renderPatternList();
}

async function loadAllPatterns() {
  if (cachedUserPatterns.length > 0 || cachedCommunitySongs.length > 0) return; // Already cached

  // 1. Fetch Local
  const localSaved = getSavedPatterns();
  if (localSaved) {
    Object.keys(localSaved).forEach(name => {
      cachedUserPatterns.push({ source: 'local', name, data: localSaved[name], isMine: true });
    });
  }

  // 2. Fetch Cloud for user
  if (typeof supabase !== 'undefined') {
    try {
      const cloudPatterns = await dbListPatternsWithData();
      cloudPatterns.forEach(p => {
        // Prevent dupes from local
        if (!cachedUserPatterns.find(cp => cp.name === p.name)) {
          cachedUserPatterns.push({ source: 'cloud', name: p.name, data: p.data, isMine: true });
        }
      });

      // 3. Fetch Community
      const { data: songsData } = await supabase.from('songs').select('id, name, pattern_json');
      if (songsData) {
        cachedCommunitySongs = songsData.map(s => ({
          source: 'community',
          id: s.id,
          name: s.name,
          data: s.pattern_json,
          isMine: false // It belongs to the community
        }));
      }
    } catch (e) {
      console.warn('Failed fetching cloud patterns for wizard', e);
    }
  }
}

function isRhythm(patternData) {
  if (!patternData || !patternData.labels) return true; // empty counts as rhythm
  let hasMusicNote = false;
  patternData.labels.forEach((cell) => {
    if (!cell) return;
    const notes = Array.isArray(cell) ? cell : [cell];
    notes.forEach((n) => {
      // Any character that is a digit 0-9 indicates a melody note
      if (typeof n === 'string' && n.match(/\\d/)) {
        hasMusicNote = true;
      }
    });
  });
  return !hasMusicNote;
}

function renderPatternList() {
  const patternList = document.getElementById('cw-pattern-list');
  patternList.innerHTML = '';

  // Create New Option
  const createNewDiv = document.createElement('div');
  createNewDiv.style.cssText = 'padding: 15px; border: 1px dashed var(--accent-glow); border-radius: 8px; cursor: pointer; font-weight: bold; text-align: center; color: var(--accent-glow); margin-bottom: 10px;';
  createNewDiv.textContent = wizardState.flowChoice === 'rhythm-first' ? '+ Create New Rhythm' : '+ Create New Melody';
  createNewDiv.onclick = () => {
    wizardState.basePatternId = 'CREATE_NEW';
    Array.from(patternList.children).forEach(c => c.style.borderColor = 'var(--panel-border)');
    createNewDiv.style.borderColor = 'var(--text-primary)';
    nextBtn.disabled = false;
  };
  patternList.appendChild(createNewDiv);

  // Filter based on flow choice
  const allPatterns = [...cachedUserPatterns, ...cachedCommunitySongs];
  let validPatterns = [];

  allPatterns.forEach(p => {
    const isRhy = isRhythm(p.data);

    if (wizardState.flowChoice === 'rhythm-first') {
      // Must be a rhythm (any source)
      if (isRhy) validPatterns.push(p);
    } else {
      // Melody-First: Must be a melody (any source)
      if (!isRhy) validPatterns.push(p);
    }
  });

  if (validPatterns.length === 0) {
    const noneDiv = document.createElement('div');
    noneDiv.style.cssText = 'padding: 15px; text-align: center; color: var(--text-secondary); border: 1px solid var(--panel-border); border-radius: 8px;';
    noneDiv.textContent = 'No matching patterns found in your library.';
    patternList.appendChild(noneDiv);
    return;
  }

  validPatterns.forEach(p => {
    const div = document.createElement('div');
    div.style.cssText = 'padding: 15px; border: 1px solid var(--panel-border); border-radius: 8px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;';

    const badgeColor = p.source === 'community' ? 'var(--primary)' : 'var(--text-secondary)';

    div.innerHTML = `
      <div>
        <div style="font-weight: 600;">${p.name}</div>
        <div style="font-size: 12px; color: ${badgeColor}; margin-top: 4px;">${p.source.toUpperCase()}</div>
      </div>
    `;

    div.onclick = () => {
      wizardState.basePatternId = p.name || p.id;
      Array.from(patternList.children).forEach(c => c.style.borderColor = 'var(--panel-border)');
      createNewDiv.style.borderColor = 'var(--accent-glow)'; // Restore dashed color
      div.style.borderColor = 'var(--text-primary)';
      nextBtn.disabled = false;
    };

    patternList.appendChild(div);
  });
}

async function renderStep2() {
  subtitle.textContent = "Step 2: Overlay & Recording";

  // Transition to freeplay view visually but keep wizard state active
  window.location.hash = '#freeplay';

  // Ensure the compose container looks inactive while in freeplay
  viewCompose.style.display = 'none';

  // Create overlay header in freeplay
  let overlay = document.getElementById('cwFreeplayOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'cwFreeplayOverlay';
    overlay.classList.add('cw-freeplay-overlay');

    // Append to the view-freeplay container so it hides when navigating away
    const viewFreeplay = document.getElementById('view-freeplay');
    if (viewFreeplay) {
      viewFreeplay.appendChild(overlay);
      // Add relative positioning to container just in case
      viewFreeplay.style.position = 'relative';
    } else {
      document.body.appendChild(overlay);
    }
  }
  overlay.style.display = 'flex';

  let progressTracker = document.getElementById('cw-progress-tracker');

  overlay.innerHTML = `
    <div class="cw-overlay-top">
      <div>
        <h3 class="cw-step-title">The Creation Current</h3>
        <span class="cw-step-subtitle">
          Step 2: ${wizardState.flowChoice === 'rhythm-first' ? 'Lay down your Rhythm' : 'Lay down your Melody'}. 
          (💡 Use the Virtual Handpan to record)
        </span>
      </div>
      <div class="cw-step-buttons">
        <button id="cw-step1-back" class="secondary-btn">Back to Step 1</button>
        <button id="cw-step3-next" class="primary-btn">Next (To Step 3)</button>
      </div>
    </div>
  `;

  if (progressTracker) {
    overlay.appendChild(progressTracker);
  }
  overlay.style.display = 'flex';

  document.getElementById('cw-step1-back').onclick = () => {
    overlay.style.display = 'none';
    window.location.hash = '#compose';
    viewCompose.style.display = 'block'; // Force visible since we navigated manually
    prevStep();
  };

  let autoRecordSection = document.createElement('div');
  autoRecordSection.innerHTML = `
    <button id="cwAutoRecord" class="cw-auto-record primary-btn">
      🎤 Record
    </button>
  `;
  overlay.appendChild(autoRecordSection);

  document.getElementById('cwAutoRecord').onclick = startAutoAdvanceRecording;

  const nextBtn3 = document.getElementById('cw-step3-next');
  nextBtn3.onclick = () => {
    // Capture what the user composed on gridA
    wizardState.overlaySequence = serializePattern(gridA);

    overlay.style.display = 'none';
    window.location.hash = '#freeplay';
    viewCompose.style.display = 'block';
    nextStep();
  };

  // Require at least one note before proceeding
  bindNextButtonToGrid(3);

  // Create new grid for rhythm or melody
  setDualGrid(false);
  clearGrid(gridA);
  setTimeSignature('4/4');
  gridA.setMeasures(1);
  gridA.reset();
  renderAllMeasures(gridA);
}

async function renderStep3() {
  subtitle.textContent = "Step 3: Add Melody to your rhythm";

  // Transition to freeplay view visually but keep wizard state active
  window.location.hash = '#freeplay';

  // Ensure the compose container looks inactive while in freeplay
  viewCompose.style.display = 'none';

  // Create overlay header in freeplay
  let overlay = document.getElementById('cwFreeplayOverlay');
  overlay.style.display = 'flex';
  let progressTracker = document.getElementById('cw-progress-tracker');

  overlay.innerHTML = `
    <div class="cw-overlay-top">
      <div>
        <h3 class="cw-step-title">The Creation Current</h3>
        <span class="cw-step-subtitle">
          Step 3: Add Melody to your rhythm. 
          (💡 Use the Virtual Handpan to record)
        </span>
      </div>
      <div class="cw-step-buttons">
        <button id="cw-step2-back" class="secondary-btn">Back to Step 2</button>
        <button id="cw-step4-next" class="primary-btn">Next (To Step 4)</button>
      </div>
    </div>
  `;

  if (progressTracker) {
    overlay.appendChild(progressTracker);
  }
  overlay.style.display = 'flex';

  document.getElementById('cw-step2-back').onclick = () => {
    overlay.style.display = 'none';
    window.location.hash = '#freeplay';
    viewCompose.style.display = 'block'; // Force visible since we navigated manually
    prevStep();
  };

  let autoRecordSection = document.createElement('div');
  autoRecordSection.innerHTML = `
    <button id="cwAutoRecord" class="cw-auto-record primary-btn">
      🎤 Record
    </button>
  `;
  overlay.appendChild(autoRecordSection);

  document.getElementById('cwAutoRecord').onclick = startAutoAdvanceRecording;

  const nextBtn4 = document.getElementById('cw-step4-next');
  nextBtn4.onclick = () => {
    // Capture what the user composed on gridA
    wizardState.overlaySequence = serializePattern(gridA);

    overlay.style.display = 'none';
    window.location.hash = '#compose';
    viewCompose.style.display = 'block';
    nextStep();
  };

  // Require at least one note before Next button is enabled
  bindNextButtonToGrid(4);

  // Load Base Pattern into Grid B
  const allPatterns = [...cachedUserPatterns, ...cachedCommunitySongs];
  const pattern = allPatterns.find(p => p.id === wizardState.basePatternId || p.name === wizardState.basePatternId);

  if (pattern) {
    const dualModeBtn = document.getElementById('dualModeBtn');
    if (dualModeBtn && !dualModeBtn.classList.contains('active')) {
      setDualGrid(true);
    }

    // Apply pattern to Grid B
    await applyPattern(pattern.data, gridB);

    // Clear Grid A so user can create their own melody
    clearGrid(gridA);
    gridA.copyGrid(gridB);
    gridA.reset();
    renderAllMeasures(gridA);

    // Select Grid A for the user to edit
    const gridATab = document.getElementById('gridA-tab');
    if (gridATab) gridATab.click();
  }
}

async function startAutoAdvanceRecording() {
  if (isListening) {
    turnOffMic();
    stop(gridA);
    if (gridB) stop(gridB);
    return;
  }

  // 1. Slow down the BPM for comfortable live recording
  gridA.setBpm(60);
  if (gridB) gridB.setBpm(60);

  // 2. Enable Metronome permanently to provide a rhythmic anchor
  const metroBtn = document.getElementById(`metroBtn-${gridA.id}`);
  if (metroBtn && !metroBtn.classList.contains('active')) {
    metroBtn.click();
  } else {
    // Fallback if metro button logic structure differs
    gridA.isMuted = false;
    // Attempting internal flag if click() isn't perfect
    document.getElementById(`metroBtn-${gridA.id}`)?.classList.add('active');
  }

  // 3. Turn on microphone for transcription
  await turnOnMic();

  // 4. Start playback (triggers noteplayer's countdown and subsequent auto-advance)
  start(gridA, true, false);
}

function renderStep4() {
  subtitle.textContent = "Step 4: Polish & Export";
  contentArea.innerHTML = `
    <div style="text-align: center; margin-top: 50px;">
      <h2 style="font-size: 24px;">Your Song is Ready</h2>
      <p style="color: var(--text-secondary);">Fine tune, save, or export your composition.</p>
    </div>
  `;
  nextBtn.textContent = 'Finish';
  nextBtn.onclick = () => {
    // Return to dashboard
    window.location.hash = '#dashboard';
  };
}

/**
 * Require at least one note on the grid before Next button is enabled
 * @param {*} btnId - The next-step number
 * @returns 
 */
function bindNextButtonToGrid(btnId) {
  const btn = document.getElementById(`cw-step${btnId}-next`);
  if (!btn) return;

  btn.disabled = true;
  btn.style.opacity = '0.5';

  const checkInterval = setInterval(() => {
    if (!document.getElementById(`cw-step${btnId}-next`)) {
      clearInterval(checkInterval);
      return;
    }
    const hasNotes = gridA.innerLabels.some(label => label !== '');
    if (hasNotes && btn.disabled) {
      btn.disabled = false;
      btn.style.opacity = '1';
    } else if (!hasNotes && !btn.disabled) {
      btn.disabled = true;
      btn.style.opacity = '0.5';
    }
  }, 500);
}
