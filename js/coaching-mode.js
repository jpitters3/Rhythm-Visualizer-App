/**
 * Coaching Mode - Real-time practice feedback system
 * Evaluates note accuracy and timing during pattern playback
 */

import { activeGrid } from './grid-context.js';
import { cells } from './notegrid.js';
import { start, stop } from './noteplayer.js';
import { setIsListening } from './state.js';
import { supabase } from './supabase-client.js';
import { currentUser } from './state.js';
import { Bus, BUS_EVENT } from './bus.js';

// Session state
let coachingSession = null;
let isCoachingActive = false;
let expectedNotes = []; // Array of { index, labels } from pattern
let sessionResults = []; // Array of evaluation results per step

// UI elements
let coachingHUD = null;
let hudAccuracy = null;
let hudCorrect = null;
let hudTotal = null;
let stopCoachingBtn = null;
let resultsModal = null;

/**
 * Start a new coaching session
 * @param {Object} ctx - Grid context (activeGrid)
 */
export async function startCoachingSession(ctx = activeGrid) {
  console.log('Coaching Mode: Starting session');
  console.log('Coaching Mode: Context ID:', ctx?.id);
  console.log('Coaching Mode: innerLabels:', JSON.stringify(ctx?.innerLabels));

  if (isCoachingActive) {
    console.warn('Coaching session already active');
    return;
  }

  // Validate pattern has notes
  const hasNotes = ctx?.innerLabels?.some(label => label && label.length > 0);
  console.log('Coaching Mode: Pattern has notes?', hasNotes);
  if (!hasNotes) {
    alert('Please add some notes to the pattern before starting coaching mode.');
    return;
  }

  // Initialize session
  coachingSession = {
    id: Date.now(),
    patternName: ctx.patternName || 'Untitled Pattern',
    startTime: Date.now(),
    endTime: null,
    bpm: ctx.bpm,
    totalNotes: 0,
    correctNotes: 0,
    noteAccuracy: 0,
    timingAccuracy: 0,
    overallScore: 0,
    noteResults: [],
    problemMeasures: [],
    actualStartTime: null // Will be set when playback starts
  };

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

  // Show HUD
  showCoachingHUD();

  // Clear any existing cell highlights
  clearCellHighlights(ctx);

  // Enable microphone if not already
  const micBtn = document.getElementById('micBtn');
  if (micBtn && !micBtn.classList.contains('active')) {
    micBtn.click();
    // Wait for mic to initialize
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Start playback with countdown
  showCountdown(() => {
    coachingSession.actualStartTime = Date.now();
    start(ctx);
  });
}

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

  // Calculate expected time
  const subdivisions = (ctx.mode === '16') ? 4 : 2;
  const msPerStep = 60000 / (ctx.bpm * subdivisions);
  const expectedTime = coachingSession.actualStartTime + (stepIndex * msPerStep);

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
  // Note accuracy
  const noteMatch = expectedNotes.includes(detectedNote);
  const noteScore = noteMatch ? 100 : 0;

  // Timing accuracy (±100ms tolerance)
  const timingError = Math.abs(timing.actual - timing.expected);
  const timingScore = Math.max(0, 100 - timingError);

  // Combined score (70% note, 30% timing)
  const overallScore = (noteScore * 0.7) + (timingScore * 0.3);

  // Determine correctness (note must match AND timing within 100ms)
  const correct = noteMatch && timingError < 100;

  return {
    correct,
    noteScore,
    timingScore,
    timingError,
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
 */
function showCoachingHUD() {
  if (!coachingHUD) {
    coachingHUD = document.getElementById('coachingHUD');
    hudAccuracy = document.getElementById('hudAccuracy');
    hudCorrect = document.getElementById('hudCorrect');
    hudTotal = document.getElementById('hudTotal');
    stopCoachingBtn = document.getElementById('stopCoachingBtn');

    if (stopCoachingBtn && !stopCoachingBtn._hasListener) {
      stopCoachingBtn.addEventListener('click', endCoachingSession);
      stopCoachingBtn._hasListener = true;
    }
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

  // Hide HUD
  if (coachingHUD) {
    coachingHUD.style.display = 'none';
  }

  // Show results modal
  showResultsModal();

  // Reset state
  isCoachingActive = false;
}

/**
 * Calculate final session scores
 */
function calculateFinalScores() {
  if (!coachingSession || sessionResults.length === 0) return;

  const totalEvaluated = sessionResults.length;

  // Note accuracy
  coachingSession.noteAccuracy = Math.round(
    (coachingSession.correctNotes / totalEvaluated) * 100
  );

  // Timing accuracy (average of all timing scores)
  const avgTimingScore = sessionResults.reduce((sum, r) => sum + r.timingScore, 0) / totalEvaluated;
  coachingSession.timingAccuracy = Math.round(avgTimingScore);

  // Overall score (average of all overall scores)
  const avgOverallScore = sessionResults.reduce((sum, r) => sum + r.overallScore, 0) / totalEvaluated;
  coachingSession.overallScore = Math.round(avgOverallScore);

  // Identify problem measures (< 70% accuracy)
  identifyProblemMeasures();

  // Store results in session
  coachingSession.noteResults = sessionResults;
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
 * Show results modal
 */
function showResultsModal() {
  resultsModal = document.getElementById('coachingResultsModal');
  if (!resultsModal) return;

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

  // Show/Hide save button based on auth
  const saveSessionBtn = document.getElementById('saveSessionBtn');
  if (saveSessionBtn) {
    if (!currentUser) {
      saveSessionBtn.style.display = 'none';
      // Optionally show a "Login to Save" hint
      const hint = document.createElement('p');
      hint.id = 'saveHint';
      hint.className = 'save-hint';
      hint.textContent = '💡 Sign in to save your progress!';
      hint.style.fontSize = '12px';
      hint.style.marginTop = '10px';
      hint.style.color = 'var(--text-secondary)';
      if (!document.getElementById('saveHint')) {
        saveSessionBtn.parentNode.appendChild(hint);
      }
    } else {
      saveSessionBtn.style.display = 'block';
      const hint = document.getElementById('saveHint');
      if (hint) hint.remove();
    }
  }

  // Show modal
  resultsModal.style.display = 'flex';
  resultsModal.setAttribute('aria-hidden', 'false');
}

/**
 * Save session to database
 */
export async function saveCoachingSession() {
  if (!coachingSession || !currentUser) {
    console.warn('No session to save or user not logged in');
    return;
  }

  try {
    const { error } = await supabase
      .from('coaching_sessions')
      .insert({
        user_id: currentUser.id,
        pattern_name: coachingSession.patternName,
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

    alert('Session saved to your profile!');
    const saveBtn = document.getElementById('saveSessionBtn');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = '✓ Saved';
    }
  } catch (err) {
    console.error('Error saving session:', err);
    alert('Failed to save session. Please try again.');
  }
}

/**
 * Show countdown before starting
 */
function showCountdown(callback) {
  const overlay = document.getElementById('countdownOverlay');
  const numberEl = document.getElementById('countdownNumber');

  if (!overlay || !numberEl) {
    callback();
    return;
  }

  let count = 4;
  overlay.style.display = 'flex';
  numberEl.textContent = count;

  const interval = setInterval(() => {
    count--;
    if (count > 0) {
      numberEl.textContent = count;
    } else {
      clearInterval(interval);
      overlay.style.display = 'none';
      callback();
    }
  }, 1000);
}

/**
 * Initialize coaching mode UI
 */
export function initCoachingMode() {
  console.log('Coaching Mode: Initializing UI listeners');
  // Coach Mode button
  const coachModeBtn = document.getElementById('coachModeBtn');
  console.log('Coaching Mode: Button found?', !!coachModeBtn);
  coachModeBtn?.addEventListener('click', () => {
    console.log('Coaching Mode: Button clicked');
    startCoachingSession(activeGrid);
  });

  // Results modal buttons
  const closeResultsBtn = document.getElementById('closeCoachingResults');
  closeResultsBtn?.addEventListener('click', () => {
    if (resultsModal) {
      resultsModal.style.display = 'none';
      resultsModal.setAttribute('aria-hidden', 'true');
    }
    clearCellHighlights(activeGrid);
  });

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
    const { note, step, time } = e.detail || {};
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

