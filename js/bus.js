export const BUS_EVENT = {
  AUTH_LOGOUT: 'auth:logout',
  AUTH_LOGIN: 'auth:login',
  OPEN_COURSE: 'course:open',
  COURSE_UNLOCKED: 'course:unlocked',
  REQUEST_LOAD_LESSON: 'lesson:load',
  SIDEBAR_CLOSE_ALL: 'sidebar:close-all',
  NOTIFY_STATE_CHANGE: 'state:change',
  COURSE_DATA_CHANGED: 'course:data-changed',
  PLAYBACK_START: 'playback:start',
  PLAYBACK_STOP: 'playback:stop',
  PATTERN_REFRESH_NEEDED: 'pattern:refresh-needed',
  PROFILE_LOAD_NEEDED: 'profile:load-needed',
  PROFILE_LOADED: 'profile:loaded',
  COACHING_EVALUATE: 'coaching:evaluate',
  SET_ACCENT_SENSITIVITY: 'transcription:set-accent-sensitivity',
  NOTE_DETECTED: 'transcription:note-detected',
  ACCENT_DETECTED: 'transcription:accent-detected',
  GRID_RENDERED: 'grid:rendered',
  GRID_CHANGED: 'grid:changed',
  PATTERN_SAVED: 'pattern:saved',
  CHALLENGE_CORRECTION: 'transcription:challenge-correction',
  SHOW_UPGRADE_MODAL: 'monetization:show-upgrade-modal',
  SHOW_CONGRATS_MODAL: 'monetization:show-congrats-modal',
  OPEN_AUTH_MODAL: 'auth:open-modal',
  CARET_CHANGED: 'caret-changed',
  CELL_CLICKED: 'grid:cell-clicked',
  OPEN_STUDENT_ASSIGNMENTS: 'assignments:open-student',
  OPEN_ASSIGNMENTS: 'assignments:open',
  PRACTICE_ITEMS_CHANGED: 'practice:items-changed',
  GRID_ZOOM_CHANGED: 'grid:zoom-changed',
};

/**
 * Lightweight wrapper around window.dispatchEvent for centralized event handling.
 */
export const Bus = {
  /**
   * Emit a custom event.
   * @param {string} event - Event name from BUS_EVENT constants.
   * @param {any} [detail] - Optional payload.
   */
  emit: (event, detail) => {
    // console.log(`[BUS] EMIT: ${event}`, detail);
    window.dispatchEvent(new CustomEvent(event, { detail }));
  },

  /**
   * Listen for an event.
   * @param {string} event - Event name.
   * @param {Function} cb - Callback handler.
   */
  on: (event, cb) => {
    window.addEventListener(event, cb);
  },

  /**
   * Remove an event listener.
   */
  off: (event, cb) => {
    window.removeEventListener(event, cb);
  }
};
