import { ADMIN_EMAILS } from './config.js';

/**
 * Global State Management
 */

// Initial State
export let innerLabels = [];
export function setInnerLabels(v) { innerLabels = v; }
export let measures = 1;
export function setMeasures(v) { measures = v; }

// Global Grid Instances
export let gridA = null;
export let gridB = null;
export let activeGrid = null;

export const setGridA = (g) => { gridA = g; };
export const setGridB = (g) => { gridB = g; };
export const setActiveGrid = (g) => { activeGrid = g; };

export const getGridA = () => gridA;
export const getGridB = () => gridB;
export const getActiveGrid = () => activeGrid;

// UI Modes
export let editHandsMode = false;
export function setEditHandsMode(v) { editHandsMode = v; }

export let isEditMulti = false;
export let multiEditSessionSlot = null; // 0-3 during a session, null when inactive
export function setIsEditMulti(v) {
  isEditMulti = v;
  multiEditSessionSlot = v ? 0 : null; // reset cursor on every new session
}
export function advanceMultiEditSessionSlot() {
  if (multiEditSessionSlot !== null) multiEditSessionSlot++;
}
export function setMultiEditSessionSlot(v) { multiEditSessionSlot = v; }

export let isEditFlam = false;
export function setIsEditFlam(v) { isEditFlam = v; }

export let longPressFired = false;
export function setLongPressFired(v) { longPressFired = v; }

// Create Your Own Rhythm (js/create-rhythm-game.js) sets this while active —
// a plain tap on a beat writes Ding directly, same as a Caps-Lock click in
// the Studio grid (js/notegrid.js), since the game's whole point is quickly
// building a rhythm of Ding strikes by hand.
export let tapToDingMode = false;
export function setTapToDingMode(v) { tapToDingMode = v; }

export let labelNotation = localStorage.getItem('labelNotation') || 'musical';
export function setLabelNotation(v) {
  labelNotation = v;
  localStorage.setItem('labelNotation', v);
}

export let isListening = false;
export function setIsListening(v) { isListening = v; }

// Sub-option of ghost hands (see virtual-hands.js) — off by default so
// existing users don't suddenly hear new sounds on empty steps.
export let playGhostNotes = localStorage.getItem('playGhostNotes') === 'true';
export function setPlayGhostNotes(v) {
  playGhostNotes = v;
  localStorage.setItem('playGhostNotes', v);
}

// Mirrors virtual-hands.js's own `enabled` flag (source of truth, owns the
// 'vHandsEnabled' persistence) so noteplayer.js can gate ghost-note playback
// on it without importing virtual-hands.js, which would be circular
// (virtual-hands.js already imports from noteplayer.js).
export let ghostHandsShown = true;
export function setGhostHandsShown(v) { ghostHandsShown = v; }

export let isCalibrationMode = false;
export function setIsCalibrationMode(v) { isCalibrationMode = v; }

// Mirrors js/courses.js's own `currentLesson` (source of truth, set whenever
// a lesson loads) here too, so js/lesson-settings.js and js/controls.js can
// read "is a lesson currently loaded" without importing courses.js — which
// already imports controls.js, so a back-import would be circular.
export let currentLesson = null;
export function setCurrentLesson(l) { currentLesson = l; }

// Auth State (Migrated from auth.js/profile.js)
export let currentUser = null;
export function setCurrentUser(u) { currentUser = u; }

export function isAdminUser(user) {
  const email = user?.email?.toLowerCase?.() || "";
  const isMetadataAdmin = user?.user_metadata?.is_admin === true;
  // ONLY use explicit list or metadata
  return ADMIN_EMAILS.has(email) || isMetadataAdmin;
}

// Scale State
let selectedScaleName = null;
let currentScale = {
  ding: "D3",
  map: { "1": "A3", "2": "Bb3", "3": "C4", "4": "D4", "5": "E4", "6": "F4", "7": "G4", "8": "A4" }
};

export function getSelectedScaleName() { return selectedScaleName; }
export function setSelectedScaleName(n) { selectedScaleName = n; }
export function getScale() { return currentScale; }
export function setCurrentScale(scaleObj) {
  if (!scaleObj) return;
  currentScale = scaleObj;
}

/**
 * Returns a unique ID for the current scale, used for calibration keys.
 * Format: 'sys_<slug>' or 'custom_<uuid>'
 */
export function getCurrentScaleId() {
  const name = getSelectedScaleName();
  if (!name) return 'sys_default';

  if (name.startsWith('custom:')) {
    return 'custom_' + name.split(':')[1];
  }

  // For system scales, slugify the name
  return 'sys_' + name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}
