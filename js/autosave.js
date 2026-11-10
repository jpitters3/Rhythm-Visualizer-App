/* Auto-saves the open phrase shortly after edits stop (on by default; a profile
   setting in account settings can turn it off). Only the signed-in user's own named phrase, outside
   lessons (they have their own save flow). */
import { Bus, BUS_EVENT } from './bus.js';
import { currentUser, currentLesson } from './state.js';
import {
  dbSavePattern, serializePattern, hasUnsavedChanges,
  getSelectedPatternName, getPhraseNameOverride,
} from './pattern-crud.js';
import { currentProfile, updateAutoSavePref } from './profile.js';

const IDLE_MS = 2000;

let timer;
let pendingName = '';
let chain = Promise.resolve();

// Stored on the profile so it's the same on every device
export function isAutoSaveOn() {
  return currentProfile?.autosave !== false;
}

export function setAutoSaveOn(on) {
  updateAutoSavePref(on);
  Bus.emit(BUS_EVENT.AUTOSAVE_TOGGLED, { on });
  if (on) schedule();
}

// True when auto-save covers the phrase on screen, so no manual save UI is needed
export function autoSaveHandles() {
  return isAutoSaveOn() && !!currentUser && !currentLesson
    && !getPhraseNameOverride() && !!getSelectedPatternName();
}

async function doSave() {
  const name = pendingName;
  pendingName = '';
  if (!name || !isAutoSaveOn() || !currentUser || currentLesson || !hasUnsavedChanges()) return;
  try {
    // The name is the phrase being edited, which may no longer be the selected one mid-switch
    await dbSavePattern(name, serializePattern(), 'manual', { replace: true });
    Bus.emit(BUS_EVENT.PATTERN_SAVED, { name, fromSave: true });
  } catch (err) {
    console.error('Auto-save failed', err);
    Bus.emit(BUS_EVENT.AUTOSAVE_FAILED, { name });
  }
}

// Saves any pending edits now; await it before replacing the grid
export function flushAutoSave() {
  clearTimeout(timer);
  chain = chain.then(doSave);
  return chain;
}

function schedule() {
  if (!autoSaveHandles()) return;
  pendingName = getSelectedPatternName();
  clearTimeout(timer);
  timer = setTimeout(flushAutoSave, IDLE_MS);
}

export function initAutoSave() {
  Bus.on(BUS_EVENT.GRID_CHANGED, schedule);
  // The saved setting arrives with the profile; refresh the save UI to match
  Bus.on(BUS_EVENT.PROFILE_LOADED, () => Bus.emit(BUS_EVENT.AUTOSAVE_TOGGLED, { on: isAutoSaveOn() }));
  // Leaving the tab or the Studio: save now rather than lose the last edits
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAutoSave();
  });
  addEventListener('hashchange', flushAutoSave);
}
