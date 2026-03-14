/**
 * grid-autoscroll.js
 *
 * Subscribes to the noteplayer tick and smoothly scrolls the #measures
 * container so the currently playing measure-row stays in view. This runs
 * in the normal (non-presentation) view only.
 */

import { addTickObserver } from './noteplayer.js';

let lastScrolledMeasure = -1;

export function initGridAutoscroll() {
  addTickObserver((ctx) => {
    // Only act on Grid A and only when NOT in presentation mode
    if (!ctx || ctx.id !== 'A') return;
    if (document.body.classList.contains('present')) return;

    const stepsPerMeasure = ctx.stepsPerMeasure;
    if (!stepsPerMeasure || stepsPerMeasure <= 0) return;

    const currentMeasure = Math.floor(ctx.step / stepsPerMeasure);

    // Don't scroll if we're still in the same measure
    if (currentMeasure === lastScrolledMeasure) return;

    const measuresEl = document.getElementById('measures');
    if (!measuresEl) return;

    const rows = measuresEl.getElementsByClassName('measure-row');
    if (!rows || rows.length === 0) return;

    const targetRow = rows[currentMeasure];
    if (!targetRow) return;

    // Check if the row is approaching the bottom of the viewport
    const rect = targetRow.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    
    // Threshold: 75% of the viewport. If the row is below this, scroll it up.
    if (rect.bottom > viewportHeight * 0.75) {
      lastScrolledMeasure = currentMeasure;
      const rowTop = rect.top + window.scrollY;
      const offset = 120; // Keep it a bit lower than the very top for context
      window.scrollTo({ top: rowTop - offset, behavior: 'smooth' });
    }
  });
}

/** Reset internal state (e.g. when a new pattern is loaded) */
export function resetGridAutoscroll() {
  lastScrolledMeasure = -1;
}
