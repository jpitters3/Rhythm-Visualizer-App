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
  "D Celtic": {
    ding: "D3",
    map: { "1": "A3", "2": "C4", "3": "D4", "4": "E4", "5": "F4", "6": "G4", "7": "A4", "8": "D5" }
  },
  "D Soheila": {
    ding: "D3",
    map: { "1": "A3", "2": "Bb3", "3": "D4", "4": "E4", "5": "F4", "6": "G4", "7": "A4", "8": "C5" }
  },
  "D Shared": {
    ding: "D3",
    map: { "1": "A3", "2": "D4", "3": "E4", "4": "F4", "5": "G4", "6": "A4" }
  },
  "D Aegean": {
    ding: "D3",
    map: { "1": "Fs3", "2": "A3", "3": "Cs4", "4": "D4", "5": "Fs4", "6": "Gs4", "7": "A4", "8": "Cs5" }
  },
  "F# Low Pygmy": {
    ding: "Fs3",
    map: { "1": "Gs3", "2": "A3", "3": "Cs4", "4": "E4", "5": "Fs4", "6": "Gs4", "7": "A4", "8": "Cs5" }
  },
  "D Pygmy": {
    ding: "D3",
    map: { "1": "G3", "2": "A3", "3": "Bb3", "4": "D4", "5": "F4", "6": "G4", "7": "A4", "8": "C5" }
  },
  "F Low Pygmy": {
    ding: "F3",
    map: { "1": "G3", "2": "A3", "3": "Bb3", "4": "C4", "5": "Eb4", "6": "F4", "7": "G4", "8": "Ab4" }
  }
  // ,
  // "B Celtic": {
  //   ding: "B3",
  //   map: { "1": "Fs3", "2": "A3", "3": "B3", "4": "Cs4", "5": "D4", "6": "E4", "7": "Fs4", "8": "B4" }
  // }
};

export const SCALE_KEY_LOCAL = 'gp_scale';
export const SCALE_KEY_REMOTE = 'handpan_scale';
export const AUDIO_DELAY = 0.1; // 100ms scheduling buffer for snappiness
export const VISUAL_HEADSTART = 0.04; // 40ms visual lead-time to compensate for rAF jitter (~16ms) + output buffer lag
export const ACCENT_RMS_MULTIPLIER = 2.0; // Accents must be 2x louder than base sensitivity
export const COMPOSE_KEY = 'groovepan_compose_mode';