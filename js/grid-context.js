/**
 * GridContext manages the state for an independent rhythm grid.
 * This allows multiple grids to coexist without global variable collisions.
 */
import { getBeats, getSubdivision } from './rhythm-core.js';
import { setGridA, setGridB, setActiveGrid } from './state.js';

export class GridContext {
  constructor(id, containerId) {
    this.id = id;
    this.containerId = containerId;

    // Rhythm model: beats per measure × subdivision (steps per beat)
    this.beats = getBeats();           // e.g. 4
    this.subdivision = getSubdivision(); // e.g. 2 → 8th notes

    // State
    this.innerLabels = Array(this.stepsPerMeasure).fill('');
    this.innerHands = Array(this.stepsPerMeasure).fill(null);
    this.innerFlams = Array(this.stepsPerMeasure).fill('');
    this.step = 0;
    this.playing = false;
    this.bpm = 90;
    this.metronomeOn = false;
    this.metronomeSubdiv = true;
    this.countdownEnabled = false;
    this.isMuted = false;
    this.transcriptionIndex = 0;
    this.tags = [];

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
    return this.beats * this.subdivision;
  }

  get measures() {
    return Math.max(1, Math.ceil(this.innerLabels.length / this.stepsPerMeasure));
  }

  setMeasures(m) {
    this._measures = m;
    this.innerLabels = Array(m * this.stepsPerMeasure).fill('');
    this.innerHands = Array(m * this.stepsPerMeasure).fill(null);
    this.innerFlams = Array(m * this.stepsPerMeasure).fill('');
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
    this.innerFlams = otherGrid.innerFlams;
    this.step = otherGrid.step;
    this.playing = otherGrid.playing;
    this.bpm = otherGrid.bpm;
    this.metronomeOn = otherGrid.metronomeOn;
    this.metronomeSubdiv = otherGrid.metronomeSubdiv;
    this.countdownEnabled = otherGrid.countdownEnabled;
    this.isMuted = otherGrid.isMuted;
    this.beats = otherGrid.beats;
    this.subdivision = otherGrid.subdivision;
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
    this.innerFlams = Array(m * s).fill('');
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
setActiveGrid(gridA);
