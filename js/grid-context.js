/**
 * GridContext manages the state for an independent rhythm grid.
 * This allows multiple grids to coexist without global variable collisions.
 */
import { calculateSteps, getTimeSignature } from './rhythm-core.js';
import { setGridA, setGridB, setActiveGrid } from './state.js';

export class GridContext {
  constructor(id, containerId) {
    this.id = id;
    this.containerId = containerId;

    // State
    this.innerLabels = Array(8).fill(''); // Start with one measure
    this.innerHands = Array(8).fill(null);
    this.step = 0;
    this.playing = false;
    this.bpm = 90;
    this.metronomeOn = false;
    this.isMuted = false;
    this.mode = '8'; // Default mode matching index.html

    // Playback timers
    this.timers = [];

    // UI state
    this.activeSubIndex = null;
    this.caretIndex = 0;
    this.anchorIndex = null;
    this.rangeStart = null;
    this.rangeEnd = null;
    this.selecting = false;

    this._measures = 1;
  }

  get stepsPerMeasure() {
    return calculateSteps(getTimeSignature(), this.mode);
  }

  get measures() {
    return Math.max(1, Math.ceil(this.innerLabels.length / this.stepsPerMeasure));
  }

  set measures(val) {
    this._measures = val;
  }

  // Helper to get DOM elements for this context
  get container() {
    return document.getElementById(this.containerId);
  }

  get cells() {
    return this.container ? this.container.querySelectorAll('.cell') : [];
  }

  get bpmInput() {
    return document.getElementById(`bpmInput-${this.id}`);
  }

  get playBtn() {
    return document.getElementById(`playBtn-${this.id}`);
  }

  get muteBtn() {
    return document.getElementById(`muteBtn-${this.id}`);
  }

  reset() {
    const s = this.stepsPerMeasure;
    const m = this.measures;
    this.innerLabels = Array(m * s).fill('');
    this.innerHands = Array(m * s).fill(null);
    this.step = 0;
    this.playing = false;
  }
}

// Global instances (exported)
export const gridA = new GridContext('A', 'measures');
export const gridB = new GridContext('B', 'measures-B');

// Current active grid for keyboard shortcuts and general focus
export let activeGrid = gridA; // Default to A

export function setActiveGridGlobal(grid) {
  activeGrid = grid;
  setActiveGrid(grid); // Update state.js too
}

// Sync with central state
setGridA(gridA);
setGridB(gridB);
setActiveGrid(activeGrid);

// Legacy: Exposed for backward compatibility with non-ESM scripts (init.js, controls.js)
window.gridA = gridA;
window.gridB = gridB;
window.activeGrid = activeGrid;
window.GridContext = GridContext; // Also might be used? Maybe not, but safer.
window.setActiveGridGlobal = setActiveGridGlobal;


