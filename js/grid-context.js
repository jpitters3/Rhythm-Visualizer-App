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
    this.transcriptionIndex = 0;
    this.tags = []; // For categorization (e.g. #simon, #lesson)

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

  setMeasures(m) {
    this._measures = m;
    this.innerLabels = Array(m * this.stepsPerMeasure).fill('');
    this.innerHands = Array(m * this.stepsPerMeasure).fill(null);
  }

  setBpm(bpm) {
    this.bpm = bpm;

    // Sync UI
    const bpmInput = document.getElementById(`bpmInput-${this.id}`);
    const bpmVal = document.getElementById(`bpmVal-${this.id}`);
    if (bpmInput) bpmInput.value = bpm;
    if (bpmVal) bpmVal.textContent = bpm;
  }

  copyGrid(otherGrid) {
    this.innerLabels = otherGrid.innerLabels;
    this.innerHands = otherGrid.innerHands;
    this.step = otherGrid.step;
    this.playing = otherGrid.playing;
    this.bpm = otherGrid.bpm;
    this.metronomeOn = otherGrid.metronomeOn;
    this.isMuted = otherGrid.isMuted;
    this.mode = otherGrid.mode;
    this.transcriptionIndex = otherGrid.transcriptionIndex;
    this.tags = otherGrid.tags;
    this.timers = otherGrid.timers;
    this.activeSubIndex = otherGrid.activeSubIndex;
    this.caretIndex = otherGrid.caretIndex;
    this.anchorIndex = otherGrid.anchorIndex;
    this.rangeStart = otherGrid.rangeStart;
    this.rangeEnd = otherGrid.rangeEnd;
    this.selecting = otherGrid.selecting;
    this._measures = otherGrid.measures;
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
    this.transcriptionIndex = 0;
  }
}

// Global instances (exported)
export const gridA = new GridContext('A', 'measures');
export const gridB = new GridContext('B', 'measures-B');

// Re-export activeGrid from state.js to maintain compatibility
export { activeGrid } from './state.js';

// Sync with central state
setGridA(gridA);
setGridB(gridB);
setActiveGrid(gridA); // Initialize activeGrid to gridA

