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
