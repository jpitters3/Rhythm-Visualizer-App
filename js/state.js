/**
 * Global State Management
 */

// Initial State
export let innerLabels = [];
export let measures = 1;

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
