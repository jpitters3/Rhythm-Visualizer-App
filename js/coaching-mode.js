/**
 * Coaching Mode - Real-time practice feedback system
 * Evaluates note accuracy and timing during pattern playback
 */

import { activeGrid, getCurrentScaleId, currentUser, isCalibrationMode } from './state.js';
import { start, stop, getVolume, setVolume, intervalMs, addTickObserver, removeTickObserver } from './noteplayer.js';
import { supabase } from './supabase-client.js';
import { Bus, BUS_EVENT } from './bus.js';
import { AUDIO_DELAY } from './config.js';
import { TransportRegistry } from './transport-ui.js';
import { CoachingDiagnostics } from './coaching-diagnostics.js';
import { setInnerLabel, renderAllMeasures, cells } from './notegrid.js';
import { CoachingSession } from './coaching-session.js';
import { getSelectedPatternName } from './pattern-crud.js';
import { loadCalibrationProfile, hasCalibrationForCurrentScale, turnOnMic, micStream, turnOffMic } from './transcription.js';
import { updateBodySidebarClass, closeSidebar } from './courses.js';

// Session state
let coachingSession = null;
let isCoachingActive = false;
let isCoachingUIOpen = false; // New: Tracks if HUD is open but maybe not running
let isReviewActive = false; // New: Tracks if we are in review mode
let expectedNotes = []; // Array of { index, labels } from pattern
let sessionResults = []; // Array of evaluation results per step
let sessionLogs = []; // Array of { step, msg, time } for diagnostics
let isLoopingEnabled = false; // Whether pattern should loop
let userTimingOffset = parseInt(localStorage.getItem('gp_timing_offset') || '0', 10); // User's timing calibration (ms)
let gridLabels;

// Phase 35: Calibration Skip Flag
let skipCalibrationCheck = {}; // scaleId -> true

// UI elements
let coachingSidebar = null;
let hudAccuracy = null;
let hudCorrect = null;
let hudTotal = null;
let stopCoachingBtn = null;
let loopToggleBtn = null;
let resultsModal = null;

// Results Sidebar elements
let coachResultsSidebar = null;
let sidebarOverallScore = null;
let sidebarNoteAccuracy = null;
let sidebarTimingAccuracy = null;
let sidebarProblemMeasuresList = null;
let sidebarCoachingTipsContainer = null;
let closeResultsSidebarBtn = null;
let sidebarPlayReviewBtn = null;
let sidebarPracticeAgainBtn = null;
let sidebarSaveSessionBtn = null;

const TIMING_SCORE_GREAT = 70;
const TIMING_SCORE_GOOD = 50;

export { coachingSession, isCoachingActive, isReviewActive, gridLabels };

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
  showCoachingSidebar(true); // show as "Ready"
}

export function openCoachingSidebar() {
  // Mutual exclusivity: Close other sidebars
  closeSidebar();

  if (!coachingSidebar) {
    coachingSidebar = document.getElementById('coachingSidebar');
    const closeBtn = document.getElementById('closeCoachingSidebar');
    if (closeBtn) closeBtn.onclick = exitCoachingMode;
  }
  
  if (coachingSidebar) {
    coachingSidebar.classList.add('open');
    coachingSidebar.setAttribute('aria-hidden', 'false');
  }
  updateBodySidebarClass();
}

/**
 * Close Coaching Sidebar specifically
 */
export function closeCoachingSidebar() {
  if (coachingSidebar) {
    coachingSidebar.classList.remove('open');
    coachingSidebar.setAttribute('aria-hidden', 'true');
  }
  updateBodySidebarClass();
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

  // Hide sidebars
  closeCoachingSidebar();
  closeCoachResultsSidebar();

  // Clear Grid
  clearCellHighlights(activeGrid);
}



// Redundant buffering removed - handled in transcription.js

export function evaluateDetectedNote(detectedNote, stepIndex, hitTime) {
  if (!isCoachingActive || !coachingSession) return;

  // --- SMART STEP-AWARE SEARCH (The "Human" Ear) ---
  // The handpan resonance and our 100ms buffer can push detections past the beat.
  // We now search adjacent steps to find the most likely intended target.
  const ctx = activeGrid;
  const msPerStep = intervalMs(ctx);
  const audioStartMs = (ctx.audioStartTime || 0) * 1000;
  const timingOffset = getTimingOffset();

  let bestStep = stepIndex;
  let minError = Infinity;
  let foundIntendedMatch = false;

  // Search Range: ±1 step is usually enough at 70-100 BPM
  for (let i = stepIndex - 1; i <= stepIndex + 1; i++) {
    if (i < 0 || i >= expectedNotes.length) continue;
    const exp = expectedNotes[i];
    if (!exp || exp.labels.length === 0) continue;

    // Check if what we heard matches what this step wants
    const isMatch = (detectedNote === 'ACCENT')
      ? (exp.labels.includes('T') || exp.labels.includes('S'))
      : exp.labels.includes(detectedNote);

    if (isMatch) {
      // The audio plays precisely AUDIO_DELAY seconds *after* the raw schedule time.
      const expTime = audioStartMs + (i * msPerStep) + timingOffset + (AUDIO_DELAY * 1000);
      const error = Math.abs(hitTime - expTime);

      // If it's a logical match and within a 400ms "forgiveness" window
      if (error < 400 && error < minError) {
        minError = error;
        bestStep = i;
        foundIntendedMatch = true;
      }
    }
  }

  // If we found a clear match on an adjacent step, re-route it
  if (foundIntendedMatch && bestStep !== stepIndex) {
    console.log(`[Coaching] Smart Search: Re-routing ${detectedNote} from Step ${stepIndex} -> ${bestStep} (Diff: ${minError.toFixed(0)}ms)`);
    stepIndex = bestStep;
  }

  const expected = expectedNotes[stepIndex];
  if (!expected || expected.labels.length === 0) {
    console.log(`[Coaching] No candidate found for ${detectedNote} near Step ${stepIndex}. Ignoring.`);
    return;
  }

  // Prevent overwrite of successful evaluations
  const existingResult = sessionResults.find(r => r.stepIndex === stepIndex);
  if (existingResult && existingResult.correct) return;

  // Normal Flow
  performEvaluation(detectedNote, stepIndex, hitTime, expected);
}

function performEvaluation(detectedNote, stepIndex, actualTime, expected) {
  const ctx = activeGrid;
  const msPerStep = intervalMs(ctx);

  // Apply User Timing Offset (Calibration)
  const audioStartMs = (ctx.audioStartTime || 0) * 1000; // UNIT FIX: Convert to ms
  const expectedTime = audioStartMs + (stepIndex * msPerStep) + getTimingOffset() + (AUDIO_DELAY * 1000);

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

  // Timing accuracy (±200ms tolerance, normalized)
  // COMPENSATE: Subtract 100ms "Thinking Time" from the actual detection
  // This ensures perfect hits stay perfect despite the app's buffer.
  const timingDeviation = timing.actual - timing.expected;
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
 * UI: Inject Loop Toggle
 */
function injectLoopToggle() {

  // Inject Loop Toggle if missing
  if (coachingSidebar && !coachingSidebar.querySelector('.hud-loop-toggle')) {
    const loopToggle = document.createElement('div');
    loopToggle.className = 'hud-loop-toggle';
    loopToggle.innerHTML = `
      <button id="loopToggleBtn" class="hud-loop-btn" title="Toggle looping">
        <span class="loop-icon">🔁</span>
        <span class="loop-text">Loop: Off</span>
      </button>
    `;
    // Insert before stop button
    const content = coachingSidebar.querySelector('.sidebar-content');
    if (stopCoachingBtn && content) {
      content.insertBefore(loopToggle, stopCoachingBtn);
    } else if (content) {
      content.appendChild(loopToggle);
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
}

/**
 * UI: Inject In-place Volume/Mix controls
 * This allows users to adjust handpan vs grid volume while practicing
 */
function injectCoachMixControls() {
  if (coachingSidebar && !coachingSidebar.querySelector('.hud-mix-controls')) {
    const mixControls = document.createElement('div');
    mixControls.className = 'hud-mix-controls';
    mixControls.innerHTML = `
      <div class="mix-row">
        <span>Mic</span>
        <input type="range" class="hud-vol-input" id="coachMicVol" min="0" max="1.5" step="0.1" value="1">
      </div>
      <div class="mix-row">
        <span>Grid</span>
        <input type="range" class="hud-vol-input" id="coachGridVol" min="0" max="1" step="0.1" value="${getVolume()}">
      </div>
    `;

    const stopCoachingBtn = document.getElementById('stopCoachingBtn');
    const loopToggle = coachingSidebar.querySelector('.hud-loop-toggle');
    const content = coachingSidebar.querySelector('.sidebar-content');

    if (loopToggle && content) {
      content.insertBefore(mixControls, loopToggle);
    } else if (stopCoachingBtn && content) {
      content.insertBefore(mixControls, stopCoachingBtn);
    } else if (content) {
      content.appendChild(mixControls);
    }

    // Bind listeners
    document.getElementById('coachMicVol')?.addEventListener('input', (e) => {
      // Logic for mic gain could go here
    });
    document.getElementById('coachGridVol')?.addEventListener('input', (e) => {
      setVolume(parseFloat(e.target.value));
    });
  }
}

/**
 * UI: Inject "View Results" button into HUD
 */
function injectResultsButton() {
  if (coachingSidebar && !coachingSidebar.querySelector('#hudResultsBtn')) {
    const resultsBtn = document.createElement('button');
    resultsBtn.id = 'hudResultsBtn';
    resultsBtn.className = 'secondary-btn';
    resultsBtn.style.marginTop = '12px';
    resultsBtn.style.width = '100%';
    resultsBtn.textContent = '📊 View Results';
    resultsBtn.onclick = () => showFinalResults(coachingSession);
    const content = coachingSidebar.querySelector('.sidebar-content');
    if (content) content.appendChild(resultsBtn);
  }
}
function showCoachingSidebar(isReady = false) {
  if (!coachingSidebar) {
    coachingSidebar = document.getElementById('coachingSidebar');
    hudAccuracy = document.getElementById('hudAccuracy');
    hudCorrect = document.getElementById('hudCorrect');
    hudTotal = document.getElementById('hudTotal');
    stopCoachingBtn = document.getElementById('stopCoachingBtn');
  }

  // Ensure sidebar is open
  openCoachingSidebar();

  // Update Button Logic
  if (stopCoachingBtn) {
    if (isReady) {
      stopCoachingBtn.textContent = "Start";
      stopCoachingBtn.style.backgroundColor = "var(--btn-active)"; // Match theme active color
      stopCoachingBtn.onclick = () => startCoachingSession(activeGrid);
    } else {
      stopCoachingBtn.textContent = "Stop";
      stopCoachingBtn.style.backgroundColor = ""; // Default
      stopCoachingBtn.onclick = endCoachingSession;
    }
  }

  // Inject sub-components if missing
  injectLoopToggle();
  injectCoachMixControls();

  if (coachingSidebar) {
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

  turnOffMic();

  // Phase 3: Stop Audio Recording
  if (sessionRecorder && sessionRecorder.state !== 'inactive') {
    sessionRecorder.stop();
  }

  // Remove tick observer to prevent leaks
  if (coachingSession._loopObserver) {
    removeTickObserver(coachingSession._loopObserver);
    delete coachingSession._loopObserver;
  }

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
  showCoachingSidebar(true);

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
 * Show results (Now directly opens sidebar)
 */
function showResultsModal() {
  isReviewActive = true;
  openCoachResultsSidebar();
}

/**
 * Apply dynamic background colors and icons based on score
 * @param {HTMLElement} container - The .results-summary container
 * @param {number} score - The overall accuracy score
 */
function applyScoreAesthetics(container, score) {
  if (!container) return;

  // 1. Reset classes
  container.classList.remove('score-excellent', 'score-good', 'score-decent', 'score-needs-work');

  // 2. Remove existing celebration
  const existingCelebration = container.querySelector('.celebration-container');
  if (existingCelebration) existingCelebration.remove();

  // 3. Create new celebration
  const celebration = document.createElement('div');
  celebration.className = 'celebration-container';

  if (score >= 90) {
    celebration.innerHTML = '<div class="celebration-emoji">🎉</div>';
    celebration.classList.add('celebration-excellent');
    container.classList.add('score-excellent');
  } else if (score >= 80) {
    celebration.innerHTML = '<div class="thumbs-up-emoji">👍</div>';
    celebration.classList.add('celebration-good');
    container.classList.add('score-good');
  } else if (score >= 60) {
    celebration.innerHTML = '<div class="encouragement-emoji">💪</div>';
    celebration.classList.add('celebration-keep-trying');
    container.classList.add('score-decent');
  } else {
    celebration.innerHTML = '<div class="try-again-emoji">🔄</div>';
    celebration.classList.add('celebration-try-again');
    container.classList.add('score-needs-work');
  }

  // 4. Insert before score circle
  const scoreCircle = container.querySelector('.score-circle');
  if (scoreCircle) {
    container.insertBefore(celebration, scoreCircle);
  }
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
  if (resultsModal) {
    resultsModal.classList.remove('open');
    resultsModal.setAttribute('aria-hidden', 'true');
    setTimeout(() => {
      resultsModal.style.display = 'none';
    }, 300);
  }

  openCoachResultsSidebar();
}

/**
 * Generate session coaching tips
 */
function generateCoachingTips() {
  if (!coachingSession || !coachingSession.diagnostics) return [];
  return coachingSession.diagnostics.analyze() || [];
}

/**
 * Open Coach Results Sidebar
 */
export function openCoachResultsSidebar() {
  closeSidebar(); // Mutual exclusivity with other sidebars

  if (!coachResultsSidebar) {
    coachResultsSidebar = document.getElementById('coachResultsSidebar');
    sidebarOverallScore = document.getElementById('sidebar-overallScore');
    sidebarNoteAccuracy = document.getElementById('sidebar-noteAccuracy');
    sidebarTimingAccuracy = document.getElementById('sidebar-timingAccuracy');
    sidebarProblemMeasuresList = document.getElementById('sidebar-problemMeasuresList');
    sidebarCoachingTipsContainer = document.getElementById('sidebar-coachingTipsContainer');
    closeResultsSidebarBtn = document.getElementById('closeResultsSidebar');
    sidebarPlayReviewBtn = document.getElementById('sidebar-playReviewBtn');
    sidebarPracticeAgainBtn = document.getElementById('sidebar-practiceAgainBtn');
    sidebarSaveSessionBtn = document.getElementById('sidebar-saveSessionBtn');

    // Attach sidebar listeners
    if (closeResultsSidebarBtn) closeResultsSidebarBtn.onclick = exitCoachingMode;
    if (sidebarPracticeAgainBtn) sidebarPracticeAgainBtn.onclick = () => { closeCoachResultsSidebar(); startCoachingSession(); };
    if (sidebarSaveSessionBtn) sidebarSaveSessionBtn.onclick = saveCoachingSession;
    if (sidebarPlayReviewBtn) sidebarPlayReviewBtn.onclick = () => {
      const playReviewBtn = document.getElementById('playReviewBtn');
      if (playReviewBtn) playReviewBtn.click();
    };

    // Tab Logic for sidebar
    const tabs = coachResultsSidebar.querySelector('.sidebar-tabs');
    if (tabs) {
      tabs.querySelectorAll('.sidebar-tab').forEach(tab => {
        tab.onclick = () => {
          tabs.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
          coachResultsSidebar.querySelectorAll('.sidebar-content').forEach(c => c.style.display = 'none');

          tab.classList.add('active');
          const target = tab.dataset.tab;
          const content = document.getElementById(`sidebar-tab-${target}`);
          if (content) content.style.display = 'block';

          if (target === 'history') {
            renderHistoryList(true); // true for sidebar mode
          } else if (target === 'settings') {
            injectSidebarSettings();
          }
        };
      });
    }
  }

  if (coachResultsSidebar) {
    populateResultsSidebar();
    coachResultsSidebar.classList.add('open');
    coachResultsSidebar.setAttribute('aria-hidden', 'false');
  }

  updateBodySidebarClass();
}

/**
 * Close Coach Results Sidebar
 */
export function closeCoachResultsSidebar() {
  if (coachResultsSidebar) {
    coachResultsSidebar.classList.remove('open');
    coachResultsSidebar.setAttribute('aria-hidden', 'true');
  }
  updateBodySidebarClass();
}

/**
 * Populate standard sidebar results
 */
function populateResultsSidebar() {
  if (!coachingSession) return;

  if (sidebarOverallScore) sidebarOverallScore.textContent = coachingSession.overallScore + '%';
  if (sidebarNoteAccuracy) sidebarNoteAccuracy.textContent = coachingSession.noteAccuracy + '%';
  if (sidebarTimingAccuracy) sidebarTimingAccuracy.textContent = coachingSession.timingAccuracy + '%';

  // Apply Score Aesthetics directly to the sidebar results summary
  const sidebarSummary = coachResultsSidebar?.querySelector('.results-summary');
  if (sidebarSummary) {
    applyScoreAesthetics(sidebarSummary, coachingSession.overallScore);
  }

  if (sidebarProblemMeasuresList) {
    if (coachingSession.problemMeasures.length > 0) {
      sidebarProblemMeasuresList.innerHTML = coachingSession.problemMeasures
        .map(m => `<div class="problem-measure">Measure ${m}</div>`)
        .join('');
    } else {
      sidebarProblemMeasuresList.innerHTML = '<div class="no-problems">Great job! No problem areas detected.</div>';
    }
  }

  // Populate tips
  if (sidebarCoachingTipsContainer) {
    const tips = generateCoachingTips();
    if (tips && tips.length > 0) {
      let html = '<div class="coaching-tips"><h4 style="margin-top:0; margin-bottom:10px; color:var(--text-secondary); font-size:0.9em; text-transform:uppercase; letter-spacing:1px;">💡 Coach\'s Tips</h4><ul>';
      tips.forEach(s => {
        const text = typeof s === 'string' ? s : s.text;
        const action = typeof s === 'object' ? s.action : null;

        html += `<li style="margin-bottom:8px; display: flex; align-items: start; justify-content: space-between; font-size: 14px;">
                        <span>${text}</span>`;

        if (action && action.type === 'CALIBRATE') {
          html += `<button data-action="CALIBRATE" data-value="${action.value}"
                          class="primary-btn"
                          style="margin-left: 10px; padding: 2px 8px; font-size: 0.75em; flex-shrink: 0;">
                          ${action.label}
                        </button>`;
        }
        html += `</li>`;
      });
      html += '</ul></div>';
      sidebarCoachingTipsContainer.innerHTML = html;

      // Add listener for sidebar tips
      sidebarCoachingTipsContainer.onclick = (e) => {
        if (e.target.matches('button[data-action="CALIBRATE"]')) {
          const val = parseInt(e.target.dataset.value, 10);
          applyCalibration(val);
          e.target.disabled = true;
          e.target.textContent = 'Fixed!';
          // Update display if settings tab is open
          const disp = document.getElementById('sidebar-timingOffsetDisplay');
          if (disp) disp.textContent = getTimingOffset() + 'ms';
        }
      };
    } else {
      sidebarCoachingTipsContainer.innerHTML = '';
    }
  }

  // Handle play recording button
  if (sidebarPlayReviewBtn) {
    sidebarPlayReviewBtn.style.display = sessionAudioBlobUrl ? 'block' : 'none';
  }
}

/**
 * Inject settings into the sidebar settings tab
 */
function injectSidebarSettings() {
  const settingsTab = document.getElementById('sidebar-tab-settings');
  if (!settingsTab) return;

  settingsTab.innerHTML = `
    <div class="settings-panel" style="color: var(--text-primary);">
        <h3 style="margin-top: 0; color: var(--text-secondary); text-transform: uppercase; font-size: 0.9em; letter-spacing: 1px;">Timing Calibration</h3>
        <p style="font-size: 0.9em; color: var(--text-secondary); margin-bottom: 20px;">
            Adjust if notes consistently feel early or late.
        </p>
        
        <div style="background: rgba(var(--panel-rgb), 0.1); padding: 16px; border-radius: 12px; text-align: center; margin-bottom: 16px; border: 1px solid rgba(var(--primary-rgb), 0.1);">
            <div style="font-size: 0.85em; color: var(--text-secondary); margin-bottom: 10px;">Note vs. Accent Strictness</div>
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px;">
                <span style="font-size:0.75em; opacity:0.7;">Forgiving</span>
                <input type="range" id="sidebar-clarityThresholdSlider" min="0.3" max="0.7" step="0.05" style="flex:1">
                <span style="font-size:0.75em; opacity:0.7;">Strict</span>
            </div>
        </div>

        <div style="background: rgba(var(--panel-rgb), 0.1); padding: 16px; border-radius: 12px; text-align: center; border: 1px solid rgba(var(--primary-rgb), 0.1);">
            <div style="font-size: 0.85em; color: var(--text-secondary); margin-bottom: 10px;">Current Offset</div>
            <div id="sidebar-timingOffsetDisplay" style="font-size: 2.5em; font-weight: 800; color: var(--primary); margin-bottom: 15px;">${getTimingOffset()}ms</div>
            
            <div style="display: flex; justify-content: center; gap: 10px; margin-bottom: 15px;">
                <button id="sidebar-btn-cal-minus" class="secondary-btn" style="flex:1;">-10ms</button>
                <button id="sidebar-btn-cal-plus" class="secondary-btn" style="flex:1;">+10ms</button>
            </div>

            <button id="sidebar-btn-cal-reset" style="width: 100%; padding: 12px; background: transparent; border: 1px solid var(--error-color, #ff4444); color: var(--error-color, #ff4444); border-radius: 8px; cursor: pointer; transition: all 0.2s; font-weight: 600;">
                Reset Calibration
            </button>
        </div>
    </div>
  `;

  // Attach listeners
  const updateDisplay = () => {
    const disp = document.getElementById('sidebar-timingOffsetDisplay');
    if (disp) disp.textContent = getTimingOffset() + 'ms';
    // Sync with modal if open
    const modalDisp = document.getElementById('timingOffsetDisplay');
    if (modalDisp) modalDisp.textContent = getTimingOffset() + 'ms';
  };

  const btnMinus = settingsTab.querySelector('#sidebar-btn-cal-minus');
  if (btnMinus) btnMinus.onclick = () => { applyCalibration(-10); updateDisplay(); };

  const btnPlus = settingsTab.querySelector('#sidebar-btn-cal-plus');
  if (btnPlus) btnPlus.onclick = () => { applyCalibration(10); updateDisplay(); };

  const btnReset = settingsTab.querySelector('#sidebar-btn-cal-reset');
  if (btnReset) btnReset.onclick = () => { resetCalibration(); updateDisplay(); };

  const slider = settingsTab.querySelector('#sidebar-clarityThresholdSlider');
  if (slider) {
    slider.value = localStorage.getItem('gp_clarity_threshold') || 0.5;
    slider.oninput = (e) => {
      const val = parseFloat(e.target.value);
      Bus.emit(BUS_EVENT.SET_ACCENT_SENSITIVITY, { threshold: val });
    };
  }
}

/**
* Fully dismiss results
*/
function dismissResults() {
  if (resultsModal) {
    resultsModal.classList.remove('open');
    resultsModal.setAttribute('aria-hidden', 'true');
    
    setTimeout(() => {
      if (!resultsModal.classList.contains('open')) {
        resultsModal.style.display = 'none';
        resultsModal.classList.remove('sidebar-active');
        const modalContent = resultsModal.querySelector('.coaching-results-modal');
        if (modalContent) modalContent.classList.remove('sidebar-mode');
      }
    }, 300); // Wait for transition
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
 * Render history list
 * @param {boolean} isSidebar - If true, render into sidebar historyList
 */
export async function renderHistoryList(isSidebar = false) {
  const containerId = isSidebar ? 'sidebar-historyList' : 'historyList';
  const listContainer = document.getElementById(containerId);
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
  coachModeBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    // Close dropdown
    const menu = document.getElementById('accountDropdownMenu');
    if (menu) menu.classList.remove('show');
    enterCoachingMode(activeGrid);
  });

  // Coaching Sidebar Close
  const closeCoachingSidebarBtn = document.getElementById('closeCoachingSidebar');
  closeCoachingSidebarBtn?.addEventListener('click', () => {
    exitCoachingMode();
  });
  const practiceAgainBtn = document.getElementById('practiceAgainBtn');
  practiceAgainBtn?.addEventListener('click', () => {
    if (resultsModal) {
      resultsModal.style.display = 'none';
      resultsModal.setAttribute('aria-hidden', 'true');
    }
    clearCellHighlights(activeGrid);
    startCoachingSession(activeGrid); // This will trigger the calibration check if needed
  });

  const saveSessionBtn = document.getElementById('saveSessionBtn');
  saveSessionBtn?.addEventListener('click', saveCoachingSession);

  // Phase 3: Review Playback Sync Trigger
  const playReviewBtn = document.getElementById('playReviewBtn');
  if (playReviewBtn) {
    playReviewBtn.addEventListener('click', toggleReviewPlayback);
  }

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
 * Shows a prompt suggesting the user calibrate for their specific instrument
 */
function showCalibrationPrompt(ctx) {
  const modal = document.getElementById('calOptimizationModal');
  if (!modal) {
    // Fallback: just start if UI missing
    startCoachingSessionActual(ctx);
    return;
  }

  modal.style.display = 'flex';
  modal.setAttribute('aria-hidden', 'false');

  const calNowBtn = document.getElementById('calNowBtn');
  const calSkipBtn = document.getElementById('calSkipBtn');

  calNowBtn.onclick = () => {
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    // Open mic calibration
    const micCalBtn = document.getElementById('micCalBtn');
    if (micCalBtn) micCalBtn.click();

    // Auto-start session once calibration is done
    Bus.once(BUS_EVENT.CALIBRATION_DONE, () => {
      startCoachingSession(ctx);
    });
  };

  calSkipBtn.onclick = () => {
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    skipCalibrationCheck[getCurrentScaleId()] = true;
    startCoachingSessionActual(ctx);
  };
}

/**
 * Start the actual coaching session (Playback + Recording)
 * @param {Object} ctx - Grid context (activeGrid)
 */
export async function startCoachingSession(ctx = activeGrid) {
  if (isCoachingActive) {
    console.warn('Coaching session already active');
    return;
  }

  // Phase 35: Calibration Pre-Check
  const scaleId = getCurrentScaleId();
  await loadCalibrationProfile(); // Ensure it's loaded from DB/Cache

  if (!hasCalibrationForCurrentScale() && !skipCalibrationCheck[scaleId]) {
    showCalibrationPrompt(ctx);
    return; // Wait for user choice
  }

  startCoachingSessionActual(ctx);
}


async function startCoachingSessionActual(ctx = activeGrid) {
  console.log('Coaching Mode: Starting session Actual');

  gridLabels = activeGrid.innerLabels;

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
  sessionLogs = []; // Clear diagnostics logs
  isCoachingActive = true;

  // Turn on metronome programmatically
  if (!ctx.metronomeOn) {
    ctx.metronomeOn = true;
    localStorage.setItem('groovepan_metro' + '-' + ctx.id, 'on');
    if (TransportRegistry) TransportRegistry.updateAll(ctx);
  }

  // Update HUD to "Running" state
  showCoachingSidebar(false);

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

  await turnOnMic();

  // Phase 3: Start Audio Recording
  setupSessionRecorder();

  // Start playback
  start(ctx, true, false);
}

// --- Session Recording State ---
let sessionRecorder = null;
let sessionAudioChunks = [];
export let sessionAudioBlobUrl = null;

function setupSessionRecorder() {
  // Clear previous recording
  if (sessionAudioBlobUrl) {
    URL.revokeObjectURL(sessionAudioBlobUrl);
    sessionAudioBlobUrl = null;
  }
  sessionAudioChunks = [];

  if (!micStream) {
    console.warn("Coaching Mode: Cannot start recording, micStream is null.");
    return;
  }

  try {
    sessionRecorder = new MediaRecorder(micStream);

    sessionRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        sessionAudioChunks.push(e.data);
      }
    };

    sessionRecorder.onstop = () => {
      const audioBlob = new Blob(sessionAudioChunks, { type: 'audio/webm' }); // Default browser format
      sessionAudioBlobUrl = URL.createObjectURL(audioBlob);
      console.log("Coaching Mode: Recording saved, Blob URL created:", sessionAudioBlobUrl);
    };

    sessionRecorder.start();
    console.log("Coaching Mode: Recording started.");
  } catch (err) {
    console.error("Coaching Mode: Failed to start MediaRecorder:", err);
  }
}

// --- Phase 3: Synchronized Playback Logic ---
let isPlayingReview = false;
let originalInstVol = 1.0;
let originalMetroVol = 1.0;

export function toggleReviewPlayback() {
  const audioPlayer = document.getElementById('sessionAudioPlayer');
  const playBtn = document.getElementById('playReviewBtn');
  if (!audioPlayer || !playBtn || !sessionAudioBlobUrl) return;

  if (isPlayingReview) {
    // Stop Playback
    audioPlayer.pause();
    stop(activeGrid, true);

    // Restore Volumes
    setVolume('instrument', originalInstVol);
    setVolume('metronome', originalMetroVol);

    isPlayingReview = false;
    playBtn.textContent = '⏯️ Play Recording & Grid';
    playBtn.classList.remove('playing');
  } else {
    // Start Playback
    // 1. Setup Audio Element
    audioPlayer.src = sessionAudioBlobUrl;

    // 2. Cache & Mute Noteplayer Grid
    originalInstVol = getVolume('instrument');
    originalMetroVol = getVolume('metronome');
    setVolume('instrument', 0);
    setVolume('metronome', 0);

    // 3. Sync & Start Both
    audioPlayer.currentTime = 0;
    activeGrid.caretIndex = 0; // Force restart from 0

    start(activeGrid, true, false);   // (ctx, isSync, skipCountdown) => skip countdown!

    setTimeout(() => {
      audioPlayer.play();

      isPlayingReview = true;
      playBtn.textContent = '⏹️ Stop Recording & Grid';
      playBtn.classList.add('playing');

      // Auto-stop when audio finishes
      audioPlayer.onended = () => {
        if (isPlayingReview) toggleReviewPlayback();
      };
    }, AUDIO_DELAY * 3000);
  }
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
  if (deviation !== undefined && deviation !== 0 && result.timingScore < TIMING_SCORE_GREAT) {
    if (deviation < 0) feedback += `Early by (${Math.abs(deviation)}ms)`;
    else if (deviation > 0) feedback += `Late by (${deviation}ms)`;
  }
  return feedback;
}

/**
 * Get the expected note(s) for a step
 * Used for "Challenge" logic
 */
export function getExpectedNoteForStep(stepIndex) {
  if (!coachingSession || !coachingSession.noteResults) return null;
  const result = coachingSession.noteResults.find(r => r.stepIndex === stepIndex);
  // If result exists, use its expectedNote property (single note) or expectedNotes (array)
  if (result) {
    if (result.expectedNote) return result.expectedNote;
    if (result.expectedNotes && result.expectedNotes.length > 0) return result.expectedNotes[0];
  }
  // Fallback to initial expectedNotes array
  const exp = expectedNotes ? expectedNotes[stepIndex] : null;
  if (exp && exp.labels && exp.labels.length > 0) return exp.labels[0];

  return null;
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

/**
 * Record a diagnostic log for the current coaching session
 * @param {string} msg 
 * @param {number} stepIndex 
 */
export function logCoachingEvent(msg, stepIndex = -1) {
  if (!isCoachingActive && !isCalibrationMode) return;
  sessionLogs.push({
    step: stepIndex,
    msg,
    time: Date.now()
  });
}

/**
 * Copy logs for a specific step and its neighbors to the clipboard
 * @param {number} targetStep 
 */
export async function copyLogsForStep(targetStep) {
  if (!sessionLogs || sessionLogs.length === 0) {
    console.warn("No logs available for this session.");
    return false;
  }

  // Filter logs for [step-1, step+1]
  const windowLogs = sessionLogs.filter(l => l.step >= targetStep - 1 && l.step <= targetStep + 1);

  if (windowLogs.length === 0) {
    alert(`No detailed logs found for Step ${targetStep}.`);
    return false;
  }

  const sessionStart = sessionLogs[0]?.time || 0;

  let targetNoteResult = coachingSession.noteResults.filter(r => r.stepIndex === targetStep)[0];
  let targetNotes = targetNoteResult.expectedNotes;
  if (Array.isArray(targetNoteResult.expectedNotes)) {
    targetNotes = targetNoteResult.expectedNotes.join(', ');
  }

  const header = `--- COACHING SESSION DEBUG LOGS ---
Target Step: ${targetStep}
Target Note: ${targetNotes}
Pattern: ${getSelectedPatternName() || 'Unknown'}
BPM: ${activeGrid.bpm}
----------------------------------
`;

  const body = windowLogs.map(l => {
    const elapsed = ((l.time - sessionStart) / 1000).toFixed(3);
    const stepStr = l.step === -1 ? "N/A" : l.step;
    return `[T+${elapsed}s][Step ${stepStr}] ${l.msg}`;
  }).join('\n');

  const fullLog = header + body + "\n----------------------------------";

  try {
    // Attempt modern Clipboard API
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(fullLog);
      return true;
    }
    throw new Error("Clipboard API unavailable");
  } catch (err) {
    console.warn("Clipboard API failed, trying fallback:", err);
    // Fallback for focus/unsupported issues
    try {
      const textArea = document.createElement("textarea");
      textArea.value = fullLog;
      textArea.style.position = "fixed";
      textArea.style.left = "-9999px";
      textArea.style.top = "0";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const success = document.execCommand('copy');
      document.body.removeChild(textArea);
      return success;
    } catch (fallbackErr) {
      console.error("Fallback copy failed:", fallbackErr);
      return false;
    }
  }
}

/**
 * Enable Review Mode (can be called from coaching or calibration)
 */
export function enableReviewMode() {
  isReviewActive = true;
}

/**
 * Disable Review Mode
 */
export function disableReviewMode() {
  isReviewActive = false;

  // Clear session data
  if (coachingSession) {
    coachingSession.noteResults = [];
  }
  sessionLogs = [];
}

/**
 * Map calibration results to grid for visual feedback
 * @param {Object} calibrationResults - Results from analyzeGuidedResults
 * @param {Object} ctx - Grid context
 */
export function mapCalibrationResultsToGrid(calibrationResults, ctx) {
  if (!calibrationResults || !ctx) return;

  // Use structured results if available (Preferred)
  const { detailedResults, summary } = calibrationResults;

  // Create noteResults array for review mode
  if (!coachingSession) {
    coachingSession = {
      noteResults: []
    };
  } else {
    coachingSession.noteResults = [];
  }

  if (detailedResults && Array.isArray(detailedResults)) {
    detailedResults.forEach(res => {
      let feedback = res.status;
      let correct = (res.status === 'Correct');

      if (res.status === 'Misclassified') {
        feedback = `Misclassified (Found ${res.found || 'Noise'})`;
      }

      // Add result for this step
      coachingSession.noteResults.push({
        stepIndex: res.step,
        detectedNote: res.found || 'Miss',
        expectedNote: res.note,
        correct: correct,
        feedback: feedback,
        timingScore: correct ? 100 : 0,
        noteScore: correct ? 1 : 0
      });

      // Apply visual feedback to the cell
      const cell = ctx.cells[res.step];
      if (cell) {
        cell.classList.add('has-feedback');
        if (!correct) {
          cell.classList.add('coach-wrong');
        } else {
          cell.classList.add('coach-correct'); // Feedback for correct notes too!
        }
      }
    });
    return;
  }

  // Fallback to legacy summary parsing (if detailedResults missing)
  if (!summary) return;

  const lines = summary.split('\n');
  const expected = ['Ding', '1', '2', '3', '4', '5', '6', '7', '8'];

  expected.forEach((note, i) => {
    const measureStart = (i + 1) * 8;

    // Find feedback for this note in the summary
    const feedbackLine = lines.find(line => line.startsWith(`${note}:`));

    let feedback = 'Correct';
    let correct = true;

    if (feedbackLine) {
      if (feedbackLine.includes('Missed')) {
        feedback = 'Missed Note';
        correct = false;
      } else if (feedbackLine.includes('Double-Trigger')) {
        feedback = 'Double-Trigger';
        correct = false;
      } else if (feedbackLine.includes('Misclassified')) {
        feedback = feedbackLine; // Show full misclassification info
        correct = false;
      } else if (feedbackLine.includes('Unclear')) {
        feedback = feedbackLine; // Show noise info
        correct = false;
      }
    }

    // Add result for this step (EVEN IF CORRECT)
    coachingSession.noteResults.push({
      stepIndex: measureStart,
      detectedNote: note,
      expectedNote: note,
      correct: correct,
      feedback: feedback,
      timingScore: correct ? 100 : 0,
      noteScore: correct ? 1 : 0
    });

    // Apply visual feedback to the cell
    const cell = ctx.cells[measureStart];
    if (cell) {
      cell.classList.add('has-feedback');
      if (!correct) {
        cell.classList.add('coach-wrong');
      } else {
        cell.classList.add('coach-correct');
      }
    }
  });
}
