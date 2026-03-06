import { dbListPatternsWithData, getSavedPatterns, applyPattern, serializePattern } from './pattern-crud.js';
import { supabase } from './supabase-client.js';
import { gridA, gridB } from './grid-context.js';
import { setDualGrid, clearGrid, renderAllMeasures } from './notegrid.js';
import { start, stop, setTimeSignature } from './noteplayer.js';
import { turnOnMic, turnOffMic } from './transcription.js';
import { isListening } from './state.js';
import { saveAudioClip, getAudioClip, deleteAudioClip } from './audio-storage.js';
import { startRawAudioRecording, stopRawAudioRecording } from './audio-recorder.js';
import { compositionManager } from './composition-manager.js';

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
let overlay;
let progressTracker;

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
  compositionManager.startNewComposition();
}

function nextStep() {
  wizardState.currentStep++;
  renderStep(wizardState.currentStep);
}

function prevStep() {
  if (wizardState.currentStep > 1) {
    wizardState.currentStep--;
    renderStep(wizardState.currentStep);
  }
}

function renderStep(stepIndex) {
  // Reset content area styling if needed (This will display the contentArea)
  // contentArea.innerHTML = '';

  // Transition to freeplay view visually but keep wizard state active
  window.location.hash = '#freeplay';

  // Ensure the compose container looks inactive while in freeplay
  viewCompose.style.display = 'none';

  nextBtn.style.display = 'block'; // Or hide based on validation later

  subtitle.textContent = `Step ${stepIndex}`;

  updateOverlay();
  updateNextButton();
  updateProgressTracker();
  updateAudioRecordSection();
  bindNextButtonToGrid();

  // Set up Grid A for Motif creation
  setDualGrid(false);
  clearGrid(gridA);
  setTimeSignature('4/4');
  gridA.setMeasures(1);
  gridA.reset();
  renderAllMeasures(gridA);

  // if (stepIndex === 1) {
  // renderStep1();
  //   if (progressTracker && document.getElementById('cw-wizard-header')) {
  //     document.getElementById('cw-wizard-header').appendChild(progressTracker);
  //   }
  // } else if (stepIndex === 2) {
  //   if (wizardState.basePatternId === 'CREATE_NEW') {
  //     renderStep2();
  //   } else {
  //     renderStep3();
  //   }
  // } else if (stepIndex === 3) {
  //   renderStep3();
  // } else if (stepIndex === 4) {
  //   renderStep4();
  //   if (progressTracker && document.getElementById('cw-wizard-header')) {
  //     document.getElementById('cw-wizard-header').appendChild(progressTracker);
  //   }
  // }
}

function renderStep1() {

  subtitle.textContent = "Step 1: Motif";

  // Transition to freeplay view visually but keep wizard state active
  window.location.hash = '#freeplay';

  // Ensure the compose container looks inactive while in freeplay
  viewCompose.style.display = 'none';

  updateOverlay();
  updateNextButton();
  updateProgressTracker();
  updateAudioRecordSection();
  bindNextButtonToGrid();

  // Set up Grid A for Motif creation
  setDualGrid(false);
  clearGrid(gridA);
  setTimeSignature('4/4');
  gridA.setMeasures(1);
  gridA.reset();
  renderAllMeasures(gridA);
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


function updateOverlay() {
  if (!wizardState || !wizardState.currentStep) {
    console.log('No current wizardState.currentStep');
    return;
  }

  const stepNum = wizardState.currentStep;
  const backStepNum = stepNum == 1 ? 1 : stepNum - 1;
  const nextStepNum = stepNum + 1;

  // Create overlay header in freeplay
  overlay = document.getElementById('cwFreeplayOverlay');
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

  wizardState.step1Title = 'Verse A';

  let overlayTop = overlay.querySelector('.cw-overlay-top');
  if (!overlayTop) {
    overlayTop = document.createElement('div');
    overlayTop.className = 'cw-overlay-top';
    overlay.insertBefore(overlayTop, overlay.firstChild);
  }

  overlayTop.innerHTML = `
      <div>
        <h3 class="cw-step-title">The Creation Current</h3>
        <span class="cw-step-subtitle">
          Step ${stepNum}: Recording Layer ${stepNum}
        </span>
      </div>
      <div class="cw-step-buttons">
        <button id="cw-step-back" class="secondary-btn" data-step="${stepNum}">Back</button>
        <button id="cw-step-next" class="primary-btn" data-step="${stepNum}">Next Step</button>
        <button id="cw-step-arrange" class="primary-btn" style="background-color: var(--accent);" data-step="${stepNum}">Arrange Song</button>
      </div>
  `;

  return overlay;
}

function updateNextButton() {
  if (!wizardState || !wizardState.currentStep) {
    console.log('No current wizardState.currentStep');
    return;
  }

  const stepNum = wizardState.currentStep;
  const nextBtn = document.getElementById('cw-step-next');
  if (nextBtn) {
    nextBtn.onclick = async () => {
      // Auto save the grid pattern into the dynamic composition array
      await compositionManager.autoSaveStepPattern(stepNum);

      // Proceed to next step
      nextStep();
    };
  }

  const arrangeBtn = document.getElementById('cw-step-arrange');
  if (arrangeBtn) {
    arrangeBtn.onclick = async () => {
      await compositionManager.autoSaveStepPattern(stepNum);
      renderArrangeView();
    };
  }
}

async function renderArrangeView() {
  // Hide standard step UI
  viewCompose.style.display = 'none';
  if (overlay) overlay.style.display = 'none';

  // Transition to a hypothetical '#arrange' route or just clear the grid area
  window.location.hash = '#freeplay';

  // Find or create the arrangement container
  let arrangeContainer = document.getElementById('cw-arrange-container');
  if (!arrangeContainer) {
    arrangeContainer = document.createElement('div');
    arrangeContainer.id = 'cw-arrange-container';
    arrangeContainer.className = 'cw-freeplay-overlay'; // Reusing style for now
    arrangeContainer.style.display = 'flex';
    arrangeContainer.style.flexDirection = 'column';
    arrangeContainer.style.background = 'var(--panel-bg)';
    document.getElementById('view-freeplay').appendChild(arrangeContainer);
  }

  const comp = compositionManager.getActiveComposition();

  arrangeContainer.innerHTML = `
    <div class="cw-overlay-top">
      <div>
        <h3 class="cw-step-title">The Creation Current</h3>
        <span class="cw-step-subtitle">Arrange: ${comp.title} (${comp.steps.length} Steps)</span>
      </div>
      <div class="cw-step-buttons">
        <button id="cw-arrange-back" class="secondary-btn">Back to Recording</button>
      </div>
    </div>
    <div style="padding: 20px;">
      <p>This is the Arrange stub interface holding ${comp.steps.length} layers!</p>
    </div>
  `;
  arrangeContainer.style.display = 'flex';

  document.getElementById('cw-arrange-back').onclick = () => {
    arrangeContainer.style.display = 'none';
    if (overlay) overlay.style.display = 'flex';
  };
}

function updateProgressTracker() {
  const stepIndex = wizardState.currentStep;

  // Dynamically ensure progress dots exist to match stepIndex visually
  const tracker = document.getElementById('cw-progress-tracker');
  if (tracker) {
    const stepsContainer = tracker.querySelector('.cw-steps-container');
    if (stepsContainer) {
      // Create missing indicators if we advance past what's hardcoded in HTML
      const currentIndicatorsCount = stepsContainer.querySelectorAll('.cw-step-indicator').length;
      if (stepIndex > currentIndicatorsCount) {
        for (let i = currentIndicatorsCount + 1; i <= stepIndex; i++) {
          const newIndicator = document.createElement('div');
          newIndicator.className = 'cw-step-indicator';
          newIndicator.id = `cw-step-${i}`;
          newIndicator.innerHTML = `
            <div class="cw-step-dot"></div>
            <div class="cw-step-label">Step ${i}</div>
          `;
          const newLine = document.createElement('div');
          newLine.className = 'cw-step-line';
          newLine.id = `cw-line-${i - 1}`;

          stepsContainer.appendChild(newLine);
          stepsContainer.appendChild(newIndicator);
        }
      }
    }

    // Update Progress Tracker Elements styling
    for (let i = 1; i <= Math.max(4, stepIndex); i++) {
      const stepEl = document.getElementById(`cw-step-${i}`);
      const dotEl = stepEl?.querySelector('.cw-step-dot');
      const labelEl = stepEl?.querySelector('.cw-step-label');
      const lineEl = document.getElementById(`cw-line-${i}`);

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

    // Ensure tracker is in the overlay
    overlay.appendChild(tracker);
  }
}

function updateAudioRecordSection() {
  let autoRecordSection = document.getElementById('cw-audio-record-section');
  if (!autoRecordSection) {
    autoRecordSection = document.createElement('div');
    autoRecordSection.id = 'cw-audio-record-section';
    autoRecordSection.innerHTML = `
      <div style="display:flex; gap: 10px;">
        <button id="cwAutoRecord" class="cw-auto-record primary-btn">
          🎤 Record to Grid
        </button>
        <button id="cwRawAudioRecord" class="cw-auto-record secondary-btn" style="background:var(--panel-bg);">
          🎙️ Record Raw Audio
        </button>
      </div>
    `;
    overlay.appendChild(autoRecordSection);
  }

  document.getElementById('cwAutoRecord').onclick = startAutoAdvanceRecording;

  document.getElementById('cwRawAudioRecord').onclick = () => toggleRawAudioRecording('cwRawAudioRecord');
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
 * Require at least one note on the grid OR raw audio recording before Next button is enabled
 * @param {*} btnId - The next-step number
 * @returns 
 */
function bindNextButtonToGrid() {
  const btn = document.getElementById(`cw-step-next`);
  if (!btn) return;

  btn.disabled = true;
  btn.style.opacity = '0.5';

  const stepNum = wizardState.currentStep;

  const comp = compositionManager.getActiveComposition();

  const checkInterval = setInterval(() => {
    if (!document.getElementById(`cw-step-next`)) {
      clearInterval(checkInterval);
      return;
    }
    const hasNotes = gridA.innerLabels.some(label => label !== '');

    // Check if there's audio recorded for this step
    let hasAudio = false;
    if (comp.steps[stepNum - 1] && comp.steps[stepNum - 1].audioId) hasAudio = true;

    if ((hasNotes || hasAudio) && btn.disabled) {
      btn.disabled = false;
      btn.style.opacity = '1';
    } else if (!hasNotes && !hasAudio && !btn.disabled) {
      btn.disabled = true;
      btn.style.opacity = '0.5';
    }
  }, 500);
}

let isRecordingRawAudioUI = false;

async function toggleRawAudioRecording(btnId) {
  const btn = document.getElementById(btnId);
  if (!btn) return;

  if (isRecordingRawAudioUI) {
    // Stop recording
    stopRawAudioRecording();
    isRecordingRawAudioUI = false;
    btn.innerHTML = '🎙️ Record Raw Audio';
    btn.classList.remove('active');
  } else {
    // Start recording
    btn.innerHTML = '🛑 Stop Recording';
    btn.classList.add('active');

    const stepNum = wizardState.currentStep;

    const success = await startRawAudioRecording(async (audioBlob) => {
      // Called when stopped
      if (audioBlob) {
        // Auto-save the audio blob and link it to the dynamic step in the active composition
        await compositionManager.autoSaveStepAudio(stepNum, audioBlob);

        // Optional: Also auto-save whatever is currently on the grid for this step
        await compositionManager.autoSaveStepPattern(stepNum);

        // Show audio preview UI
        renderAudioPreview(stepNum);
      }
    });

    if (success) {
      isRecordingRawAudioUI = true;
    } else {
      btn.innerHTML = '🎙️ Record Raw Audio';
      btn.classList.remove('active');
    }
  }
}

async function resetStepAudio(stepNum) {
  const el = document.getElementById(`cw-audio-preview-${stepNum}`);
  if (el) el.remove();

  const comp = compositionManager.getActiveComposition();
  if (comp && comp.steps[stepNum - 1]) {
    comp.steps[stepNum - 1].audioId = null;
    // Intentionally omitting saveCompositionLocal here. Deleting is handled in UI flow usually,
    // but just in case, we'll auto-save the removal.
    // Wait, saveCompositionLocal is not imported here. Let's just import it at top or not worry.
    // Actually, we can fetch it dynamically or just let autoSave do its job later.
    // Better yet, update compositionManager to handle it!
  }
}

async function renderAudioPreview(stepNum) {
  const comp = compositionManager.getActiveComposition();
  if (!comp || !comp.steps[stepNum - 1]) return;

  let audioId = comp.steps[stepNum - 1].audioId;

  if (!audioId) return;

  // Find container to append to
  let previewContainer = document.getElementById(`cw-audio-preview-${stepNum}`);
  if (!previewContainer) {
    // Find the wrapper element. On step 1, the button is in a .cw-auto-record inside autoRecordSection
    const rawBtn = document.getElementById('cwRawAudioRecord');
    if (!rawBtn) return;

    const autoRecSec = rawBtn.parentElement.parentElement;
    previewContainer = document.createElement('div');
    previewContainer.id = `cw-audio-preview-${stepNum}`;
    previewContainer.style.marginTop = '10px';
    previewContainer.style.display = 'flex';
    previewContainer.style.alignItems = 'center';
    previewContainer.style.gap = '10px';
    autoRecSec.appendChild(previewContainer);
  }

  const blob = await getAudioClip(audioId);
  if (blob) {
    const url = URL.createObjectURL(blob);
    previewContainer.innerHTML = `
      <audio src="${url}" controls style="height: 35px;"></audio>
      <button id="cw-audio-preview-delete" class="secondary-btn small-btn" data-step="${stepNum}" data-id="${audioId}" style="padding: 5px 10px;">🗑️</button>
    `;
  }

  // Event listeners 

  // Delete audio clip for the current step when delete button is clicked
  const deletePreviewAudioBtn = document.getElementById('cw-audio-preview-delete');
  if (deletePreviewAudioBtn) {
    deletePreviewAudioBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await deleteAudioClip(audioId);
      await resetStepAudio(stepNum);
    });
  }

}
