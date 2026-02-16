export const BUS_EVENT = {
  AUTH_LOGOUT: 'auth:logout',
  AUTH_LOGIN: 'auth:login',
  COURSE_UNLOCKED: 'course:unlocked',
  REQUEST_LOAD_LESSON: 'lesson:load',
  SIDEBAR_CLOSE_ALL: 'sidebar:close-all',
  NOTIFY_STATE_CHANGE: 'state:change',
  COURSE_DATA_CHANGED: 'course:data-changed',
  PLAYBACK_START: 'playback:start',
  PLAYBACK_STOP: 'playback:stop',
  PATTERN_REFRESH_NEEDED: 'pattern:refresh-needed',
  PROFILE_LOAD_NEEDED: 'profile:load-needed',
  COACHING_EVALUATE: 'coaching:evaluate',
  SET_ACCENT_SENSITIVITY: 'transcription:set-accent-sensitivity',
  NOTE_DETECTED: 'transcription:note-detected',
  ACCENT_DETECTED: 'transcription:accent-detected',
  GRID_RENDERED: 'grid:rendered',
  CHALLENGE_CORRECTION: 'transcription:challenge-correction'
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
