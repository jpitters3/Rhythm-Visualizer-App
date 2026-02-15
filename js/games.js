/**
 * Games Mode Controller
 * Handles gamified practice experiences like Simon.
 */

import { activeGrid, setIsListening, getScale } from './state.js';
import { start, stop, playHandpanSoundForLabel, intervalMs, noteForLabel, playSample } from './noteplayer.js';
import { highlightHandpan } from './handpanmap.js';

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

// UI Elements
let gameHUD = null;
let gameLevelEl = null;
let gameStreakEl = null;
let gameSelectionModal = null;

/**
 * Initialize Games Mode
 */
export function initGames() {
  gameHUD = document.getElementById('gameHUD');
  gameLevelEl = document.getElementById('gameLevel');
  gameStreakEl = document.getElementById('gameStreak');
  gameSelectionModal = document.getElementById('gameSelectionModal');

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
        startGameLoop();
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
 * Start a new Simon game
 * @param {boolean} reset - Reset level to 1
 */
export function startSimonGame(reset = true) {
  closeGameSelection();

  if (reset) {
    currentLevel = 1;
    currentSequence = [];
  }

  isGameActive = true;
  showGameHUD();
  updateHUD();

  // Enter READY state
  currentState = GAME_STATE.READY;

  // Show Instructions in HUD
  const hudNotes = gameHUD.querySelector('.hud-notes');
  if (hudNotes) {
    hudNotes.innerHTML = `<div style="font-size:13px; color:var(--text); margin-bottom:4px;">Listen to the pattern...</div>
                            <div style="font-size:12px; color:var(--text-secondary);">Then repeat it back!</div>`;
  }

  const startBtn = document.getElementById('startGameBtn');
  if (startBtn) {
    startBtn.style.display = 'block';
    startBtn.textContent = "Start Game";
  }
}

function startGameLoop() {
  const startBtn = document.getElementById('startGameBtn');
  if (startBtn) startBtn.style.display = 'none';

  // Reset HUD for gameplay
  const hudNotes = gameHUD.querySelector('.hud-notes');
  if (hudNotes) {
    hudNotes.innerHTML = `<span class="hud-label" style="font-size: 0.8em; opacity: 0.7; margin-bottom: 2px;">Streak</span>
                              <span id="gameStreak" class="hud-value" style="color: var(--primary);">0</span>`;
    gameStreakEl = document.getElementById('gameStreak');
  }

  // Start Metronome for timing context
  // We use the existing start() function but with specific context
  if (activeGrid && !activeGrid.playing) {
    start(activeGrid);
  }

  startLevel();
}

/**
 * Begin a specific level
 */
async function startLevel() {
  currentState = GAME_STATE.DEMO;
  userProgressIndex = 0;

  // Create or extend sequence
  if (currentSequence.length < currentLevel) {
    const labels = ['D', '1', '2', '3', '4', '5', '6', '7', '8', 'T', 'S'];
    const randomNote = labels[Math.floor(Math.random() * labels.length)];
    currentSequence.push(randomNote);
  }

  updateHUD();

  // Wait a beat before starting demo
  await new Promise(r => setTimeout(r, 1000));

  playDemoSequence();
}

/**
 * App plays the sequence for the user
 */
async function playDemoSequence() {
  const ms = intervalMs(activeGrid);

  for (let i = 0; i < currentSequence.length; i++) {
    const label = currentSequence[i];

    // Play sound and show visual on handpan
    const soundKey = noteForLabel(label === 'D' ? 'Ding' : label);
    if (soundKey) playSample(soundKey);

    highlightHandpanNote(label);

    await new Promise(r => setTimeout(r, ms));
  }

  // Shift to user input
  currentState = GAME_STATE.INPUT;
  setIsListening(true);
}

/**
 * Handle a note detected during Game Mode
 */
export function handleGameNote(detectedNote) {
  if (currentState !== GAME_STATE.INPUT) return;

  const expected = currentSequence[userProgressIndex];

  // SIMON LOGIC: Note must match exactly, but handle ACCENT specially
  let isMatch = false;
  if (detectedNote === 'ACCENT') {
    isMatch = (expected === 'T' || expected === 'S');
  } else {
    isMatch = (detectedNote === expected);
  }

  if (isMatch) {
    userProgressIndex++;

    // Correct! Flash green
    flashHandpan(expected, 'success');

    if (userProgressIndex >= currentSequence.length) {
      // Level Complete!
      currentLevel++;
      setTimeout(() => startLevel(), 1000);
    }
  } else {
    // WRONG! Game Over
    gameOver();
  }
}

function gameOver() {
  currentState = GAME_STATE.FEEDBACK;
  setIsListening(false);

  // Flash red
  flashHandpan(null, 'error');

  alert(`Game Over! You reached Level ${currentLevel}. Try again?`);
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
  if (gameHUD) gameHUD.style.display = 'none';
  setIsListening(false);
  stop(activeGrid); // Stop metronome
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
  return isGameActive;
}
