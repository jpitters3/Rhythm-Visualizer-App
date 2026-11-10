/* Phrase save status beside the title. "Saved" only when the grid matches the
   last confirmed save or load (pattern-crud's snapshot), never optimistically. */
import { Bus, BUS_EVENT } from './bus.js';
import { hasUnsavedChanges, getSelectedPatternName } from './pattern-crud.js';

const STATES = {
  saved: 'Saved',
  unsaved: 'Unsaved changes',
  new: 'Not saved',
};

let statusEl;

function update() {
  if (!statusEl) return;
  const named = !!getSelectedPatternName();
  const changed = hasUnsavedChanges();
  const state = named ? (changed ? 'unsaved' : 'saved') : (changed ? 'new' : null);
  statusEl.hidden = !state;
  if (!state) return;
  statusEl.dataset.state = state;
  statusEl.textContent = STATES[state];
}

export function initSaveStatus() {
  statusEl = document.getElementById('phraseSaveStatus');
  if (!statusEl) return;
  // Next frame: let the save/load that fired these finish updating its snapshot first
  const schedule = () => requestAnimationFrame(update);
  Bus.on(BUS_EVENT.GRID_CHANGED, schedule);
  Bus.on(BUS_EVENT.PATTERN_SAVED, schedule);
  schedule();
}
