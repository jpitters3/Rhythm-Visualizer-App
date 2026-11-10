/* Phrase save status beside the title. "Saved" only when the grid matches the
   last confirmed save (pattern-crud's snapshot), never optimistically. It flashes
   after a save and fades; unsaved states stay visible as a warning. */
import { Bus, BUS_EVENT } from './bus.js';
import { hasUnsavedChanges, getSelectedPatternName } from './pattern-crud.js';

const SAVED_SHOW_MS = 2500;
const FADE_MS = 600; // matches .phrase-save-status transition (css/layout.css)

let statusEl;
let hideTimer;

function show(state, text) {
  clearTimeout(hideTimer);
  statusEl.classList.remove('is-fading');
  statusEl.dataset.state = state;
  statusEl.textContent = text;
  statusEl.hidden = false;
}

function hide() {
  clearTimeout(hideTimer);
  statusEl.classList.remove('is-fading');
  statusEl.hidden = true;
}

function flashSaved() {
  show('saved', 'Saved');
  hideTimer = setTimeout(() => {
    statusEl.classList.add('is-fading');
    hideTimer = setTimeout(hide, FADE_MS);
  }, SAVED_SHOW_MS);
}

function update({ justSaved = false } = {}) {
  if (!statusEl) return;
  const named = !!getSelectedPatternName();
  const changed = hasUnsavedChanges();
  if (changed) {
    show(named ? 'unsaved' : 'new', named ? 'Unsaved changes' : 'Not saved');
  } else if (justSaved && named) {
    flashSaved();
  } else if (statusEl.dataset.state !== 'saved') {
    hide(); // clean and nothing just saved: say nothing (a running "Saved" flash finishes on its own)
  }
}

export function initSaveStatus() {
  statusEl = document.getElementById('phraseSaveStatus');
  if (!statusEl) return;
  // Next frame: let the save/load that fired these finish updating its snapshot first
  Bus.on(BUS_EVENT.GRID_CHANGED, () => requestAnimationFrame(() => update()));
  Bus.on(BUS_EVENT.PATTERN_SAVED, (e) => {
    const justSaved = !!e.detail?.fromSave;
    requestAnimationFrame(() => update({ justSaved }));
  });
  requestAnimationFrame(() => update());
}
