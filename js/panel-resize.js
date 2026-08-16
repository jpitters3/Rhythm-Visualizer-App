// Mobile-only draggable divider between .left (the grid) and .handpan-panel.
// Dragging it sets .handpan-panel's height directly; .left (flex: 1) just
// fills whatever's left. The pan's own size inside the panel is driven
// directly from here too (an inline max-width on .handpan-wrap, computed
// from the panel's actual chrome height + the image's real aspect ratio)
// rather than via CSS container-query units — cqh combined with a changing
// custom property turned out not to reliably re-resolve unless the
// container's own size *also* changed on the same tick, which made the pan
// intermittently render smaller than it should. Fully deterministic JS
// control sidesteps that entirely.
//
// The drag-up ceiling — and the default starting position — is the pan's
// natural full size; dragging down is the only way to shrink it and reveal
// more of the grid.

import { Bus, BUS_EVENT } from './bus.js';

const MOBILE_QUERY = '(max-width: 900px)';
const MIN_PANEL_HEIGHT = 160; // matches .handpan-panel's min-height in CSS
const MIN_LEFT_HEIGHT = 160;  // absolute floor if a measure row can't be measured yet
const MAX_ROW_HEIGHT_FOR_MIN = 220; // see measureOneRowHeight()
const STORAGE_KEY = 'gp_handpanPanelHeight';
const KEYBOARD_STEP = 24;

export function initPanelResize() {
  const handle = document.getElementById('panelResizeHandle');
  const panel = document.querySelector('.handpan-panel');
  const main = document.getElementById('main');
  const left = document.querySelector('.left');
  const measuresEl = document.getElementById('measures');
  const wrap = document.getElementById('handpanWrap');
  const img = document.getElementById('handpanImg');
  if (!handle || !panel || !main || !wrap) return;

  const mq = window.matchMedia(MOBILE_QUERY);
  let cachedMaxHeight = null;

  // Everything in .left OTHER than #measures (phrase name row, etc.) — same
  // "measure what's actually there" approach as measureChromeHeight() below.
  function measureLeftChromeHeight() {
    if (!left || !measuresEl) return 0;
    let h = 0;
    Array.from(left.children).forEach(child => {
      if (child === measuresEl) return;
      if (getComputedStyle(child).display === 'none') return;
      h += child.getBoundingClientRect().height;
    });
    return h;
  }

  function measureOneRowHeight() {
    const row = measuresEl?.querySelector('.measure-row');
    if (!row) return 0;
    const cs = getComputedStyle(row);
    const rowMargins = parseFloat(cs.marginTop || 0) + parseFloat(cs.marginBottom || 0);

    const header = row.querySelector('.measure-header');
    const firstLabels = row.querySelector('.labels');
    const firstGrid = row.querySelector('.grid');

    const h = firstGrid
      ? (header?.getBoundingClientRect().height || 0)
        + (firstLabels?.getBoundingClientRect().height || 0)
        + firstGrid.getBoundingClientRect().height
        + rowMargins
      : row.getBoundingClientRect().height + rowMargins;

    return Math.min(h, MAX_ROW_HEIGHT_FOR_MIN);
  }

  // The grid needs at least enough room for its own chrome plus one measure
  // row — falls back to MIN_LEFT_HEIGHT before the grid has rendered a row
  // to measure (e.g. very first paint).
  function minLeftHeightNeeded() {
    const rowH = measureOneRowHeight();
    if (!rowH) return MIN_LEFT_HEIGHT;
    return measureLeftChromeHeight() + rowH;
  }

  // Actual height of everything in .handpan-panel OTHER than .handpan-wrap
  // (tabs row, ghost-note row, etc.) — measured live rather than guessed,
  // since a wrong guess leaves either a gap below the ghost row (guess too
  // big) or clips it (guess too small). These children size themselves from
  // their own content regardless of the panel's own container-type: size,
  // so measuring them directly is safe at any panel height.
  function measureChromeHeight() {
    let h = 0;
    Array.from(panel.children).forEach(child => {
      if (child === wrap) return; // this is what the reserve is FOR, not part of it
      const cs = getComputedStyle(child);
      if (cs.display === 'none') return;
      // Flex items don't collapse margins, so each child's own margin box
      // (not just its border box) is real, rendered vertical space between
      // panel children — omitting it here previously left the panel a few
      // px taller than its content needed, and that slack turns into a
      // visible gap above the transport reserve once it adds up.
      h += child.getBoundingClientRect().height
        + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom);
    });
    return h;
  }

  function imageAspect() {
    // height / width — square fallback if the image's real size isn't known yet.
    return (img && img.naturalWidth && img.naturalHeight) ? img.naturalHeight / img.naturalWidth : 1;
  }

  function wrapVerticalPadding() {
    const cs = getComputedStyle(wrap);
    return parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  }

  function wrapHorizontalPadding() {
    const cs = getComputedStyle(wrap);
    return parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
  }

  // Sets .handpan-wrap's own max-width directly from the panel's CURRENT
  // height, so the pan scales down as the panel shrinks (dragging down)
  // instead of just getting clipped by the panel's overflow: hidden.
  function syncWrapSize(panelHeight, chrome, padV, aspect) {
    const panelWidth = panel.getBoundingClientRect().width;
    const availableForContentHeight = Math.max(0, panelHeight - chrome - padV);
    // availableForContentHeight budgets the IMAGE's height, not the wrap's
    // own (border-box) width — the image renders at wrap-width-minus-padH,
    // so the wrap's max-width needs padH added back on top, or the wrap (and
    // the pan) renders smaller than the available space actually allows.
    const imageWidthFromHeight = availableForContentHeight / aspect;
    const wrapWidthFromHeight = imageWidthFromHeight + wrapHorizontalPadding();
    wrap.style.maxWidth = `${Math.min(panelWidth, wrapWidthFromHeight)}px`;
  }

  // The pan's natural, fully-expanded height: chrome + however tall the
  // wrap renders at full panel width, computed directly from the handpan
  // image's real (decoded) aspect ratio. The image itself renders at the
  // wrap's width MINUS its horizontal padding (.handpan-img is width: 100%
  // of the wrap's content box, not its border box) — skipping that
  // subtraction overstates the image's height by however much horizontal
  // padding the wrap has, which was negligible when that padding was a few
  // px but became a visible gap above the transport bar once it grew.
  function computeNaturalMaxHeight() {
    const chrome = measureChromeHeight();
    const width = panel.getBoundingClientRect().width || main.getBoundingClientRect().width;
    const imageWidth = Math.max(0, width - wrapHorizontalPadding());
    return chrome + imageWidth * imageAspect() + wrapVerticalPadding();
  }

  // Recomputes the cached ceiling — call whenever the panel's width could
  // have changed (init, orientation/resize), not on every drag frame.
  function refreshMaxHeight() {
    cachedMaxHeight = computeNaturalMaxHeight();
    return cachedMaxHeight;
  }

  // .controls-transport is `position: fixed; bottom: 0` on mobile (see
  // css/transport-controls.css) — it visually covers the bottom of the
  // viewport without occupying any space in normal document flow, so
  // #main has no idea it exists. .handpan-panel is the LAST child in the
  // column flex (.left, the divider, then this panel), so its bottom edge
  // is anchored to #main's own bottom edge — which extends BEHIND that
  // fixed bar. Critically, that means changing the panel's height does
  // NOT move its bottom edge at all; shrinking it just gives .left (flex:
  // 1) more room and moves the panel's TOP edge down, while the bottom
  // stays put, still covered. Only padding pushes the actual CONTENT up
  // off that anchored-but-obscured bottom edge, which is why this needs
  // to be padding-bottom rather than folded into the height math.
  // Measured as "how far past the bar's own top edge does the panel's
  // (invariant) bottom-anchor extend" rather than just the bar's own
  // height — #main's total rendered height doesn't necessarily line up
  // exactly with the viewport's bottom edge (there can be a few px of
  // slack from the page's own layout), so assuming reserve === bar height
  // silently undershoots by however much that slack is. This measures the
  // actual gap directly instead of assuming the two coincide.
  function transportBarHeight() {
    const bar = document.querySelector('.controls-transport');
    if (!bar) return 0;
    const cs = getComputedStyle(bar);
    if (cs.position !== 'fixed' || cs.display === 'none') return 0;
    return Math.max(0, panel.getBoundingClientRect().bottom - bar.getBoundingClientRect().top);
  }

  function syncTransportReserve() {
    panel.style.paddingBottom = `${transportBarHeight()}px`;
  }

  // .handpan-panel is box-sizing: border-box, so its specified height
  // already INCLUDES padding-bottom — the reserve doesn't add extra room
  // for content, it eats into it. Flex children don't know or care that
  // padding claimed part of "their" box either; they just render at their
  // own natural combined size regardless, overflowing straight through the
  // reserve if the height was sized as if the reserve wasn't there. So
  // every internal calculation here works in CONTENT terms (chrome + wrap,
  // no reserve) and only the final assignment to panel.style.height adds
  // the reserve back on top. Callers (drag/keyboard) still pass and
  // receive plain rendered (total, border-box) heights, matching what
  // getBoundingClientRect() naturally gives them — the content/total split
  // is an internal-only concern.
  function applyHeight(desiredTotalPx) {
    const reserve = transportBarHeight();
    const chrome = measureChromeHeight();
    const padV = wrapVerticalPadding();
    // The tabs row + ghost-note row must always fit — the pan is what
    // shrinks (down to 0 if it truly has to) to make room, never the other
    // way around. Without this floor, "leave the grid some room" below
    // could squeeze the panel shorter than chrome itself needs, clipping
    // the ghost row instead of just shrinking the pan.
    const floorTotal = Math.max(MIN_PANEL_HEIGHT, chrome + padV) + reserve;
    const ceilingTotal = Math.max(floorTotal, Math.min(
      (cachedMaxHeight ?? refreshMaxHeight()) + reserve,
      main.getBoundingClientRect().height - minLeftHeightNeeded(),
    ));
    const clampedTotal = Math.min(ceilingTotal, Math.max(floorTotal, desiredTotalPx));
    panel.style.height = `${clampedTotal}px`;
    syncWrapSize(clampedTotal - reserve, chrome, padV, imageAspect());
    return clampedTotal;
  }

  function restoreSavedHeight() {
    if (!mq.matches) return;
    syncTransportReserve();
    const maxContent = refreshMaxHeight();
    const saved = parseFloat(localStorage.getItem(STORAGE_KEY));
    applyHeight(Number.isFinite(saved) ? saved : maxContent + transportBarHeight());
  }

  // Restore saved panel height when studio is opened
  window.addEventListener('routeChanged', (e) => {
    if (e.detail.route === 'studio') restoreSavedHeight();
  });

  // #measures has no rows yet when this module first runs (grid renders
  // later), so minLeftHeightNeeded() can't measure one until now — re-clamp
  // once it can. Also keeps the cap correct whenever subdivision/measure
  // count changes row height afterward.
  Bus.on(BUS_EVENT.GRID_RENDERED, () => {
    if (mq.matches) applyHeight(panel.getBoundingClientRect().height);
  });

  // Leaving mobile: drop the inline sizing so the desktop CSS (flex/stretch,
  // its own cqh rule) takes back over instead of being pinned to a stale
  // mobile value.
  mq.addEventListener('change', (e) => {
    if (e.matches) {
      restoreSavedHeight();
    } else {
      panel.style.height = '';
      panel.style.paddingBottom = '';
      wrap.style.maxWidth = '';
    }
  });

  // Width (or the transport bar's own height, e.g. a safe-area change on
  // rotate) can shift without crossing the mobile breakpoint.
  window.addEventListener('resize', () => {
    if (!mq.matches) return;
    syncTransportReserve();
    refreshMaxHeight();
    applyHeight(panel.getBoundingClientRect().height);
  });

  let dragging = false;
  let startY = 0;
  let startHeight = 0;

  function onPointerDown(e) {
    if (!mq.matches) return;
    dragging = true;
    startY = e.clientY;
    startHeight = panel.getBoundingClientRect().height;
    handle.classList.add('dragging');
    handle.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!dragging) return;
    applyHeight(startHeight - (e.clientY - startY));
  }

  function onPointerUp(e) {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    handle.releasePointerCapture?.(e.pointerId);
    localStorage.setItem(STORAGE_KEY, parseFloat(panel.style.height) || '');
  }

  handle.addEventListener('pointerdown', onPointerDown);
  handle.addEventListener('pointermove', onPointerMove);
  handle.addEventListener('pointerup', onPointerUp);
  handle.addEventListener('pointercancel', onPointerUp);

  // Keyboard: arrow keys nudge the height for anyone not dragging by touch/mouse.
  handle.addEventListener('keydown', (e) => {
    if (!mq.matches) return;
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const current = panel.getBoundingClientRect().height;
    const next = applyHeight(e.key === 'ArrowUp' ? current + KEYBOARD_STEP : current - KEYBOARD_STEP);
    localStorage.setItem(STORAGE_KEY, next);
  });

  restoreSavedHeight();

  // The image may not have decoded yet at init (aspect defaults to 1:1
  // until it has) — once it has, redo the sizing with its real aspect
  // ratio instead of leaving the fallback guess in place. Only matters for
  // a saved-height-less first visit; restoreSavedHeight() already skips
  // this recompute whenever there's an explicit user choice.
  if (img && !img.complete) {
    img.addEventListener('load', () => {
      if (mq.matches && !localStorage.getItem(STORAGE_KEY)) restoreSavedHeight();
    }, { once: true });
  }

  // The transport bar's real height isn't known at a fixed point in time —
  // its buttons/slider populate asynchronously, so a single measurement at
  // init can catch it mid-render (too short) with nothing to correct it
  // afterward. Watch it directly instead of guessing when it's "ready".
  const transportBar = document.querySelector('.controls-transport');
  if (transportBar && 'ResizeObserver' in window) {
    let lastBarHeight = null;
    const barObserver = new ResizeObserver(() => {
      if (!mq.matches) return;
      const h = transportBar.getBoundingClientRect().height;
      if (h === lastBarHeight) return;
      lastBarHeight = h;
      syncTransportReserve();
      applyHeight(panel.getBoundingClientRect().height);
    });
    barObserver.observe(transportBar);
  }
}
