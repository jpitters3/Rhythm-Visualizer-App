/**
 * Coaching Mode - Real-time practice feedback system
 * Evaluates note accuracy and timing during pattern playback
 */

import { activeGrid } from './grid-context.js';
import { cells } from './notegrid.js';
import { start, stop, getVolume, setVolume, intervalMs, addTickObserver } from './noteplayer.js';
import { setIsListening } from './state.js';
import { supabase } from './supabase-client.js';
import { currentUser } from './state.js';
import { Bus, BUS_EVENT } from './bus.js';
import { AUDIO_DELAY } from './config.js';
import { TransportRegistry } from './transport-ui.js';
import { CoachingDiagnostics } from './coaching-diagnostics.js';
import { setInnerLabel, renderAllMeasures } from './notegrid.js';
import { CoachingSession } from './coaching-session.js';
import { getSelectedPatternName } from './pattern-crud.js';

// Session state
let coachingSession = null;
let isCoachingActive = false;
let isCoachingUIOpen = false; // New: Tracks if HUD is open but maybe not running
let isReviewActive = false; // New: Tracks if we are in review mode
let expectedNotes = []; // Array of { index, labels } from pattern
let sessionResults = []; // Array of evaluation results per step
let isLoopingEnabled = false; // Whether pattern should loop
let userTimingOffset = parseInt(localStorage.getItem('gp_timing_offset') || '0', 10); // User's timing calibration (ms)

// UI elements
let coachingHUD = null;
let hudAccuracy = null;
let hudCorrect = null;
let hudTotal = null;
let stopCoachingBtn = null;
let loopToggleBtn = null;
let resultsModal = null;

const TIMING_SCORE_GREAT = 70;
const TIMING_SCORE_GOOD = 50;

export { coachingSession, isCoachingActive, isReviewActive };

/**
 * Check if we are currently reviewing a session
 */
export function isReviewing() {
  return isReviewActive;
}

/**
 * Apply a manual or auto-detected timing calibration
 * @param {number} offsetMs - Milliseconds to adjust (Positive = User is late)
 */
export function applyCalibration(offsetMs) {
  userTimingOffset += offsetMs;
  localStorage.setItem('gp_timing_offset', userTimingOffset);
  console.log(`Coaching Mode: Applied timing offset ${offsetMs}ms. Total: ${userTimingOffset}ms`);
  return userTimingOffset;
}

/**
 * Get current timing offset
 */
export function getTimingOffset() {
  return userTimingOffset;
}

/**
 * Reset timing calibration
 */
export function resetCalibration() {
  userTimingOffset = 0;
  localStorage.setItem('gp_timing_offset', 0);
  return 0;
}


/**
 * Enter Coaching Mode (Show HUD, Ready State)
 * @param {Object} ctx - Grid context
 */
export function enterCoachingMode(ctx = activeGrid) {
  console.log('Coaching Mode: Entering UI');

  // Toggle behavior
  if (isCoachingUIOpen) {
    exitCoachingMode();
    return;
  }

  // Validate pattern has notes
  const hasNotes = ctx?.innerLabels?.some(label => label && label.length > 0);
  if (!hasNotes) {
    alert('Please add some notes to the pattern before starting coaching mode.');
    return;
  }

  isCoachingUIOpen = true;
  showCoachingHUD(true); // show as "Ready"
}

/**
 * Exit Coaching Mode (Hide HUD, Reset State)
 */
export function exitCoachingMode() {
  console.log('Coaching Mode: Exiting UI');

  // Stop if running
  if (isCoachingActive) {
    stop(activeGrid);
    isCoachingActive = false;
  }

  // Reset state
  coachingSession = null;
  isCoachingUIOpen = false;
  isReviewActive = false;

  // Hide UI
  if (coachingHUD) coachingHUD.style.display = 'none';
  if (resultsModal) {
    resultsModal.style.display = 'none';
    resultsModal.setAttribute('aria-hidden', 'true');
  }

  // Clear Grid
  clearCellHighlights(activeGrid);
}

/**
 * Start the actual coaching session (Playback + Recording)
 * @param {Object} ctx - Grid context (activeGrid)
 */
export async function startCoachingSession(ctx = activeGrid) {
  console.log('Coaching Mode: Starting session');
  console.log('Coaching Mode: Context ID:', ctx?.id);

  if (isCoachingActive) {
    console.warn('Coaching session already active');
    return;
  }

  // Disable review mode when starting new session
  isReviewActive = false;

  // Clear any existing cell highlights (including review highlights)
  clearCellHighlights(ctx);

  // Restore original grid state just in case (though clearCellHighlights helps)
  // We don't want to carry over red/blue/etc from previous review if any
  renderAllMeasures(ctx);

  // Initialize session
  coachingSession = new CoachingSession();

  // Build expected notes array
  expectedNotes = ctx.innerLabels.map((label, index) => ({
    index,
    labels: Array.isArray(label) ? label : (label ? [label] : [])
  }));

  // Count total notes
  coachingSession.totalNotes = expectedNotes.reduce((sum, step) => sum + step.labels.length, 0);

  // Reset results
  sessionResults = [];
  isCoachingActive = true;

  // Turn on metronome programmatically
  if (!ctx.metronomeOn) {
    ctx.metronomeOn = true;
    localStorage.setItem('groovepan_metro' + '-' + ctx.id, 'on');
    if (TransportRegistry) TransportRegistry.updateAll(ctx);
  }

  // Update HUD to "Running" state
  showCoachingHUD(false);

  // Register tick observer to detect loops
  const loopObserver = (grid, stepNotes, stepHands) => {
    // Detect when pattern loops back to start (step 0)
    if (grid.step === 0 && grid.transcriptionIndex === grid.cells.length - 1) {
      console.log('Coaching Mode: Pattern loop detected');

      if (isLoopingEnabled) {
        // Timing stays synced via grid.audioStartTime (updated automatically by noteplayer)
        coachingSession.loopCount++;
        console.log(`Coaching Mode: Multi-loop active - Starting Loop ${coachingSession.loopCount + 1}`);
      } else {
        // Auto-stop when looping is disabled
        console.log('Coaching Mode: Pattern complete, auto-stopping (looping disabled)');
        // Use setTimeout to avoid stopping mid-tick
        setTimeout(() => endCoachingSession(), 100);
      }
    }
  };

  // Store observer reference for cleanup
  coachingSession._loopObserver = loopObserver;

  // Register the observer
  addTickObserver(loopObserver);

  // Enable microphone if not already
  const micBtn = document.getElementById('micBtn');
  if (micBtn && !micBtn.classList.contains('active')) {
    micBtn.click();
    // Wait for mic to initialize
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Ensure isListening is true for countdown
  setIsListening(true);

  // Start playback
  start(ctx, true, false);
}

const PENDING_EVAL_WINDOW = 100; // ms to wait for a pitch after an accent
let pendingEvaluation = null; // { timeoutId, timestamp, type: 'ACCENT', stepIndex }

/**
 * Evaluate a detected note against expected note
 * Called from transcription loop
 * @param {string} detectedNote - Note label detected (e.g., 'D', '1', '2')
 * @param {number} stepIndex - Current step index in pattern
 * @param {number} actualTime - Timestamp when note was detected
 */
export function evaluateDetectedNote(detectedNote, stepIndex, actualTime) {
  console.log(`Coaching Mode: Evaluating triggered - note: ${detectedNote}, step: ${stepIndex}, active: ${isCoachingActive}`);
  if (!isCoachingActive || !coachingSession) {
    console.warn('Coaching Mode: Evaluation skipped - not active');
    return;
  }

  const ctx = activeGrid;
  const expected = expectedNotes[stepIndex];

  if (!expected || expected.labels.length === 0) {
    // No note expected at this step - could be a false positive
    return;
  }

  // Check if we have a pending ACCENT evaluation for this step
  if (pendingEvaluation && pendingEvaluation.stepIndex === stepIndex) {
    if (detectedNote !== 'ACCENT' && expected.labels.includes(detectedNote)) {
      // SUCCESS! We found the pitch we were looking for.
      console.log(`Coaching Mode: Resolved Pending Accent -> Found Note ${detectedNote}`);
      clearTimeout(pendingEvaluation.timeoutId);

      // Use the timestamp of the ORIGINAL Accent (the attack) for timing accuracy
      const attackTime = pendingEvaluation.timestamp;
      pendingEvaluation = null;

      // Proceed to evaluate with the correct note and the accurate attack time
      performEvaluation(detectedNote, stepIndex, attackTime, expected);
      return;
    }
  }

  // --- PREVENT OVERWRITE OF SUCCESSFUL EVALUATIONS ---
  // If we already marked this step as CORRECT, ignore subsequent inputs 
  // (unless we are refining ACCENT -> Pitch, which is handled above or here if pending cleared)
  const existingResult = sessionResults.find(r => r.stepIndex === stepIndex);
  if (existingResult && existingResult.correct) {
    // Step already passed!

    // EXCEPTION: Refinement
    // If we passed with 'ACCENT' but now have the actual 'NOTE', we might want to update it 
    // just for display accuracy, but we definitely shouldn't fail it.
    const isRefinement = (existingResult.detectedNote === 'ACCENT' && detectedNote !== 'ACCENT' && expected.labels.includes(detectedNote));

    if (!isRefinement) {
      console.log(`Coaching Mode: Step ${stepIndex} already correct (${existingResult.detectedNote}). Ignoring subsequent detection (${detectedNote}).`);
      return;
    }
  }

  // Normal Flow
  if (detectedNote === 'ACCENT') {
    const expectsPitch = expected.labels.some(l => l !== 'T' && l !== 'S' && l !== 'ACCENT');

    if (expectsPitch) {
      // We expect a pitch, but got an accent. 
      // This might be the attack of the note. Wait briefly.
      console.log("Coaching Mode: Detected ACCENT but expecting Pitch. Buffering...");

      if (pendingEvaluation) clearTimeout(pendingEvaluation.timeoutId);

      pendingEvaluation = {
        stepIndex,
        timestamp: actualTime,
        type: 'ACCENT',
        timeoutId: setTimeout(() => {
          console.log("Coaching Mode: Pending Accent Timed Out. Committing Accent.");
          pendingEvaluation = null;
          performEvaluation('ACCENT', stepIndex, actualTime, expected);
        }, PENDING_EVAL_WINDOW)
      };
      return; // Wait for timeout or new note
    }
  }

  // If we aren't buffering, just evaluate
  performEvaluation(detectedNote, stepIndex, actualTime, expected);
}

function performEvaluation(detectedNote, stepIndex, actualTime, expected) {
  const ctx = activeGrid;
  const msPerStep = intervalMs(ctx);

  // Apply User Timing Offset (Calibration)
  // Use the high-precision audio clock reference stored in the grid context
  const audioStartMs = (ctx.audioStartTime || 0) * 1000;
  const expectedTime = audioStartMs + (stepIndex * msPerStep) + userTimingOffset;

  console.log("Expected Time (Audio Clock):", expectedTime);
  console.log("Actual Time (Audio Clock):", actualTime, "User Timing Offset:", userTimingOffset);

  // Evaluate note
  const result = evaluateNote(detectedNote, expected.labels, {
    actual: actualTime,
    expected: expectedTime
  });

  // Store result
  sessionResults.push({
    stepIndex,
    detectedNote,
    expectedNotes: expected.labels,
    ...result
  });

  // Update session stats
  if (result.correct) {
    coachingSession.correctNotes++;
  }

  // Record for Diagnostics
  if (coachingSession.diagnostics) {
    coachingSession.diagnostics.record({
      stepIndex,
      expected: expected.labels,
      detected: detectedNote,
      correct: result.correct,
      timingError: result.timingError,
      timingDeviation: result.timingDeviation // Signed deviation
    });
  }

  // Visual feedback
  highlightCell(stepIndex, result, ctx);

  // Update HUD
  updateHUD();
}

/**
 * Evaluate note accuracy and timing
 * @param {string} detectedNote - Detected note label
 * @param {Array} expectedNotes - Array of expected note labels
 * @param {Object} timing - { actual, expected } timestamps
 * @returns {Object} Evaluation result
 */
function evaluateNote(detectedNote, expectedNotes, timing) {
  // Note accuracy - handle accent notes specially
  let noteMatch = false;

  if (detectedNote === 'ACCENT') {
    // If user played an accent, check if T or S was expected
    noteMatch = expectedNotes.includes('T') || expectedNotes.includes('S');
  } else {
    // Normal pitch-based note matching
    noteMatch = expectedNotes.includes(detectedNote);
  }

  const noteScore = noteMatch ? 100 : 0;

  // Timing accuracy (±200ms tolerance, normalized to 0-100 scale)
  const timingDeviation = timing.actual - timing.expected; // Signed deviation
  const timingError = Math.abs(timingDeviation);
  const timingScore = Math.max(0, 100 - (timingError / 2));

  // Combined score (70% note, 30% timing)
  const overallScore = (noteScore * 0.7) + (timingScore * 0.3);

  // Determine correctness (note must match AND timing within 200ms)
  const correct = noteMatch && timingError < 200;
  // const correct = noteMatch && timingScore > 50;

  console.log(`Coaching Mode: Evaluation result - note: ${detectedNote}, expected: ${expectedNotes}, 
    correct: ${correct}, timingError: ${timingError}, deviation: ${timingDeviation}, timingScore: ${timingScore}`);

  return {
    correct,
    noteScore,
    timingScore,
    timingError,
    timingDeviation,
    overallScore,
    feedback: getFeedback(noteMatch, timingError)
  };
}

/**
 * Get human-readable feedback
 */
function getFeedback(noteMatch, timingError) {
  if (!noteMatch) {
    return 'Wrong note';
  }
  if (timingError > 100) {
    return 'Right note, wrong timing';
  }
  return 'Perfect!';
}

/**
 * Highlight cell based on evaluation result
 */
function highlightCell(cellIndex, result, ctx) {
  const cellList = cells(ctx);
  const cell = cellList[cellIndex];

  if (!cell) return;

  // Remove existing coaching classes
  cell.classList.remove('coach-correct', 'coach-timing', 'coach-wrong');

  // Add appropriate class
  if (result.correct) {
    cell.classList.add('coach-correct');
  } else if (result.noteScore === 100) {
    cell.classList.add('coach-timing'); // Right note, wrong time
  } else {
    cell.classList.add('coach-wrong');
  }
}

/**
 * Clear all cell highlights
 */
function clearCellHighlights(ctx) {
  const cellList = cells(ctx);
  cellList.forEach(cell => {
    cell.classList.remove('coach-correct', 'coach-timing', 'coach-wrong');
  });
}

/**
 * Show coaching HUD
 * @param {boolean} isReady - If true, show "Start" button. If false, show "Stop".
 */
function showCoachingHUD(isReady = false) {
  if (!coachingHUD) {
    coachingHUD = document.getElementById('coachingHUD');
    hudAccuracy = document.getElementById('hudAccuracy');
    hudCorrect = document.getElementById('hudCorrect');
    hudTotal = document.getElementById('hudTotal');
    stopCoachingBtn = document.getElementById('stopCoachingBtn');

    // Create the button if it doesn't exist (it should)
    // We will dynamically change its text and onclick
  }

  // Update Button Logic
  if (stopCoachingBtn) {
    // Remove old listeners to be safe (by cloning)
    const newBtn = stopCoachingBtn.cloneNode(true);
    stopCoachingBtn.parentNode.replaceChild(newBtn, stopCoachingBtn);
    stopCoachingBtn = newBtn;

    if (isReady) {
      stopCoachingBtn.textContent = "Start";
      stopCoachingBtn.style.backgroundColor = "var(--success)"; // Green
      stopCoachingBtn.onclick = () => startCoachingSession(activeGrid);
    } else {
      stopCoachingBtn.textContent = "Stop";
      stopCoachingBtn.style.backgroundColor = ""; // Default (usually red/warn)
      stopCoachingBtn.onclick = endCoachingSession;
    }
  }

  // Inject Loop Toggle if missing
  if (coachingHUD && !coachingHUD.querySelector('.hud-loop-toggle')) {
    const loopToggle = document.createElement('div');
    loopToggle.className = 'hud-loop-toggle';
    loopToggle.innerHTML = `
      <button id="loopToggleBtn" class="hud-loop-btn" title="Toggle looping">
        <span class="loop-icon">🔁</span>
        <span class="loop-text">Loop: Off</span>
      </button>
    `;
    // Insert before stop button
    if (stopCoachingBtn) {
      coachingHUD.insertBefore(loopToggle, stopCoachingBtn);
    } else {
      coachingHUD.appendChild(loopToggle);
    }

    // Add listener
    setTimeout(() => {
      loopToggleBtn = document.getElementById('loopToggleBtn');
      if (loopToggleBtn) {
        loopToggleBtn.addEventListener('click', () => {
          isLoopingEnabled = !isLoopingEnabled;
          loopToggleBtn.classList.toggle('active', isLoopingEnabled);
          const loopText = loopToggleBtn.querySelector('.loop-text');
          if (loopText) {
            loopText.textContent = isLoopingEnabled ? 'Loop: On' : 'Loop: Off';
          }
        });
      }
    }, 0);
  }

  // Inject Mixer Controls if missing
  if (coachingHUD && !coachingHUD.querySelector('.hud-mix-controls')) {
    const mixControls = document.createElement('div');
    mixControls.className = 'hud-mix-controls';
    mixControls.innerHTML = `
        <div class="mix-slider">
          <span class="mix-icon" title="Instrument Volume">🎵</span>
          <input type="range" min="0" max="1" step="0.1" value="${getVolume('instrument')}" id="hud-vol-inst">
        </div>
        <div class="mix-slider">
          <span class="mix-icon" title="Metronome Volume">⏱️</span>
          <input type="range" min="0" max="1" step="0.1" value="${getVolume('metronome')}" id="hud-vol-metro">
        </div>
      `;
    // Insert before loop toggle or stop button
    const loopToggle = coachingHUD.querySelector('.hud-loop-toggle');
    if (loopToggle) {
      coachingHUD.insertBefore(mixControls, loopToggle);
    } else if (stopCoachingBtn) {
      coachingHUD.insertBefore(mixControls, stopCoachingBtn);
    } else {
      coachingHUD.appendChild(mixControls);
    }

    // Add listeners
    setTimeout(() => {
      const iVol = document.getElementById('hud-vol-inst');
      const mVol = document.getElementById('hud-vol-metro');
      if (iVol) iVol.addEventListener('input', (e) => setVolume('instrument', parseFloat(e.target.value)));
      if (mVol) mVol.addEventListener('input', (e) => setVolume('metronome', parseFloat(e.target.value)));
    }, 0);
  }

  // Inject "Results" button (hidden by default)
  if (coachingHUD && !coachingHUD.querySelector('#hudResultsBtn')) {
    const resultsBtn = document.createElement('button');
    resultsBtn.id = 'hudResultsBtn';
    resultsBtn.className = 'hud-stop'; // Re-use style
    resultsBtn.style.marginTop = '8px';
    resultsBtn.style.backgroundColor = 'var(--primary)';
    resultsBtn.style.color = 'black';
    resultsBtn.style.display = 'block'; // Always show
    resultsBtn.textContent = '📓 Results';
    resultsBtn.onclick = () => {
      showResultsModal();
    };
    coachingHUD.appendChild(resultsBtn);
  }

  if (coachingHUD) {
    coachingHUD.style.display = 'block';
    updateHUD();
  }
}

/**
 * Update HUD with current stats
 */
function updateHUD() {
  if (!coachingSession) return;

  const evaluated = sessionResults.length;
  const accuracy = evaluated > 0
    ? Math.round((coachingSession.correctNotes / evaluated) * 100)
    : 0;

  if (hudAccuracy) hudAccuracy.textContent = accuracy + '%';
  if (hudCorrect) hudCorrect.textContent = coachingSession.correctNotes;
  if (hudTotal) hudTotal.textContent = evaluated;
}

/**
 * End coaching session and show results
 */
export function endCoachingSession() {
  if (!isCoachingActive || !coachingSession) return;

  // Stop playback
  stop(activeGrid);

  // Mark session end time
  coachingSession.endTime = Date.now();

  // Calculate final scores
  calculateFinalScores();

  // Reset state BUT keep UI open
  isCoachingActive = false;
  isCoachingUIOpen = true;

  // AUTO-ENTER REVIEW MODE
  isReviewActive = true;

  // Show HUD in "Ready" state (Start button)
  showCoachingHUD(true);

  // Load results to grid immediately (Review Mode)
  loadSessionToGrid(coachingSession);

  // Show results modal
  showResultsModal();

  // Auto-save if it's a real session
  if (coachingSession && coachingSession.isRealSession) {
    saveCoachingSession();
  }
}

/**
 * Calculate final session scores
 */
function calculateFinalScores() {
  if (!coachingSession) return;

  // 1. Backfill Missed Notes
  // Iterate through all expected notes to see if we have a result for them
  expectedNotes.forEach(expected => {
    // Skip ghost notes / unlabelled steps
    if (!expected.labels || expected.labels.length === 0 || (expected.labels.length === 1 && expected.labels[0] === '')) {
      return;
    }

    // Check if we have a result for this step
    const hasResult = sessionResults.some(r => r.stepIndex === expected.index);

    if (!hasResult) {
      // No detection happened for this step -> MISS
      sessionResults.push({
        stepIndex: expected.index,
        detectedNote: 'MISS',
        expectedNotes: expected.labels,
        correct: false,
        timingScore: 0,
        overallScore: 0,
        timingError: null
      });

      if (coachingSession.diagnostics) {
        coachingSession.diagnostics.record({
          stepIndex: expected.index,
          expected: expected.labels,
          detected: 'MISS',
          correct: false,
          timingError: null
        });
      }
    }
  });

  // Sort results by step index for easier reading
  sessionResults.sort((a, b) => a.stepIndex - b.stepIndex);

  const totalEvaluated = sessionResults.length;

  if (totalEvaluated === 0) return;

  // Note accuracy
  coachingSession.correctNotes = sessionResults.filter(r => r.correct).length;
  coachingSession.noteAccuracy = Math.round(
    (coachingSession.correctNotes / totalEvaluated) * 100
  );

  // Timing accuracy (average of all timing scores)
  // Missed notes have 0 timing score, which correctly penalizes the average
  const avgTimingScore = sessionResults.reduce((sum, r) => sum + r.timingScore, 0) / totalEvaluated;
  coachingSession.timingAccuracy = Math.round(avgTimingScore);

  // Overall score (average of all overall scores)
  const avgOverallScore = sessionResults.reduce((sum, r) => sum + r.overallScore, 0) / totalEvaluated;
  coachingSession.overallScore = Math.round(avgOverallScore);

  // Identify problem measures (< 70% accuracy)
  identifyProblemMeasures();

  // Store results in session
  coachingSession.noteResults = sessionResults;
  coachingSession.totalNotes = totalEvaluated; // Should match expectedNotes.length now
}

/**
 * Identify measures with < 70% accuracy
 */
function identifyProblemMeasures() {
  const ctx = activeGrid;
  const stepsPerMeasure = ctx.STEPS;
  const measureCount = Math.ceil(expectedNotes.length / stepsPerMeasure);

  const measureScores = [];

  for (let m = 0; m < measureCount; m++) {
    const startStep = m * stepsPerMeasure;
    const endStep = Math.min(startStep + stepsPerMeasure, expectedNotes.length);

    const measureResults = sessionResults.filter(r =>
      r.stepIndex >= startStep && r.stepIndex < endStep
    );

    if (measureResults.length > 0) {
      const correctInMeasure = measureResults.filter(r => r.correct).length;
      const accuracy = (correctInMeasure / measureResults.length) * 100;

      measureScores.push({ measure: m + 1, accuracy });

      if (accuracy < 70) {
        coachingSession.problemMeasures.push(m + 1);
      }
    }
  }
}

/**
 * Show results modal (Centered initially)
 */
function showResultsModal() {
  resultsModal = document.getElementById('coachingResultsModal');
  if (!resultsModal) return;

  const modalHeader = resultsModal.querySelector('.modal-header');

  // Reset to centered mode if opening fresh
  resultsModal.classList.remove('sidebar-active');
  const modalContent = resultsModal.querySelector('.coaching-results-modal');
  if (modalContent) {
    modalContent.classList.remove('sidebar-mode');

    // Inject Close/Minimize buttons if not present
    if (!modalContent.querySelector('.results-header-actions')) {
      const actions = document.createElement('div');
      actions.className = 'results-header-actions';
      actions.innerHTML = `
            <button class="result-header-action" data-action="minimize" title="Minimize to Sidebar">↘</button>
            <button class="result-header-action" data-action="close" title="Close">✕</button>
          `;
      modalContent.prepend(actions);

      actions.querySelector('.result-header-action[data-action="minimize"]').onclick = minimizeResults;
      actions.querySelector('.result-header-action[data-action="close"]').onclick = dismissResults;
    }

    // Inject Sidebar Tabs if not present
    if (!modalContent.querySelector('.sidebar-tabs')) {
      const tabs = document.createElement('div');
      tabs.className = 'sidebar-tabs';
      tabs.innerHTML = `
            <button class="sidebar-tab active" data-tab="result">Current Result</button>
            <button class="sidebar-tab" data-tab="history">History</button>
            <button class="sidebar-tab" data-tab="settings">Settings</button>
          `;

      const existingChildren = Array.from(modalContent.children).filter(c => !c.classList.contains('results-header-actions'));

      const resultTabContent = document.createElement('div');
      resultTabContent.id = 'tab-result';
      resultTabContent.className = 'sidebar-content active';

      existingChildren.forEach(child => resultTabContent.appendChild(child));

      const historyTabContent = document.createElement('div');
      historyTabContent.id = 'tab-history';
      historyTabContent.className = 'sidebar-content';
      historyTabContent.innerHTML = `<div id="historyList" class="history-list"></div>`;

      const settingsTabContent = document.createElement('div');
      settingsTabContent.id = 'tab-settings';
      settingsTabContent.className = 'sidebar-content';
      settingsTabContent.innerHTML = `
        <div class="settings-panel" style="padding: 15px; color: var(--text-primary);">
            <h3 style="margin-top: 0; color: var(--text-secondary); text-transform: uppercase; font-size: 0.9em; letter-spacing: 1px;">Timing Calibration</h3>
            <p style="font-size: 0.9em; color: var(--text-secondary); margin-bottom: 15px;">
                Adjust if notes consistently feel early or late.
            </p>
            
            <div style="background: rgba(255,255,255,0.05); padding: 15px; border-radius: 12px; text-align: center; margin-bottom: 15px;">
                <div style="font-size: 0.85em; color: var(--text-secondary); margin-bottom: 10px;">Note vs. Accent Strictness</div>
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px;">
                    <span style="font-size:0.8em; opacity:0.7;">Forgiving</span>
                    <input type="range" id="clarityThresholdSlider" min="0.3" max="0.7" step="0.05" style="flex:1">
                    <span style="font-size:0.8em; opacity:0.7;">Strict</span>
                </div>
            </div>

            <div style="background: rgba(255,255,255,0.05); padding: 15px; border-radius: 12px; text-align: center;">
                <div style="font-size: 0.85em; color: var(--text-secondary); margin-bottom: 10px;">Current Offset</div>
                <div id="timingOffsetDisplay" style="font-size: 2em; font-weight: bold; color: var(--primary); margin-bottom: 15px;">${userTimingOffset}ms</div>
                
                <div style="display: flex; justify-content: center; gap: 10px; margin-bottom: 15px;">
                    <button id="btn-cal-minus" style="padding: 8px 16px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: var(--text-primary); border-radius: 8px; cursor: pointer;">-10ms</button>
                    <button id="btn-cal-plus" style="padding: 8px 16px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: var(--text-primary); border-radius: 8px; cursor: pointer;">+10ms</button>
                </div>

                <button id="btn-cal-reset" style="width: 100%; padding: 10px; background: transparent; border: 1px solid var(--error-color, #ff4444); color: var(--error-color, #ff4444); border-radius: 8px; cursor: pointer; transition: all 0.2s;">
                    Reset Calibration
                </button>
            </div>
        </div>
      `;

      modalContent.appendChild(tabs);
      modalContent.appendChild(resultTabContent);
      modalContent.appendChild(historyTabContent);
      modalContent.appendChild(settingsTabContent);

      // Attach Event Listeners for Settings
      setTimeout(() => {
        // Calibration Buttons
        const updateDisplay = () => {
          const disp = document.getElementById('timingOffsetDisplay');
          if (disp) disp.textContent = getTimingOffset() + 'ms';
        };

        const btnMinus = settingsTabContent.querySelector('#btn-cal-minus');
        if (btnMinus) btnMinus.onclick = () => { applyCalibration(-10); updateDisplay(); };

        const btnPlus = settingsTabContent.querySelector('#btn-cal-plus');
        if (btnPlus) btnPlus.onclick = () => { applyCalibration(10); updateDisplay(); };

        const btnReset = settingsTabContent.querySelector('#btn-cal-reset');
        if (btnReset) btnReset.onclick = () => { resetCalibration(); updateDisplay(); };

        // Accent Sensitivity Slider
        const slider = settingsTabContent.querySelector('#clarityThresholdSlider');
        if (slider) {
          // Read current value from localStorage (shared with transcription.js)
          slider.value = localStorage.getItem('gp_clarity_threshold') || 0.5;

          slider.oninput = (e) => {
            const val = parseFloat(e.target.value);
            Bus.emit(BUS_EVENT.SET_ACCENT_SENSITIVITY, { threshold: val });
          };
        }
      }, 0);

      // Tab Logic
      tabs.querySelectorAll('.sidebar-tab').forEach(tab => {
        tab.onclick = () => {
          // Remove active
          tabs.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
          modalContent.querySelectorAll('.sidebar-content').forEach(c => c.classList.remove('active'));

          // Set active
          tab.classList.add('active');
          const target = tab.dataset.tab;
          document.getElementById(`tab-${target}`).classList.add('active');

          if (target === 'history') {
            renderHistoryList();
          } else if (target === 'settings') {
            // Refresh display on tab switch
            const disp = document.getElementById('timingOffsetDisplay');
            if (disp) disp.textContent = getTimingOffset() + 'ms';
          }
        };
      });
    }
  }

  if (!coachingSession) {
    coachingSession = new CoachingSession();
    endCoachingSession();
    coachingSession.isRealSession = false;
  }

  // Populate scores
  const overallScoreEl = document.getElementById('overallScore');
  const noteAccuracyEl = document.getElementById('noteAccuracy');
  const timingAccuracyEl = document.getElementById('timingAccuracy');

  if (overallScoreEl) overallScoreEl.textContent = coachingSession.overallScore + '%';
  if (noteAccuracyEl) noteAccuracyEl.textContent = coachingSession.noteAccuracy + '%';
  if (timingAccuracyEl) timingAccuracyEl.textContent = coachingSession.timingAccuracy + '%';

  // Show problem measures
  const problemList = document.getElementById('problemMeasuresList');
  if (problemList) {
    if (coachingSession.problemMeasures.length > 0) {
      problemList.innerHTML = coachingSession.problemMeasures
        .map(m => `<div class="problem-measure">Measure ${m}</div>`)
        .join('');
    } else {
      problemList.innerHTML = '<div class="no-problems">Great job! No problem areas detected.</div>';
    }
  }

  // --- COACH'S TIPS (Diagnostics) ---
  // We need to inject a container for tips if it doesn't represent
  // Ideally, valid HTML structure should be present, or we create it.

  // Let's assume we modify the modal HTML structure or inject it here.
  // We'll inspect the modal structure first or just append it to results-summary

  let tipsContainer = document.getElementById('coachingTipsContainer');

  if (!tipsContainer) {
    const resultsContent = resultsModal.querySelector('.results-summary');
    if (resultsContent) {
      // Use innerHTML/insertAdjacentHTML for consistency
      const containerHTML = `
        <div id="coachingTipsContainer" class="coaching-tips-container" 
             style="margin-top: 20px; padding: 15px; background: rgba(255, 255, 255, 0.05); border-radius: 12px; display: none;">
        </div>
      `;
      resultsContent.insertAdjacentHTML('beforeend', containerHTML);
      tipsContainer = document.getElementById('coachingTipsContainer');

      // Event Delegation
      tipsContainer.addEventListener('click', (e) => {
        if (e.target.matches('button[data-action="CALIBRATE"]')) {
          const val = parseInt(e.target.dataset.value, 10);
          applyCalibration(val);
          e.target.disabled = true;
          e.target.textContent = 'Fixed!';
        }
      });
    }
  }

  if (tipsContainer) {
    const suggestions = coachingSession.diagnostics ? coachingSession.diagnostics.analyze() : [];

    if (suggestions.length > 0) {
      tipsContainer.style.display = 'block';

      let listHTML = `<h4 style="margin-top:0; margin-bottom:10px; color:var(--text-secondary); font-size:0.9em; text-transform:uppercase; letter-spacing:1px;">💡 Coach's Tips</h4>
                      <ul class="coaching-tips-list" style="margin:0; padding-left:20px; color:var(--text-primary);">`;

      suggestions.forEach(s => {
        const text = typeof s === 'string' ? s : s.text;
        const action = typeof s === 'object' ? s.action : null;

        listHTML += `<li style="margin-bottom:5px; display: flex; align-items: center; justify-content: space-between;">
                        <span>${text}</span>`;

        if (action && action.type === 'CALIBRATE') {
          listHTML += `<button data-action="CALIBRATE" data-value="${action.value}"
                          style="margin-left: 10px; background: var(--primary); border: none; color: white; padding: 2px 8px; border-radius: 4px; cursor: pointer; font-size: 0.8em;">
                          ${action.label}
                        </button>`;
        }

        listHTML += `</li>`;
      });

      listHTML += `</ul>`;
      tipsContainer.innerHTML = listHTML;

    } else {
      tipsContainer.style.display = 'none';
    }
  }

  // Show
  resultsModal.style.display = 'flex';

  // Setup overlay click to minimize (not close)
  resultsModal.onclick = (e) => {
    if (e.target === resultsModal) {
      minimizeResults();
    }
  };

  // --- COACH'S TIPS (Diagnostics) ---
  // (Already handled above)

  // Show/Hide save button based on auth
  const saveSessionBtn = document.getElementById('saveSessionBtn');
  if (saveSessionBtn) {
    if (!currentUser) {
      saveSessionBtn.style.display = 'none';
      // Optionally show a "Login to Save" hint
      const hint = document.createElement('div');
      hint.id = 'saveHint';
      hint.className = 'save-hint';
      hint.textContent = '💡 Sign in to save your progress!';
      hint.style.fontSize = '12px';
      hint.style.marginTop = '10px';
      if (!document.getElementById('saveHint')) {
        saveSessionBtn.parentNode.appendChild(hint);
      }
    } else {
      saveSessionBtn.style.display = 'block';
      const hint = document.getElementById('saveHint');
      if (hint) hint.remove();
    }
  }

  // Add celebration animation based on score
  const score = coachingSession.overallScore;
  const resultsContainer = resultsModal.querySelector('.results-summary');
  resultsContainer.classList.remove('score-excellent', 'score-good', 'score-decent', 'score-needs-work');

  // Remove any existing celebration elements
  const existingCelebration = resultsContainer.querySelector('.celebration-container');
  if (existingCelebration) existingCelebration.remove();

  // Create celebration element
  const celebration = document.createElement('div');
  celebration.className = 'celebration-container';

  if (score >= 90) {
    celebration.innerHTML = '<div class="celebration-emoji">🎉</div>';
    celebration.classList.add('celebration-excellent');
    resultsContainer.classList.add('score-excellent');
  } else if (score >= 80) {
    celebration.innerHTML = '<div class="thumbs-up-emoji">👍</div>';
    celebration.classList.add('celebration-good');
    resultsContainer.classList.add('score-good');
  } else if (score >= 60) {
    celebration.innerHTML = '<div class="encouragement-emoji">💪</div>';
    celebration.classList.add('celebration-keep-trying');
    resultsContainer.classList.add('score-decent');
  } else {
    celebration.innerHTML = '<div class="try-again-emoji">🔄</div>';
    celebration.classList.add('celebration-try-again');
    resultsContainer.classList.add('score-needs-work');
  }

  // Insert before score circle
  const scoreCircle = resultsContainer.querySelector('.score-circle');
  if (scoreCircle) {
    resultsContainer.insertBefore(celebration, scoreCircle);
  }

  // Show
  resultsModal.style.display = 'flex';

  // Setup overlay click to minimize (not close)
  resultsModal.onclick = (e) => {
    if (e.target === resultsModal) {
      minimizeResults();
    }
  };
}

/**
* Close results modal (Minimize to sidebar)
*/
export function closeResultsModal() {
  minimizeResults();
}

/**
* Minimize results to sidebar
*/
function minimizeResults() {
  if (!resultsModal) return;

  // Add classes for sidebar mode
  resultsModal.classList.add('sidebar-active'); // Removes overlay background

  const modalContent = resultsModal.querySelector('.coaching-results-modal');
  if (modalContent) {
    modalContent.classList.add('sidebar-mode');
  }
}

/**
* Fully dismiss results
*/
function dismissResults() {
  if (resultsModal) {
    resultsModal.style.display = 'none';
    resultsModal.classList.remove('sidebar-active');
    const modalContent = resultsModal.querySelector('.coaching-results-modal');
    if (modalContent) modalContent.classList.remove('sidebar-mode');
  }

  // EXIT REVIEW MODE
  if (isReviewActive) {
    isReviewActive = false;
    clearCellHighlights(activeGrid);
    // Restore original colors/state
    renderAllMeasures(activeGrid);
  }
}


/**
 * Save session to database
 */
export async function saveCoachingSession() {
  if (!coachingSession || !currentUser) {
    console.warn('No session to save or user not logged in');
    return;
  }

  // Visual Feedback immediately
  const saveBtn = document.getElementById('saveSessionBtn');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
  }

  try {
    const { error } = await supabase
      .from('practice_history')
      .insert({
        user_id: currentUser.id,
        pattern_name: getSelectedPatternName() || 'Unknown Pattern',
        bpm: coachingSession.bpm,
        total_notes: coachingSession.totalNotes,
        correct_notes: coachingSession.correctNotes,
        note_accuracy: coachingSession.noteAccuracy,
        timing_accuracy: coachingSession.timingAccuracy,
        overall_score: coachingSession.overallScore,
        note_results: coachingSession.noteResults,
        problem_measures: coachingSession.problemMeasures
      });

    if (error) throw error;

    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saved ✓';
      saveBtn.classList.add('saved'); // For styling
    }

    // Refresh history list if open
    renderHistoryList();

  } catch (err) {
    console.error('Error saving session:', err);
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Session';
      alert('Failed to save session. Please try again.');
    }
  }
}

/**
 * Fetch practice history for current user
 */
export async function fetchHistory() {
  if (!currentUser) return [];

  try {
    const { data, error } = await supabase
      .from('practice_history')
      .select('*')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    return data;
  } catch (err) {
    console.error('Error fetching history:', err);
    return [];
  }
}

/**
 * Render history list in sidebar
 */
export async function renderHistoryList() {
  const listContainer = document.getElementById('historyList');
  if (!listContainer) return;

  listContainer.innerHTML = '<div class="loading-spinner">Loading...</div>';

  const history = await fetchHistory();
  listContainer.innerHTML = '';

  if (history.length === 0) {
    listContainer.innerHTML = '<div class="no-history">No sessions recorded yet.</div>';
    return;
  }

  history.forEach(data => {
    // Convert raw DB data to CoachingSession object
    const session = new CoachingSession(data);

    const date = new Date(session.createdAt).toLocaleDateString();
    const scoreClass = session.overallScore >= 90 ? 'score-excellent' :
      session.overallScore >= 80 ? 'score-good' :
        session.overallScore >= 60 ? 'score-decent' : 'score-needs-work';

    const item = document.createElement('div');
    item.className = 'history-item';
    item.innerHTML = `
            <div class="history-score ${scoreClass}">${session.overallScore}%</div>
            <div class="history-details">
                <div class="history-pattern">${session.patternName}</div>
                <div class="history-meta">${date} • ${session.bpm} BPM</div>
            </div>
            <button class="history-load-btn" title="Load Results">▶</button>
        `;

    item.onclick = () => loadSessionToGrid(session);
    listContainer.appendChild(item);
  });
}

/**
 * Load a past session to the grid
 */
export function loadSessionToGrid(session) {
  if (!activeGrid) return;

  // 1. Clear current visuals
  clearCellHighlights(activeGrid);

  // 2. Clear content (We are rebuilding the 'Review View')
  // We want the grid to show what happened in THIS session
  isReviewActive = true; // Enable Review Mode restrictions

  // const cellsLength = activeGrid.cells.length;
  // for (let i = 0; i < cellsLength; i++) {
  //   setInnerLabel(i, '', activeGrid); // Clear labels
  // }

  // 3. Rebuild from Results
  // We iterate through the results (which now cover ALL expected notes including misses)
  const results = session.noteResults;
  if (results && Array.isArray(results)) {
    results.forEach(r => {
      const idx = r.stepIndex;
      const cell = activeGrid.cells[idx]; // Use direct access assuming cells is populated

      // Restore the label (Expected Note)
      // If it was a miss, we still show what SHOULD have been there
      const labels = r.expectedNotes;
      if (labels && labels.length > 0) {
        // Use the first label if multiple (simplification for now)
        // Or use the full array if your grid supports it
        setInnerLabel(idx, labels.length === 1 ? labels[0] : labels, activeGrid);
      }

      if (cell) {
        // Apply Scoring Class
        cell.classList.remove('coach-correct', 'coach-timing', 'coach-wrong', 'coach-missed');

        if (r.detectedNote === 'MISS') {
          cell.classList.add('coach-missed');
        } else if (r.correct) {
          cell.classList.add('coach-correct');
        } else if (r.timingScore > 70 && !r.correct) {
          // If !correct, it's a wrong note or timing was WAY off (accents)
          cell.classList.add('coach-wrong');
        } else {
          cell.classList.add('coach-wrong');
        }

        // Timing specific override (yellow)
        if (r.correct && r.timingScore < TIMING_SCORE_GREAT) {
          cell.classList.remove('coach-correct');
          cell.classList.add('coach-timing');
        }
      }
    });
  }

  // Update Coaching Session State to match this historical session
  // This allows the "Result" tab to show the details of THIS session
  coachingSession = new CoachingSession(session);

  // Switch to Results Tab
  showResultsModal();
  // Ensure we are in sidebar mode if not already
  minimizeResults();

  // Update HUD Results to match
  updateHUD();
}



/**
 * Initialize coaching mode UI
 */
export function initCoachingMode() {
  console.log('Coaching Mode: Initializing UI listeners');
  // Coach Mode button
  const coachModeBtn = document.getElementById('coachModeBtn');
  coachModeBtn?.addEventListener('click', () => {
    enterCoachingMode(activeGrid);
  });

  // Close HUD Button
  const closeHudBtn = document.getElementById('closeCoachingHUDBtn');
  closeHudBtn?.addEventListener('click', exitCoachingMode);

  const practiceAgainBtn = document.getElementById('practiceAgainBtn');
  practiceAgainBtn?.addEventListener('click', () => {
    if (resultsModal) {
      resultsModal.style.display = 'none';
      resultsModal.setAttribute('aria-hidden', 'true');
    }
    clearCellHighlights(activeGrid);
    startCoachingSession(activeGrid);
  });

  const saveSessionBtn = document.getElementById('saveSessionBtn');
  saveSessionBtn?.addEventListener('click', saveCoachingSession);

  // Listen for bus evaluation (for testing or other integrations)
  Bus.on(BUS_EVENT.COACHING_EVALUATE, (e) => {
    let { note, step, time } = e.detail || {};
    step = activeGrid.transcriptionIndex;
    if (note !== undefined && step !== undefined) {
      evaluateDetectedNote(note, step, time || Date.now());
    }
  });
}

/**
 * Check if coaching mode is active
 */
export function isCoaching() {
  return isCoachingActive;
}

/**
 * Get feedback reason for a specific step index
 * @param {number} stepIndex 
 * @returns {string|null} Feedback text or null if no issue
 */
export function getFeedbackForStep(stepIndex) {
  if (!coachingSession || !coachingSession.noteResults) return null;

  // Find result for this step
  const result = coachingSession.noteResults.find(r => r.stepIndex === stepIndex);

  if (!result) return "No Data";

  if (result.detectedNote === 'MISS') {
    return "Missed Note";
  }

  if (!result.correct) {
    if (result.timingScore > 0 && result.noteScore === 0) {
      return `Wrong Note (Played: ${result.detectedNote})`;
    } else if (result.timingScore === 0 && result.noteScore > 0) {
      // Fallback, though usually handled by timing deviation logic below
      return "Timing too off";
    } else {
      return "Wrong Note & Timing";
    }
  }

  let feedback = "";

  // If correct but timing specific (Yellow)
  if (result.correct && result.timingScore >= TIMING_SCORE_GREAT) {
    feedback = "Great!";
  } else if (result.correct && result.timingScore >= TIMING_SCORE_GOOD) {
    feedback = "Good! ";
  } else if (result.correct && result.timingScore < TIMING_SCORE_GOOD) {
    feedback = "Try to be more accurate! ";
  }

  const deviation = result.timingDeviation;
  // if (deviation !== undefined && deviation > 20 && deviation < -20) {
  if (deviation !== undefined && deviation !== 0 && result.timingScore < TIMING_SCORE_GREAT) {
    if (deviation < 0) feedback += `Early by (${Math.abs(deviation)}ms)`;
    else if (deviation > 0) feedback += `Late by (${deviation}ms)`;
  }
  return feedback;
}

/**
 * Show feedback tooltip on a cell
 * @param {HTMLElement} element - The cell element
 * @param {string} text - Feedback text
 */
export function showFeedbackTooltip(element, text) {
  if (!element || !text) return;

  // Remove existing tooltips
  document.querySelectorAll('.coaching-feedback-tooltip').forEach(el => el.remove());

  const tooltip = document.createElement('div');
  tooltip.className = 'coaching-feedback-tooltip';
  tooltip.textContent = text;

  document.body.appendChild(tooltip);

  const rect = element.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();

  // Position above the cell
  let top = rect.top - tooltipRect.height - 10;
  let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);

  // Keep on screen
  if (top < 10) top = rect.bottom + 10;
  if (left < 10) left = 10;
  if (left + tooltipRect.width > window.innerWidth) left = window.innerWidth - tooltipRect.width - 10;

  // Position
  tooltip.style.position = 'fixed';
  tooltip.style.top = `${top}px`;
  tooltip.style.left = `${left}px`;
  tooltip.style.zIndex = '10000';

  // Auto-remove after 2 seconds or click elsewhere (handled by body click normally, but here just timer)
  setTimeout(() => {
    tooltip.classList.add('fade-out');
    setTimeout(() => tooltip.remove(), 300);
  }, 2000);
}

