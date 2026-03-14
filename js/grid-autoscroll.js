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
    measuresEl.addEventListener('scroll', () => updateScrollFades(measuresEl));
  }

  addTickObserver((ctx) => {
    // Only act on Grid A and only when NOT in presentation mode
    if (!ctx || ctx.id !== 'A') return;
    if (document.body.classList.contains('present')) return;

    const measuresEl = document.getElementById('measures');
    if (!measuresEl) return;

    const rows = measuresEl.getElementsByClassName('measure-row');
    if (!rows || rows.length === 0) {
      fixedSlotTop = -1;
      return;
    }

    // Capture the "fixed slot" position (Top of Measure 3) once
    if (fixedSlotTop < 0 && rows.length >= 3) {
      fixedSlotTop = rows[2].offsetTop;
    }

    const stepsPerMeasure = ctx.stepsPerMeasure;
    if (stepsPerMeasure <= 0) return;

    const currentMeasureIndex = Math.floor(ctx.step / stepsPerMeasure);

    // Only attempt scroll if we moved to a new measure to avoid fighting manual scroll
    if (currentMeasureIndex === lastScrolledMeasure) return;
    lastScrolledMeasure = currentMeasureIndex;

    // Logic: Scroll in 2-measure chunks.
    // measures 1-4 (index 0-3) stay at top (targetScroll = 0).
    // measures 5-6 (index 4-5) scroll up to start at slot 3.
    // etc.
    
    let targetScroll = 0;
    if (currentMeasureIndex >= 4) {
      // Find the start of the current 2-measure chunk (4, 6, 8, etc.)
      const chunkStart = currentMeasureIndex - (currentMeasureIndex % 2);
      const chunkRow = rows[chunkStart];
      
      if (chunkRow && fixedSlotTop >= 0) {
        targetScroll = chunkRow.offsetTop - fixedSlotTop;
      }
    }

    // Apply scroll via native scrollTo.
    if (measuresEl.scrollTop !== targetScroll) {
      measuresEl.scrollTo({
        top: targetScroll,
        behavior: 'smooth'
      });
    }
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
