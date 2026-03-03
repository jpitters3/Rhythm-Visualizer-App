import { dbListPatternsWithData, getSavedPatterns, applyPattern, serializePattern } from './pattern-crud.js';
import { supabase } from './supabase-client.js';
import { gridA, gridB } from './grid-context.js';
import { setDualGrid, clearGrid, renderAllMeasures } from './notegrid.js';

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
let prevBtn, nextBtn;
let subtitle;

let isInitialized = false;

export function initComposeWizard() {
  if (isInitialized) return;
  isInitialized = true;

  viewCompose = document.getElementById('view-compose');
  if (!viewCompose) return;

  step1Dot = document.getElementById('cw-step-1-dot');
  step2Dot = document.getElementById('cw-step-2-dot');
  step3Dot = document.getElementById('cw-step-3-dot');
  contentArea = document.getElementById('cw-content-area');
  prevBtn = document.getElementById('cw-prev-btn');
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
  prevBtn.addEventListener('click', prevStep);
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
  // Update Header indicators
  step1Dot.style.background = stepIndex >= 1 ? 'var(--accent-glow)' : 'var(--panel-border)';
  step2Dot.style.background = stepIndex >= 2 ? 'var(--accent-glow)' : 'var(--panel-border)';
  step3Dot.style.background = stepIndex >= 3 ? 'var(--accent-glow)' : 'var(--panel-border)';

  // Reset content area styling if needed
  contentArea.innerHTML = '';
  prevBtn.style.display = stepIndex > 1 ? 'block' : 'none';
  nextBtn.style.display = 'block'; // Or hide based on validation later

  if (stepIndex === 1) {
    renderStep1();
  } else if (stepIndex === 2) {
    renderStep2();
  } else if (stepIndex === 3) {
    renderStep3();
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

  overlay.innerHTML = `
    <div>
      <h3 style="margin:0; font-size: 20px; color: var(--accent-glow);">The Creation Current</h3>
      <span style="font-size: 13px; color: var(--text-secondary);">
        Step 2: ${wizardState.flowChoice === 'rhythm-first' ? 'Add Melody over your Rhythm' : 'Add Rhythm over your Melody'}. 
        (💡 Use the Virtual Handpan to record)
      </span>
    </div>
    <div style="display:flex; gap: 15px; justify-content: space-between;">
      <button id="cw-step2-back" class="secondary-btn">Back to Step 1</button>
      <button id="cw-step2-finish" class="primary-btn">Finish (To Step 3)</button>
    </div>
  `;
  overlay.style.display = 'flex';

  document.getElementById('cw-step2-back').onclick = () => {
    overlay.style.display = 'none';
    window.location.hash = '#compose';
    viewCompose.style.display = 'block'; // Force visible since we navigated manually
    prevStep();
  };

  document.getElementById('cw-step2-finish').onclick = () => {
    // Capture what the user composed on gridA
    wizardState.overlaySequence = serializePattern(gridA);

    overlay.style.display = 'none';
    window.location.hash = '#compose';
    viewCompose.style.display = 'block';
    nextStep();
  };

  // Load Base Pattern into Grid B
  if (wizardState.basePatternId !== 'CREATE_NEW') {
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
  } else {
    // If they create new, ensure we're just acting on gridA
    setDualGrid(false);
  }
}

function renderStep3() {
  subtitle.textContent = "Step 3: Polish & Export";
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
