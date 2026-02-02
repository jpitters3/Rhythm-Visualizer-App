/**
 * Core Rhythm Logic & State
 * 
 * extracted to resolve circular dependencies.
 * This file must be loaded BEFORE grid-context.js or noteplayer.js
 */

// Global State
let timeSignature = localStorage.getItem('defaultTimeSignature') || '4/4';
let STEPS = 32; // Default, will be recalculated

function calculateSteps(ts, currentMode) {
  const parts = ts.split('/');
  const num = parseInt(parts[0]);
  const den = parseInt(parts[1]);

  const base = (currentMode === '16') ? 16 : 8;
  const mult = base / den;
  return num * mult;
}

function getTimeSignature() {
  return timeSignature;
}

function setTimeSignatureState(ts) {
  if (!ts) return;
  if (!ts.includes('/')) return;

  timeSignature = ts;
  localStorage.setItem('defaultTimeSignature', ts);
}

// Expose immediately
window.calculateSteps = calculateSteps;
window.getTimeSignature = getTimeSignature;
window.setTimeSignatureState = setTimeSignatureState;

// Initialize global STEPS (assuming default mode '8' if not yet defined, 
// though Grid A might not exist yet. This is just a safe default.)
window.STEPS = calculateSteps(timeSignature, '8'); 
