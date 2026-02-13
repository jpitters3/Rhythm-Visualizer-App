/**
 * Application Configuration & Constants
 */

// Access the 'base' from vite.config.js
export const BASE_PATH = import.meta.env.BASE_URL;

export const ADMIN_EMAILS = new Set([
  "jpitters3@gmail.com",
]);

export const SCALES = {
  "D Kurd": {
    ding: "D3",
    map: { "1": "A3", "2": "Bb3", "3": "C4", "4": "D4", "5": "E4", "6": "F4", "7": "G4", "8": "A4" }
  },
  "D Major": {
    ding: "D3",
    map: { "1": "G3", "2": "A3", "3": "B3", "4": "Cs4", "5": "D4", "6": "E4", "7": "Fs4", "8": "A4" }
  },
  "D Amara": {
    ding: "D3",
    map: { "1": "A3", "2": "C4", "3": "D4", "4": "E4", "5": "F4", "6": "G4", "7": "A4", "8": "C5" }
  },
  "B Celtic": {
    ding: "B3",
    map: { "1": "Fs3", "2": "A3", "3": "B3", "4": "Cs4", "5": "D4", "6": "E4", "7": "Fs4", "8": "B4" }
  }
};

export const SCALE_KEY_LOCAL = 'gp_scale';
export const SCALE_KEY_REMOTE = 'handpan_scale';
export const AUDIO_DELAY = 0.2;
export const ACCENT_RMS_MULTIPLIER = 2.0; // Accents must be 2x louder than base sensitivity