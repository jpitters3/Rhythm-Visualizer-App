/* Auto-saves the open phrase shortly after edits stop (on by default; a profile
   setting in account settings can turn it off). Only the signed-in user's own named phrase, outside
   lessons (they have their own save flow).

   The Studio grid is shared: games, the Composer and lessons load their own content
   into it. So only edits made on the Studio route are saved, from a copy taken at
   the time, and a grid changed elsewhere stops auto-saving that phrase until it's
   loaded or saved again. Otherwise a game's empty grid could overwrite the phrase. */
import { Bus, BUS_EVENT } from './bus.js';
import { currentUser, currentLesson } from './state.js';
import {
  dbSavePattern, serializePattern, hasUnsavedChanges,
  getSelectedPatternName, getPhraseNameOverride,
} from './pattern-crud.js';
import { currentProfile, updateAutoSavePref } from './profile.js';
import { getCurrentRoute } from './router.js';

const IDLE_MS = 2000;

let timer;
let pendingName = '';
let pendingState = null; // the grid as last edited in the Studio
let borrowed = false; // the grid was changed outside the Studio since the phrase loaded
let chain = Promise.resolve();

const onStudio = () => getCurrentRoute() === 'studio';

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
  return isAutoSaveOn() && !!currentUser && !currentLesson && !borrowed
    && !getPhraseNameOverride() && !!getSelectedPatternName();
}

async function doSave() {
  const name = pendingName;
  const state = pendingState;
  pendingName = '';
  pendingState = null;
  if (!name || !state || !isAutoSaveOn() || !currentUser || currentLesson) return;
  try {
    // The name is the phrase being edited, which may no longer be the selected one
    // mid-switch; the state is the Studio copy, never whatever the grid holds now
    await dbSavePattern(name, state, 'manual', { replace: true });
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
  if (!onStudio()) {
    // Something else is using the grid: it no longer holds the open phrase
    if (getSelectedPatternName() && hasUnsavedChanges()) borrowed = true;
    return;
  }
  if (!autoSaveHandles() || !hasUnsavedChanges()) return;
  pendingName = getSelectedPatternName();
  pendingState = serializePattern();
  clearTimeout(timer);
  timer = setTimeout(flushAutoSave, IDLE_MS);
}

export function initAutoSave() {
  Bus.on(BUS_EVENT.GRID_CHANGED, schedule);
  // A phrase loaded or saved: the grid is that phrase again. A different phrase
  // means any pending edit no longer belongs to the old one, so drop it.
  Bus.on(BUS_EVENT.PATTERN_SAVED, (e) => {
    borrowed = false;
    if (pendingName && e.detail?.name !== pendingName) {
      clearTimeout(timer);
      pendingName = '';
      pendingState = null;
    }
  });
  // Back in the Studio with the grid unchanged from the saved phrase: safe again
  addEventListener('routeChanged', (e) => {
    if (e.detail?.route === 'studio' && borrowed && !hasUnsavedChanges()) {
      borrowed = false;
      Bus.emit(BUS_EVENT.AUTOSAVE_TOGGLED, { on: isAutoSaveOn() });
    }
  });
  // The saved setting arrives with the profile; refresh the save UI to match
  Bus.on(BUS_EVENT.PROFILE_LOADED, () => Bus.emit(BUS_EVENT.AUTOSAVE_TOGGLED, { on: isAutoSaveOn() }));
  // Leaving the tab or the Studio: save now rather than lose the last edits
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAutoSave();
  });
  addEventListener('hashchange', flushAutoSave);
}
