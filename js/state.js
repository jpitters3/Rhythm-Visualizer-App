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
export function setIsEditMulti(v) { isEditMulti = v; }

export let longPressFired = false;
export function setLongPressFired(v) { longPressFired = v; }

export let labelNotation = localStorage.getItem('labelNotation') || 'musical';
export function setLabelNotation(v) {
  labelNotation = v;
  localStorage.setItem('labelNotation', v);
}

export let isListening = false;
export function setIsListening(v) { isListening = v; }

// Auth State (Migrated from auth.js/profile.js)
export let currentUser = null;
export function setCurrentUser(u) { currentUser = u; }

export let currentProfile = null;
export function setCurrentProfile(p) { currentProfile = p; }

export function isAdminUser(user) {
  const email = user?.email?.toLowerCase?.() || "";
  const isMetadataAdmin = user?.user_metadata?.is_admin === true;
  return ADMIN_EMAILS.has(email) || email.startsWith('test.user.') || isMetadataAdmin;
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
