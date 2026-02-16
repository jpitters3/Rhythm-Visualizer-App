/**
 * Games Mode Controller
 * Handles gamified practice experiences like Simon.
 */

import { activeGrid, setIsListening, getScale } from './state.js';
import { start, stop, playHandpanSoundForLabel, intervalMs, noteForLabel, playSample, addTickObserver, removeTickObserver } from './noteplayer.js';
import { highlightHandpan } from './handpanmap.js';
import { GridContext } from './grid-context.js';
import { Bus, BUS_EVENT } from './bus.js';
import { renderAllMeasures } from './notegrid.js';

// Game States
const GAME_STATE = {
  OFF: 'OFF',
  READY: 'READY',      // Instructions shown, waiting for Start
  DEMO: 'DEMO',       // App plays sequence
  INPUT: 'INPUT',      // User plays sequence
  FEEDBACK: 'FEEDBACK' // Level Up / Game Over screen
};

let currentState = GAME_STATE.OFF;
let currentLevel = 1;
let currentSequence = [];
let userProgressIndex = 0;
let isGameActive = false;
let simonNoteIndex = 0; // Index for demo playback
let lastProcessedStep = -1;
let currentMeasure = 0;

// UI Elements
let gameHUD = null;
let gameLevelEl = null;
let gameStreakEl = null;
let gameSelectionModal = null;

// Pattern cache for Simon game
let simonPatterns = [];
let selectedPattern = null;

// Timer and turn indicator
let inputTimer = null;
let timerInterval = null;
let timeRemaining = 0;
let turnIndicator = null;

// Named handlers for cleanup
const onNoteDetected = (e) => handleGameNote(e.detail.label, e.detail.step, e.detail.time);
const onAccentDetected = (e) => handleGameNote('ACCENT', e.detail.step, e.detail.time);

/**
 * Initialize Games Mode
 */
export function initGames() {
  gameHUD = document.getElementById('gameHUD');
  gameLevelEl = document.getElementById('gameLevel');
  gameStreakEl = document.getElementById('gameStreak');
  gameSelectionModal = document.getElementById('gameSelectionModal');
  turnIndicator = document.getElementById('simonTurnIndicator');

  // Button Listeners
  const gamesModeBtn = document.getElementById('gamesModeBtn');
  if (gamesModeBtn) {
    gamesModeBtn.onclick = openGameSelection;
  }

  const closeBtn = document.getElementById('closeGameSelectionBtn');
  if (closeBtn) {
    closeBtn.onclick = closeGameSelection;
  }

  const startSimonBtn = document.getElementById('startGameSimon');
  if (startSimonBtn) {
    startSimonBtn.onclick = () => startSimonGame();
  }

  const stopGameBtn = document.getElementById('stopGameBtn');
  if (stopGameBtn) {
    stopGameBtn.onclick = exitGameMode;
  }

  const startGameHUDBtn = document.getElementById('startGameBtn');
  if (startGameHUDBtn) {
    startGameHUDBtn.onclick = () => {
      if (currentState === GAME_STATE.READY || currentState === GAME_STATE.FEEDBACK) {
        // Start or restart the game
        startGameLoop();
      } else if (currentState === GAME_STATE.DEMO || currentState === GAME_STATE.INPUT) {
        // Stop the game
        stopGame();
      }
    };
  }
}

function openGameSelection() {
  if (gameSelectionModal) {
    gameSelectionModal.style.display = 'flex';
  }
}

function closeGameSelection() {
  if (gameSelectionModal) {
    gameSelectionModal.style.display = 'none';
  }
}
/**
 * Show turn indicator with message
 */
function showTurnIndicator(message, isUserTurn = false) {
  // console.log(`[Simon] showTurnIndicator: "${message}", isUserTurn: ${isUserTurn}`);
  if (!turnIndicator) return;

  const messageEl = turnIndicator.querySelector('.turn-message');
  const timerEl = turnIndicator.querySelector('.turn-timer');

  if (messageEl) messageEl.textContent = message;
  if (timerEl) timerEl.textContent = '';

  turnIndicator.style.display = 'block';
  turnIndicator.classList.toggle('user-turn', isUserTurn);
}

/**
 * Hide turn indicator
 */
function hideTurnIndicator() {
  if (turnIndicator) {
    turnIndicator.style.display = 'none';
  }
}

/**
 * Start countdown timer display
 */
function startTimerDisplay(durationMs) {
  const timerEl = turnIndicator?.querySelector('.turn-timer');
  if (!timerEl) return;

  timeRemaining = Math.ceil(durationMs / 1000);

  const updateTimer = () => {
    if (timeRemaining <= 0) {
      clearInterval(timerInterval);
      return;
    }

    timerEl.textContent = `${timeRemaining}s`;

    // Add warning/danger classes
    timerEl.classList.remove('warning', 'danger');
    if (timeRemaining <= 3) {
      timerEl.classList.add('danger');
    } else if (timeRemaining <= 5) {
      timerEl.classList.add('warning');
    }

    timeRemaining--;
  };

  updateTimer(); // Show immediately
  timerInterval = setInterval(updateTimer, 1000);
}

/**
 * Clear all timers
 */
function clearTimers() {
  if (inputTimer) {
    clearTimeout(inputTimer);
    inputTimer = null;
  }
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}


/**
 * Start a new Simon game
 * @param {boolean} reset - Reset level to 1
 */
export function startSimonGame(reset = true) {
  closeGameSelection();

  if (reset) {
    currentLevel = 1;
    currentSequence = [];
    simonPatterns = [];
    selectedPattern = null;
  }

  // Enter presentation mode
  // document.body.classList.add('present', 'simon-game');

  isGameActive = true;
  showGameHUD();
  updateHUD();

  // Enter READY state
  currentState = GAME_STATE.READY;

  // Listen for detection events (Clean up first)
  Bus.off(BUS_EVENT.NOTE_DETECTED, onNoteDetected);
  Bus.off(BUS_EVENT.ACCENT_DETECTED, onAccentDetected);
  Bus.on(BUS_EVENT.NOTE_DETECTED, onNoteDetected);
  Bus.on(BUS_EVENT.ACCENT_DETECTED, onAccentDetected);

  // Show Instructions in HUD
  const hudNotes = gameHUD.querySelector('.hud-notes');
  if (hudNotes) {
    hudNotes.innerHTML = `<div style="font-size:13px; color:var(--text); margin-bottom:4px;">Listen to the pattern...</div>
                            <div style="font-size:12px; color:var(--primary); font-weight:bold;">Then repeat it on the click (the 1)!</div>`;
  }

  const startBtn = document.getElementById('startGameBtn');
  if (startBtn) {
    startBtn.style.display = 'block';
    startBtn.textContent = "Start Game";
  }
}

async function startGameLoop() {
  // console.log('[Simon] startGameLoop - isGameActive:', isGameActive);

  const startBtn = document.getElementById('startGameBtn');
  if (startBtn) {
    startBtn.style.display = 'block';
    startBtn.textContent = 'Stop';
  }

  // Reset HUD for gameplay
  const hudNotes = gameHUD.querySelector('.hud-notes');
  if (hudNotes) {
    hudNotes.innerHTML = `<span class="hud-label" style="font-size: 0.8em; opacity: 0.7; margin-bottom: 2px;">Streak</span>
                              <span id="gameStreak" class="hud-value" style="color: var(--primary);">0</span>`;
    gameStreakEl = document.getElementById('gameStreak');
  }

  // Enable microphone if not already active
  const micBtn = document.getElementById('micBtn');
  if (micBtn && !micBtn.classList.contains('active')) {
    // console.log('[Simon] Activating microphone automatically');
    micBtn.click();
    // Wait for mic to initialize (simulated async wait)
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Ensure isListening is true
  setIsListening(true);

  // Add the rhythmic observer (Clean up any old one first)
  removeTickObserver(handleSimonTick);
  addTickObserver(handleSimonTick);

  // Prepare the level (sequence, state, etc.)
  await startLevel();

  // VISIBILITY: Mark body for styling
  document.body.classList.add('simon-game-active');

  // Ensure isListening is true
  setIsListening(true);

  // START: Use the main active grid
  activeGrid.metronomeOn = true;
  start(activeGrid, true, true);
}

/**
 * Begin a specific level
 */
import { dbListPatternNames, dbLoadPatternByName } from './pattern-crud.js';

/**
 * Fetch all patterns with a specific tag
 * @param {string} tag - Tag to filter by (e.g., '#simon')
 * @returns {Promise<Array>} Array of pattern objects {name, data}
 */
async function fetchPatternsByTag(tag) {
  try {
    // Get all pattern names
    const names = await dbListPatternNames();

    // Load patterns in batches and filter by tag
    const patterns = [];
    const batchSize = 5;

    for (let i = 0; i < names.length; i += batchSize) {
      const batch = names.slice(i, i + batchSize);
      const results = await Promise.all(batch.map(async (name) => {
        const data = await dbLoadPatternByName(name);
        return { name, data };
      }));

      // Filter for patterns with the specified tag
      const tagged = results.filter(p => {
        const tags = p.data?.tags || [];
        return tags.includes(tag);
      });

      patterns.push(...tagged);
    }

    // console.log(`[Simon] Found ${patterns.length} patterns with tag ${tag}`);
    return patterns;
  } catch (err) {
    // console.error('[Simon] Error fetching patterns by tag:', err);
    return [];
  }
}

/**
 * Begin a specific level
 */
async function startLevel() {
  userProgressIndex = 0;
  simonNoteIndex = 0;
  lastProcessedStep = -1;

  // On first level, fetch Simon patterns
  if (currentLevel === 1) {
    simonPatterns = await fetchPatternsByTag('#simon');

    if (simonPatterns.length > 0) {
      // Randomly select a pattern
      selectedPattern = simonPatterns[Math.floor(Math.random() * simonPatterns.length)];
      // console.log(`[Simon] Selected pattern: ${selectedPattern.name}`);

      // Use the pattern's labels as the sequence, filtering out empty notes
      currentSequence = selectedPattern.data.labels
        .map(label => {
          // Convert array labels (chords) to first note only for Simon
          if (Array.isArray(label)) {
            return label[0] || '';
          }
          return label;
        })
        .filter(label => label && label.trim() !== '') // Remove empty strings
        .map(label => {
          // Normalize labels: 'D' -> 'Ding'
          if (label === 'D') return 'Ding';
          return label;
        });

      // console.log(`[Simon] Pattern sequence (${currentSequence.length} notes):`, currentSequence);
    } else {
      // console.warn('[Simon] No patterns found with #simon tag, using random generation');
      selectedPattern = null;
    }
  }

  // Ensure sequence has enough notes for the current level
  while (currentSequence.length < currentLevel) {
    const labels = ['Ding', '1', '2', '3', '4', '5', '6', '7', '8', 'T', 'S'];
    const randomNote = labels[Math.floor(Math.random() * labels.length)];
    currentSequence.push(randomNote);
  }

  // Sequence is ready - transition to DEMO mode
  currentState = GAME_STATE.DEMO;
  updateHUD();

  // POPULATION: Setup activeGrid headlessly
  const stepsPerMeasure = activeGrid.stepsPerMeasure || 8;
  const totalNotes = currentLevel;

  // Simon turn takes currentLevel measures
  // Clear and resize if needed
  activeGrid.measures = currentLevel;
  activeGrid.innerLabels = Array(currentLevel * stepsPerMeasure).fill('');

  // Populate notes at measure boundaries
  for (let i = 0; i < currentLevel; i++) {
    const stepIdx = i * stepsPerMeasure;
    activeGrid.innerLabels[stepIdx] = currentSequence[i];
  }

  renderAllMeasures(activeGrid);

  // CRITICAL: Reset playhead to Step 0 so it starts from the first measure
  stop(activeGrid);
  start(activeGrid, true, true);

  // Show "Simon's Turn" indicator
  showTurnIndicator("Simon's Turn", false);
}

/**
 * Handle rhythmic ticks from the engine
 */
function handleSimonTick(ctx, notes) {
  if (!isGameActive) return;

  // Only respond to ticks from the active grid
  if (ctx !== activeGrid) return;

  const step = ctx.step;

  // Guard against double-triggers within the same step frame
  if (step === lastProcessedStep) return;
  lastProcessedStep = step;

  // Only act on downbeats of measures (step 0, 8, 16...)
  const stepsPerMeasure = ctx.stepsPerMeasure || 8;
  const isMeasureStart = (step % stepsPerMeasure === 0);

  if (currentState === GAME_STATE.DEMO) {
    // console.log(`[Simon] DEMO Tick - Step: ${step}, Loop: ${ctx.loopCount}, Notes:`, notes);
    // Wait for the full demo loop to finish (loopCount >= 1)
    if (ctx.loopCount >= 1 && isMeasureStart) {
      // console.log('[Simon] Demo finished, switching to INPUT mode');
      currentState = GAME_STATE.INPUT;
      userProgressIndex = 0;
      showTurnIndicator("Your Turn!", true);

      // Clear the grid so the user has a clean slate (or we can leave it for reference?)
      // User said "populating the grid in a way that makes sense" 
      // Let's clear it so they have to play from memory.
      activeGrid.innerLabels = Array(activeGrid.innerLabels.length).fill('');
      renderAllMeasures(activeGrid);

      // Start the timeout timer
      const timeoutMs = 10000 + (currentLevel - 1) * 3000;
      startTimerDisplay(timeoutMs);
      inputTimer = setTimeout(() => {
        if (currentState === GAME_STATE.INPUT) {
          gameOver("Time's up!");
        }
      }, timeoutMs);
    }
  }
}

/**
 * Handle a note detected during Game Mode
 */
export function handleGameNote(detectedNote, hitStep, hitTime) {
  if (!isGameActive || currentState !== GAME_STATE.INPUT) return;

  // console.log('[Simon] handleGameNote called:', detectedNote, 'Step:', hitStep, 'Expected:', currentSequence[userProgressIndex]);

  // RHYTHMIC GUARD: Only accept hits on measure boundaries (Step 0, 8, 16...)
  if (hitStep % 8 !== 0) {
    // console.log('[Simon] Ignoring hit off the beat (Step', hitStep, ')');
    return;
  }

  const expected = currentSequence[userProgressIndex];

  // SIMON LOGIC: Note must match exactly, but handle ACCENT specially
  let isMatch = false;
  if (detectedNote === 'ACCENT') {
    isMatch = (expected === 'T' || expected === 'S');
  } else {
    isMatch = (detectedNote === expected);
  }

  // console.log('[Simon] Match check:', { detectedNote, expected, isMatch });

  if (isMatch) {
    userProgressIndex++;

    // Timing feedback
    let timingMsg = "";
    if (hitTime && activeGrid && activeGrid.audioStartTime !== undefined) {
      const deviation = Math.round(hitTime - activeGrid.audioStartTime);
      const absDev = Math.abs(deviation);
      if (absDev < 30) timingMsg = "Perfect!";
      else if (absDev < 60) timingMsg = "Great!";
      else if (absDev < 100) timingMsg = "Good";
      else timingMsg = deviation < 0 ? "Early" : "Late";

      // console.log(`[Simon] Timing accuracy: ${deviation}ms (${timingMsg})`);

      // Show briefly in turn indicator? No, HUD is better.
      const hudNotes = gameHUD.querySelector('.hud-notes');
      if (hudNotes) {
        const streakHtml = `<span class="hud-label" style="font-size: 0.8em; opacity: 0.7; margin-bottom: 2px;">Streak</span>
                            <span id="gameStreak" class="hud-value" style="color: var(--primary);">${userProgressIndex}</span>`;
        const timingHtml = `<div style="font-size: 11px; color: var(--accent); margin-top: 4px; font-weight: bold; animation: pulse 0.3s ease-out;">${timingMsg} (${deviation > 0 ? '+' : ''}${deviation}ms)</div>`;
        hudNotes.innerHTML = streakHtml + timingHtml;
      }
    }

    // Correct! Flash green
    flashHandpan(expected, 'success');

    // Check if user completed this level
    if (userProgressIndex >= currentLevel) {
      // console.log(`[Simon] Level ${currentLevel} complete! Switching to FEEDBACK.`);
      currentState = GAME_STATE.FEEDBACK;
      clearTimers();

      // Stop the current rhythm for a clean break between levels
      stop(activeGrid);

      currentLevel++;
      // Wait a moment for the user to breathe before the next demo
      setTimeout(() => startLevel(), 1200);
    }
  } else {
    // WRONG! Game Over
    // console.log('[Simon] Wrong note - expected:', expected, 'detected:', detectedNote);
    gameOver();
  }
}

function gameOver(message = `Game Over! You reached Level ${currentLevel}.`) {
  currentState = GAME_STATE.FEEDBACK;
  setIsListening(false);

  // Stop the grid on loss
  stop(activeGrid);

  // Clear all timers
  clearTimers();

  // Hide turn indicator
  hideTurnIndicator();

  // Flash red
  flashHandpan(null, 'error');

  // Update HUD to show game over message
  const hudNotes = gameHUD?.querySelector('.hud-notes');
  if (hudNotes) {
    hudNotes.innerHTML = `<div style="font-size:14px; color:var(--text); text-align:center;">${message}</div>`;
  }

  // Show Start button to play again
  const startBtn = document.getElementById('startGameBtn');
  if (startBtn) {
    startBtn.style.display = 'block';
    startBtn.textContent = 'Start Again';
  }
}

function showGameHUD() {
  if (gameHUD) gameHUD.style.display = 'block';
}

function updateHUD() {
  if (gameLevelEl) gameLevelEl.textContent = currentLevel;
  if (gameStreakEl) gameStreakEl.textContent = userProgressIndex;
}

function exitGameMode() {
  isGameActive = false;
  currentState = GAME_STATE.OFF;
  document.body.classList.remove('simon-game-active');

  if (gameHUD) gameHUD.style.display = 'none';
  setIsListening(false);

  // Stop active grid
  stop(activeGrid);

  removeTickObserver(handleSimonTick);

  // Remove Bus listeners
  Bus.off(BUS_EVENT.NOTE_DETECTED, onNoteDetected);
  Bus.off(BUS_EVENT.ACCENT_DETECTED, onAccentDetected);
}

// Visual Feedback
function highlightHandpanNote(label) {
  highlightHandpan(label, 0, 'R');
}

function flashHandpan(label, type) {
  const dot = document.querySelector(`.hp-dot[data-note="${label}"]`);
  if (!dot && label) return;

  if (type === 'success') {
    if (dot) {
      dot.style.boxShadow = "0 0 30px #2ecc71";
      setTimeout(() => dot.style.boxShadow = "", 300);
    }
  } else if (type === 'error') {
    // Flash whole screen red briefly?
    const overlay = document.getElementById('handpanOverlay');
    if (overlay) {
      overlay.style.backgroundColor = "rgba(231, 76, 60, 0.2)";
      setTimeout(() => overlay.style.backgroundColor = "", 300);
    }
  }
}

export function isGameModeActive() {
  // console.log('[Simon] isGameModeActive called, returning:', isGameActive);
  return isGameActive;
}

function stopGame() {
  currentState = GAME_STATE.FEEDBACK;
  setIsListening(false);

  // Stop metronome
  stop(activeGrid);

  // Clear observer
  removeTickObserver(handleSimonTick);

  // Clear all timers
  clearTimers();

  // Hide turn indicator
  hideTurnIndicator();

  // Update HUD to show stopped message
  const hudNotes = gameHUD?.querySelector('.hud-notes');
  if (hudNotes) {
    hudNotes.innerHTML = `<div style="font-size:14px; color:var(--text); text-align:center;">Game Stopped</div>`;
  }

  // Show Start button
  const startBtn = document.getElementById('startGameBtn');
  if (startBtn) {
    startBtn.style.display = 'block';
    startBtn.textContent = 'Start Again';
  }
}
