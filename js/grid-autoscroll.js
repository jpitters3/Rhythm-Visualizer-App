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
    // Auto-hide scrollbar logic
    let scrollbarTimeout;
    const showScrollbar = () => {
      measuresEl.classList.add('scrollbar-visible');
      clearTimeout(scrollbarTimeout);
      scrollbarTimeout = setTimeout(() => {
        measuresEl.classList.remove('scrollbar-visible');
      }, 5000);
    };

    measuresEl.addEventListener('scroll', () => {
      showScrollbar(); // Show on manual scroll
    });

    // We also need to show it on auto-scroll hits
    // We'll wrap the scrollTo in a common function if possible, or just call showScrollbar()
    
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
    let lastActiveIndex = -1;
    for (let i = ctx.innerLabels.length - 1; i >= 0; i--) {
      const lbl = ctx.innerLabels[i];
      if (Array.isArray(lbl)) {
        if (lbl.some(l => l && l !== '')) { lastActiveIndex = i; break; }
      } else if (lbl && lbl !== '') {
        lastActiveIndex = i; break;
      }
    }

    if (currentStep > lastActiveIndex && lastActiveIndex >= 0) {
      if (lastScrolledMeasure !== -2) { // Use -2 as a special state for "scrolled mid-measure"
        // Instant Jump to Top
        measuresEl.style.scrollBehavior = 'auto';
        measuresEl.scrollTop = 0;
        measuresEl.style.scrollBehavior = ''; // Reset to CSS default (smooth)
        lastScrolledMeasure = -2;
      }
      return;
    }

    // 2. Standard Loop-Back detection
    if (currentMeasureIndex === 0 && lastScrolledMeasure > 0) {
      measuresEl.style.scrollBehavior = 'auto';
      measuresEl.scrollTop = 0;
      measuresEl.style.scrollBehavior = '';
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
          // Trigger scrollbar visibility
          measuresEl.classList.add('scrollbar-visible');
          // Reset timer logic from above is handled by the 'scroll' event listener
          
          // Use CSS scroll-behavior: smooth for better hardware acceleration
          measuresEl.scrollTop = targetScroll;
        }
      }
    }
    
    lastScrolledMeasure = currentMeasureIndex;
  });
}

/** Reset internal state (e.g. when a new pattern is loaded) */
export function resetGridAutoscroll() {
  lastScrolledMeasure = -1;
  fixedSlotTop = -1;
  const measuresEl = document.getElementById('measures');
  if (measuresEl) {
    measuresEl.style.scrollBehavior = 'auto';
    measuresEl.scrollTop = 0;
    measuresEl.style.scrollBehavior = '';
  }
}
