/**
 * Core Rhythm Logic & State
 * 
 * extracted to resolve circular dependencies.
 * This file must be loaded BEFORE grid-context.js or noteplayer.js
 */

// Global State
let timeSignature = localStorage.getItem('defaultTimeSignature') || '4/4';
export let STEPS = 32; // Default, will be recalculated

export function calculateSteps(ts, currentMode) {
  const parts = ts.split('/');
  const num = parseInt(parts[0]);
  const den = parseInt(parts[1]);

  const base = (currentMode === '16') ? 16 : 8;
  const mult = base / den;
  return num * mult;
}

export function getTimeSignature() {
  return timeSignature;
}

export function setTimeSignatureState(ts) {
  if (!ts) return;
  if (!ts.includes('/')) return;

  timeSignature = ts;
  localStorage.setItem('defaultTimeSignature', ts);
}

// Initialize global STEPS (assuming default mode '8')
STEPS = calculateSteps(timeSignature, '8');

// Legacy Expose
window.STEPS = STEPS;
window.calculateSteps = calculateSteps;
window.getTimeSignature = getTimeSignature;
window.setTimeSignatureState = setTimeSignatureState;

// Define 'mode' getter for backward compatibility (init.js uses it)
// But 'mode' depends on activeGrid which is in grid-context.js / state.js
// We can't easily access activeGrid here without circular dependency if we import it.
// Instead, let's update init.js to use activeGrid.mode.
