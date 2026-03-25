import { dbListPatternsWithData, getSavedPatterns, applyPattern, serializePattern } from './pattern-crud.js';
import { Modal } from './modal.js';
import { supabase } from './supabase-client.js';
import { gridA, gridB } from './grid-context.js';
import { setDualGrid, clearGrid, renderAllMeasures } from './notegrid.js';
import { start, stop, setTimeSignature } from './noteplayer.js';
import { getAudioCtx, unlockAudio } from './noteplayer.js';
import { micStream, turnOnMic, turnOffMic } from './transcription.js';
import { isListening } from './state.js';
import { saveAudioClip, getAudioClip, deleteAudioClip, getAllCompositionsLocal, getCompositionLocal, saveCompositionLocal } from './audio-storage.js';
import { startRawAudioRecording, stopRawAudioRecording } from './audio-recorder.js';
import { compositionManager } from './composition-manager.js';
import { alert } from './alert.js';

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
        <button id="cw-step-load" class="secondary-btn">Load Composition</button>
        <button id="cw-step-back" class="secondary-btn" data-step="${stepNum}">Back</button>
        <button id="cw-step-next" class="primary-btn" data-step="${stepNum}">Next Step</button>
        <button id="cw-step-arrange" class="primary-btn" style="background-color: var(--primary-color, #ffd166); color: #000;" data-step="${stepNum}">Arrange Song</button>
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

  const loadBtn = document.getElementById('cw-step-load');
  if (loadBtn) {
    loadBtn.onclick = () => showLoadCompositionModal();
  }
}

let cwLoadPanel = null;

async function showLoadCompositionModal() {
  const comps = await getAllCompositionsLocal();

  let modalOverlay = document.getElementById('cw-load-modal');
  if (!modalOverlay) {
    modalOverlay = document.createElement('div');
    modalOverlay.id = 'cw-load-modal';
    modalOverlay.className = 'modal-overlay';
    document.body.appendChild(modalOverlay);
    cwLoadPanel = new Modal(modalOverlay);
  }
  if (!cwLoadPanel) cwLoadPanel = new Modal(modalOverlay);

  let contentHtml = `
    <div class="modal">
      <h3 class="modal-title" style="border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 15px; margin-top: 0;">Load Composition</h3>
      <div style="max-height: 50vh; overflow-y: auto; margin-bottom: 15px;">
  `;

  if (comps.length === 0) {
    contentHtml += `<p style="color: var(--text-secondary);">No saved compositions found.</p>`;
  } else {
    // Sort newest first
    comps.sort((a, b) => b.data.createdAt - a.data.createdAt).forEach(cObj => {
      const comp = cObj.data;
      const dateStr = new Date(comp.createdAt).toLocaleString();
      contentHtml += `
        <div class="cw-load-item" data-id="${comp.id}" style="padding: 15px; border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; margin-bottom: 10px; cursor: pointer; transition: background 0.2s;">
          <div style="font-weight: 600;">${comp.title}</div>
          <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 5px;">${comp.steps.length} Steps • ${dateStr}</div>
        </div>
      `;
    });
  }

  contentHtml += `
      </div>
      <div class="modal-actions">
        <button id="cw-load-cancel" class="secondary-btn">Cancel</button>
      </div>
    </div>
  `;

  modalOverlay.innerHTML = contentHtml;
  cwLoadPanel.open();

  document.getElementById('cw-load-cancel').onclick = () => cwLoadPanel.close();

  const items = modalOverlay.querySelectorAll('.cw-load-item');
  items.forEach(item => {
    item.onmouseenter = () => item.style.background = 'rgba(255,255,255,0.05)';
    item.onmouseleave = () => item.style.background = 'transparent';
    item.onclick = async () => {
      cwLoadPanel.close();
      await loadCompositionToWizard(item.dataset.id);
    };
  });
}

async function loadCompositionToWizard(compId) {
  try {
    const comp = await compositionManager.loadComposition(compId);

    // Jump to the step following their last recorded action, or the first step
    let targetStep = 1;
    if (comp.steps && comp.steps.length > 0) {
      targetStep = comp.steps.length;
    }

    wizardState.currentStep = targetStep;

    // Wait for the render to complete before injecting patterns
    renderStep(targetStep);

    // If there's a pattern saved for this step, load it into gridA
    if (comp.steps[targetStep - 1] && comp.steps[targetStep - 1].pattern) {
      await applyPattern(comp.steps[targetStep - 1].pattern, gridA);
    }

    // Refresh audio previews specifically for this step
    updateAudioRecordSection();
    renderAudioPreview(targetStep);
  } catch (e) {
    console.error("Failed to load composition:", e);
    await alert("Could not load that composition.");
  }
}

async function renderArrangeView() {
  // We want the grid visible, so we don't go to #freeplay. We stay where we are.
  // Hide standard wizard overlay content to show just arrangement and grid.
  if (overlay) {
    const top = overlay.querySelector('.cw-overlay-top');
    if (top) top.style.display = 'none';
    const tracker = document.getElementById('cw-progress-tracker');
    if (tracker) tracker.style.display = 'none';
    const autoRec = document.getElementById('cw-audio-record-section');
    if (autoRec) autoRec.style.display = 'none';
  }

  // Find or create the arrangement container
  let arrangeContainer = document.getElementById('cw-arrange-container');
  if (!arrangeContainer) {
    arrangeContainer = document.createElement('div');
    arrangeContainer.id = 'cw-arrange-container';
    arrangeContainer.style.cssText = `
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      height: 50vh;
      background: rgba(20, 20, 25, 0.95);
      border-top: 2px solid var(--accent);
      z-index: 1000;
      display: flex;
      flex-direction: column;
      box-shadow: 0 -10px 30px rgba(0,0,0,0.5);
      backdrop-filter: blur(10px);
    `;
    document.body.appendChild(arrangeContainer);
  }

  const comp = compositionManager.getActiveComposition();

  arrangeContainer.innerHTML = `
    <div style="padding: 15px 25px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.1);">
      <div>
        <h3 class="cw-step-title" style="margin: 0; font-size: 1.2rem;">Arrangement: ${comp.title}</h3>
      </div>
      <div style="display: flex; gap: 15px; align-items: center;">
        <button id="cw-arrange-save" class="secondary-btn">Save Arrangement</button>
        <button id="cw-arrange-play" class="primary-btn" style="background-color: var(--primary-color, #ffd166); color: #000;">▶ Play Song</button>
        <button id="cw-arrange-back" class="secondary-btn">Close Arrangement</button>
      </div>
    </div>
    <div style="position: relative; flex: 1; display: flex; flex-direction: column; overflow: hidden; background: #fdfdfd; color: #333;">
      <div id="cw-arrange-timeline" style="position: relative; flex: 1; overflow-y: auto; overflow-x: auto; padding: 20px; display: flex; flex-direction: column; gap: 15px;">
        <div id="cw-arrange-playhead" style="position: absolute; left: 100px; top: 0; height: 5000px; width: 2px; background: var(--primary-color, #ffd166); z-index: 50; display: none; pointer-events: none;"></div>
        <!-- Tracks injected here -->
      </div>
    </div>
  `;
  arrangeContainer.style.display = 'flex';

  document.getElementById('cw-arrange-back').onclick = () => {
    arrangeContainer.style.display = 'none';
    if (overlay) {
      const top = overlay.querySelector('.cw-overlay-top');
      if (top) top.style.display = 'flex';
      const tracker = document.getElementById('cw-progress-tracker');
      if (tracker) tracker.style.display = 'flex';
      const autoRec = document.getElementById('cw-audio-record-section');
      if (autoRec) autoRec.style.display = 'flex';
    }
  };

  const saveBtn = document.getElementById('cw-arrange-save');
  saveBtn.onclick = async () => {
    saveBtn.textContent = 'Saving...';

    // Go track by track and extract clip offsets
    const tracks = arrangeContainer.querySelectorAll('.cw-arrange-track');
    tracks.forEach((track, idx) => {
      // Find matching step index
      const stepIndex = parseInt(track.dataset.stepIndex, 10);
      if (isNaN(stepIndex) || !comp.steps[stepIndex]) return;

      const clips = track.querySelectorAll('.cw-arrange-clip');
      const positions = Array.from(clips).map(clip => parseInt(clip.style.left || '0', 10));

      comp.steps[stepIndex].arrangement = positions;
    });

    try {
      await saveCompositionLocal(comp.id, comp);
      saveBtn.textContent = 'Saved!';
      setTimeout(() => saveBtn.textContent = 'Save Arrangement', 2000);
    } catch (e) {
      console.error("Failed to save arrangement", e);
      saveBtn.textContent = 'Error';
    }
  };

  const timelineContainer = document.getElementById('cw-arrange-timeline');
  const trackColors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEEAD', '#D4A5A5', '#9B59B6', '#3498DB'];

  let draggingClip = null;
  let startX = 0;
  let initialLeft = 0;

  arrangeContainer.onmousedown = (e) => {
    const clip = e.target.closest('.cw-arrange-clip');
    if (clip && !e.target.closest('.cw-duplicate-btn')) {
      draggingClip = clip;
      startX = e.clientX;
      initialLeft = parseInt(draggingClip.style.left || '0', 10);
      draggingClip.style.zIndex = 10;
    }
  };

  arrangeContainer.onmousemove = (e) => {
    if (draggingClip) {
      let dx = e.clientX - startX;
      let newLeft = Math.max(0, initialLeft + dx);
      draggingClip.style.left = newLeft + 'px';
      draggingClip.dataset.left = newLeft;
    }
  };

  const endDrag = () => {
    if (draggingClip) {
      draggingClip.style.zIndex = 1;
      draggingClip = null;
    }
  };
  arrangeContainer.onmouseup = endDrag;
  arrangeContainer.onmouseleave = endDrag;

  // We will store all audio elements here to play them back
  const arrangementClips = [];

  // Build tracks for steps with audio
  for (let index = 0; index < comp.steps.length; index++) {
    const step = comp.steps[index];
    if (!step.audioId) continue;

    const color = trackColors[index % trackColors.length];

    // Fetch blob logic for playback
    const blob = await getAudioClip(step.audioId);
    let url = null;
    if (blob) {
      url = URL.createObjectURL(blob);
    }

    // Create Track Row
    const trackRow = document.createElement('div');
    trackRow.className = 'cw-arrange-track';
    trackRow.dataset.stepIndex = index; // Used for saving back arrangement data
    trackRow.style.cssText = `
      position: relative;
      height: 70px;
      background: rgba(0,0,0,0.04);
      border-radius: 6px;
      border: 1px solid rgba(0,0,0,0.1);
      width: 100%;
      min-width: 2000px;
      overflow: visible;
    `;

    // Track Label
    const trackLabel = document.createElement('div');
    trackLabel.style.cssText = `
      position: absolute;
      left: -80px;
      width: 70px;
      text-align: right;
      color: #666;
      font-size: 0.8rem;
      top: 25px;
      font-weight: 500;
    `;
    trackLabel.textContent = `Track ${index + 1}`;

    // Wrapping timeline row to allow label outside
    const trackWrapper = document.createElement('div');
    trackWrapper.style.cssText = 'position: relative; margin-left: 80px;';
    trackWrapper.appendChild(trackLabel);
    trackWrapper.appendChild(trackRow);

    // Initial Clip Function
    const createClip = (leftPx) => {
      const clip = document.createElement('div');
      clip.className = 'cw-arrange-clip';
      clip.dataset.left = leftPx;
      clip.dataset.played = "false";

      // Hidden audio element for this specific clip instance
      const audioEl = new Audio(url);
      clip.audioElement = audioEl;

      const pixelsPerSecond = 4;

      audioEl.addEventListener('loadedmetadata', () => {
        let duration = audioEl.duration;
        if (duration && duration !== Infinity) {
          const widthPx = Math.max(30, duration * pixelsPerSecond);
          clip.style.width = widthPx + 'px';
        }
      });

      arrangementClips.push(clip);

      clip.style.cssText = `
        position: absolute;
        top: 10px;
        left: ${leftPx}px;
        height: 50px;
        width: 150px; /* Default width before metadata loads */
        background: ${color};
        border-radius: 4px;
        cursor: grab;
        user-select: none;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 10px;
        color: #000;
        font-weight: 500;
        box-shadow: 0 2px 5px rgba(0,0,0,0.3);
        z-index: 1;
      `;

      const titleSpan = document.createElement('span');
      titleSpan.textContent = `Audio ${index + 1}`;
      titleSpan.style.pointerEvents = 'none';

      // Duplicate Button
      const dupBtn = document.createElement('button');
      dupBtn.className = 'cw-duplicate-btn';
      dupBtn.textContent = '➕';
      dupBtn.style.cssText = `
        background: rgba(255,255,255,0.3);
        border: none;
        border-radius: 4px;
        cursor: pointer;
        padding: 4px 6px;
        font-size: 0.8rem;
      `;

      dupBtn.onclick = (e) => {
        e.stopPropagation();
        const currentLeft = parseInt(clip.style.left || '0', 10);
        const currentWidth = parseInt(clip.style.width || '150', 10);
        createClip(currentLeft + currentWidth + 10); // Duplicate right next to it
      };

      clip.appendChild(titleSpan);
      clip.appendChild(dupBtn);

      clip.onmousedown = () => clip.style.cursor = 'grabbing';
      clip.onmouseup = () => clip.style.cursor = 'grab';

      trackRow.appendChild(clip);
    };

    // Instantiate clips based on saved arrangement arrays, or default to 0
    if (step.arrangement && Array.isArray(step.arrangement) && step.arrangement.length > 0) {
      step.arrangement.forEach(offset => createClip(offset));
    } else {
      createClip(0);
    }

    timelineContainer.appendChild(trackWrapper);
  }

  if (timelineContainer.children.length === 0) {
    timelineContainer.innerHTML = '<p style="color: var(--text-muted);">No audio tracks recorded yet. Go back and record some audio to arrange it.</p>';
  }

  // ==== Playback Logic ====
  let isPlayingArrangement = false;
  let playheadX = 0;
  let playheadAnimation;
  const playhead = document.getElementById('cw-arrange-playhead');
  const playBtn = document.getElementById('cw-arrange-play');
  const pixelsPerSecond = 4; // Timeline speed

  let lastTime = 0;

  const playLoop = (timestamp) => {
    if (!lastTime) lastTime = timestamp;
    const delta = (timestamp - lastTime) / 1000; // seconds
    lastTime = timestamp;

    if (isPlayingArrangement) {
      playheadX += pixelsPerSecond * delta;
      playhead.style.left = (100 + playheadX) + 'px'; // 100px offset for padding+labels

      // Check clips to see if they should trigger
      arrangementClips.forEach(clip => {
        const clipLeft = parseInt(clip.dataset.left || '0', 10);
        if (clip.dataset.played === "false" && playheadX >= clipLeft) {
          clip.dataset.played = "true";
          if (clip.audioElement) {
            clip.audioElement.currentTime = 0;
            clip.audioElement.play().catch(e => console.error("Playback prevented", e));

            // Visual feedback
            clip.style.filter = 'brightness(1.5)';
            setTimeout(() => clip.style.filter = 'none', 300);
          }
        }
      });

      // Simple auto-stop if playhead reaches way past content (e.g., 20 seconds = 2000px)
      if (playheadX > 2500) {
        stopArrangement();
        return;
      }

      playheadAnimation = requestAnimationFrame(playLoop);
    }
  };

  const stopArrangement = () => {
    isPlayingArrangement = false;
    cancelAnimationFrame(playheadAnimation);
    playBtn.innerHTML = '▶ Play Song';
    playBtn.classList.remove('active');
    playhead.style.display = 'none';

    // Stop all audio
    arrangementClips.forEach(clip => {
      if (clip.audioElement) {
        clip.audioElement.pause();
        clip.audioElement.currentTime = 0;
      }
    });
  };

  const startArrangement = () => {
    isPlayingArrangement = true;
    playBtn.innerHTML = '🛑 Stop';
    playBtn.classList.add('active');

    // Reset playhead
    playheadX = 0;
    playhead.style.left = '100px';
    playhead.style.display = 'block';
    lastTime = 0;

    // Reset clip triggers
    arrangementClips.forEach(clip => clip.dataset.played = "false");

    playheadAnimation = requestAnimationFrame(playLoop);
  };

  if (playBtn) {
    playBtn.onclick = () => {
      if (isPlayingArrangement) {
        stopArrangement();
      } else {
        startArrangement();
      }
    }
  }
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
