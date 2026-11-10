/**
 * grid-autoscroll.js
 *
 * Subscribes to the noteplayer tick and smoothly scrolls the #measures
 * container so the currently playing measure-row stays in view. This runs
 * in the normal (non-presentation) view only.
 */

import { addTickObserver } from './noteplayer.js';
import { gridA } from './grid-context.js';

const FOLLOW_KEY = 'gp_followPlayback';

let lastScrolledMeasure = -1;
let fixedSlotTop = -1;
let following = readFollowPref();

function readFollowPref() {
  try { return localStorage.getItem(FOLLOW_KEY) !== 'off'; } catch { return true; }
}

// Follow on: the grid scrolls with playback. Off: only the cell pulse moves.
function setFollowing(on, { remember = true } = {}) {
  following = on;
  if (remember) {
    try { localStorage.setItem(FOLLOW_KEY, on ? 'on' : 'off'); } catch { /* private mode */ }
  }
  if (on) lastScrolledMeasure = -1; // catch up with the playing measure on the next tick
  document.querySelectorAll('[data-follow-toggle]').forEach(b => b.setAttribute('aria-pressed', String(on)));
}

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

    // Scrolling the grid yourself during playback stops following until it's switched back on.
    // These events only come from people, never from the auto-scroll below.
    const userScrolled = () => {
      if (following && gridA.playing) setFollowing(false, { remember: false });
    };
    measuresEl.addEventListener('wheel', userScrolled, { passive: true });
    measuresEl.addEventListener('touchmove', userScrolled, { passive: true });
    measuresEl.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) userScrolled();
    });

    // We also need to show it on auto-scroll hits
    // We'll wrap the scrollTo in a common function if possible, or just call showScrollbar()
    
  }

  document.querySelectorAll('[data-follow-toggle]').forEach(b => {
    b.addEventListener('click', () => setFollowing(!following));
  });
  setFollowing(following, { remember: false });

  addTickObserver((ctx) => {
    // Only act on Grid A and only when NOT in presentation mode
    if (!ctx || ctx.id !== 'A') return;
    if (!following) return;
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

    // Both "loop back" shortcuts below assume every grid plays on an
    // infinite loop (true for Studio, false for a one-shot phrase — see
    // js/grid-context.js's loopPlayback, js/noteplayer.js's matching
    // scheduler guard). A game like Chord Play Along can have trailing
    // empty beats in its very last measure (only beats 1/2/3 are ever
    // filled); without this guard, stepping past them here reads as "the
    // loop just wrapped" and snaps the view back to measure 1 before the
    // phrase has actually ended — the opposite of what a non-looping grid
    // wants, which is to stay put on its last measure.
    if (ctx.loopPlayback !== false) {
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
