/**
 * grid-autoscroll.js
 *
 * Subscribes to the noteplayer tick and smoothly scrolls the #measures
 * container so the currently playing measure-row stays in view. This runs
 * in the normal (non-presentation) view only.
 */

import { addTickObserver, getPlaybackPosition } from './noteplayer.js';

let lastScrolledMeasure = -1;
let fixedSlotTop = -1;

export function initGridAutoscroll() {
  const measuresEl = document.getElementById('measures');
  if (measuresEl) {
    // Add scroll listener to update fades when the user manually scrolls
    // Throttled with rAF to avoid layout thrashing
    let scrollTicking = false;
    measuresEl.addEventListener('scroll', () => {
      if (!scrollTicking) {
        window.requestAnimationFrame(() => {
          updateScrollFades(measuresEl);
          scrollTicking = false;
        });
        scrollTicking = true;
      }
    });
    
    // Automatically update scroll fades when the UI changes size or layout
    const resizeObserver = new ResizeObserver(() => updateScrollFades(measuresEl));
    resizeObserver.observe(measuresEl);

    // Automatically update scroll fades when measures are added/removed dynamically
    const mutationObserver = new MutationObserver(() => updateScrollFades(measuresEl));
    mutationObserver.observe(measuresEl, { childList: true, subtree: true });

    // Fallback initial check once DOM settles 
    setTimeout(() => updateScrollFades(measuresEl), 200);
  }

  addTickObserver((ctx) => {
    // Only act on Grid A and only when NOT in presentation mode
    if (!ctx || ctx.id !== 'A') return;
    if (document.body.classList.contains('present')) return;

    const measuresEl = document.getElementById('measures');
    if (!measuresEl) return;

    const rows = measuresEl.getElementsByClassName('measure-row');
    if (!rows || rows.length === 0) return;

    const stepsPerMeasure = ctx.stepsPerMeasure;
    if (stepsPerMeasure <= 0) return;

    const currentStep = ctx.step;
    const currentMeasureIndex = Math.floor(currentStep / stepsPerMeasure);

    // --- LIGHTWEIGHT CHECKS (Every Beat) ---

    // 1. Instant Loop Hack
    // We only need to check this if we haven't already scrolled to top for this loop
    const lastActiveIndex = (() => {
      // Small optimization: cache this calculation for the current pattern
      if (ctx._lastActiveIndex !== undefined && ctx._lastLabelsLength === ctx.innerLabels.length) {
        return ctx._lastActiveIndex;
      }
      let found = -1;
      for (let i = ctx.innerLabels.length - 1; i >= 0; i--) {
        const lbl = ctx.innerLabels[i];
        if (Array.isArray(lbl)) {
          if (lbl.some(l => l && l !== '')) { found = i; break; }
        } else if (lbl && lbl !== '') {
          found = i; break;
        }
      }
      ctx._lastActiveIndex = found;
      ctx._lastLabelsLength = ctx.innerLabels.length;
      return found;
    })();

    if (currentStep > lastActiveIndex && lastActiveIndex >= 0) {
      if (lastScrolledMeasure !== -2) { // Use -2 as a special state for "scrolled mid-measure"
        measuresEl.scrollTo({ top: 0, behavior: 'instant' });
        lastScrolledMeasure = -2;
      }
      return;
    }

    // 2. Standard Loop-Back detection
    if (currentMeasureIndex === 0 && lastScrolledMeasure > 0) {
      measuresEl.scrollTo({ top: 0, behavior: 'instant' });
      lastScrolledMeasure = 0;
      return;
    }

    // --- PERFORMANCE GUARD (Once Per Measure) ---
    // Heavily intensive layout/visibility logic only runs when measure changes
    if (currentMeasureIndex === lastScrolledMeasure) return;

    // Visibility-aware look-ahead logic
    const scrollTop = measuresEl.scrollTop;
    const scrollHeight = measuresEl.clientHeight;
    const scrollBottom = scrollTop + scrollHeight;

    // Helper to find visible range
    let lastFullyVisibleIndex = -1;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowTop = row.offsetTop;
      const rowBottom = rowTop + row.offsetHeight;

      if (rowTop >= scrollTop && rowBottom <= scrollBottom) {
        lastFullyVisibleIndex = i;
      }
    }

    // Trigger proactive scroll
    if (currentMeasureIndex >= lastFullyVisibleIndex) {
      const targetRow = rows[currentMeasureIndex];
      if (targetRow) {
        const targetScroll = targetRow.offsetTop;
        if (measuresEl.scrollTop !== targetScroll) {
          measuresEl.scrollTo({ top: targetScroll, behavior: 'smooth' });
        }
      }
    }
    
    lastScrolledMeasure = currentMeasureIndex;
  });
}

/** 
 * Updates masks to show 'misty' fade at top/bottom if content overflows
 */
function updateScrollFades(el) {
  if (!el) return;

  const scrollTop = el.scrollTop;
  const scrollHeight = el.scrollHeight;
  const clientHeight = el.clientHeight;

  // Threshold of 10px to avoid flickering on tiny scrolls
  const hasTop = scrollTop > 10;
  const hasBottom = (scrollHeight - scrollTop - clientHeight) > 10;

  el.classList.remove('fade-top', 'fade-bottom', 'fade-both');

  if (hasTop && hasBottom) {
    el.classList.add('fade-both');
  } else if (hasTop) {
    el.classList.add('fade-top');
  } else if (hasBottom) {
    el.classList.add('fade-bottom');
  }
}

/** Reset internal state (e.g. when a new pattern is loaded) */
export function resetGridAutoscroll() {
  lastScrolledMeasure = -1;
  fixedSlotTop = -1;
  const measuresEl = document.getElementById('measures');
  if (measuresEl) {
    measuresEl.scrollTo({ top: 0 });
    updateScrollFades(measuresEl);
  }
}
