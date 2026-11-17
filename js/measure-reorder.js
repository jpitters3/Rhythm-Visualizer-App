/* Drag-to-reorder measure cards. The dragged cards stay in the DOM as the
   drop slot; the other cards slide (FLIP) as the slot moves. Data changes
   once, on drop, via moveMeasures(). */
import { moveMeasures } from './measure-actions.js';
import { renderAllMeasures } from './notegrid.js';
import { Bus, BUS_EVENT } from './bus.js';

const EDGE = 56; // autoscroll zone (px from the scroller's top/bottom)
const SLIDE_MS = 200;

let drag = null;

export function isMeasureDragging() {
  return drag !== null;
}

function scrollParentOf(el) {
  for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return n;
  }
  return document.scrollingElement || document.documentElement;
}

function viewBox(scrollEl) {
  if (scrollEl === document.scrollingElement || scrollEl === document.documentElement) {
    return { top: 0, bottom: window.innerHeight };
  }
  return scrollEl.getBoundingClientRect();
}

function rowsOf(scroller) {
  return Array.from(scroller.querySelectorAll(':scope > .measure-row'));
}

// Layout rects in scroll-content coordinates, measured without transforms
function measure(rows, scrollEl) {
  rows.forEach(r => { r.style.transition = 'none'; r.style.translate = ''; });
  const st = scrollEl.scrollTop;
  const rects = new Map();
  rows.forEach(r => {
    const b = r.getBoundingClientRect();
    rects.set(r, { left: b.left, right: b.right, top: b.top + st, bottom: b.bottom + st, width: b.width, height: b.height });
  });
  return rects;
}

const REACH = 0.4; // a card swaps once the dragged card covers ~10% of it
const JITTER = 6; // px of movement toward a card before it can swap

function center(b) {
  return { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 };
}

function slotRect() {
  const rs = drag.dragged.map(r => drag.rects.get(r));
  return {
    left: Math.min(...rs.map(b => b.left)), right: Math.max(...rs.map(b => b.right)),
    top: Math.min(...rs.map(b => b.top)), bottom: Math.max(...rs.map(b => b.bottom)),
  };
}

// Card under the dragged card's centre takes the slot's place. Each card's
// rect is stretched toward the slot so the swap comes early, and only when
// moving toward that card, so it can't flip straight back.
function targetIndex(gx, gy) {
  const { others, rects } = drag;
  const slot = slotRect();
  const sc = center(slot);
  const mx = gx - drag.lastX;
  const my = gy - drag.lastY;
  if (Math.hypot(mx, my) < JITTER) return drag.index;

  for (let k = 0; k < others.length; k++) {
    const b = rects.get(others[k]);
    const sameLine = b.top < slot.bottom - 1 && slot.top < b.bottom - 1;
    const r = { ...b };
    if (sameLine) {
      const reach = (b.right - b.left) * REACH;
      if (b.left > sc.x) r.left -= reach; else r.right += reach;
    } else {
      const reach = (b.bottom - b.top) * REACH;
      if (b.top > sc.y) r.top -= reach; else r.bottom += reach;
    }
    if (gx < r.left || gx > r.right || gy < r.top || gy > r.bottom) continue;
    const c = center(b);
    if (mx * (c.x - sc.x) + my * (c.y - sc.y) <= 0) continue; // moving away from it
    return k < drag.index ? k : k + 1;
  }
  return drag.index;
}

function applyOrder(index) {
  const { scroller, others, dragged, scrollEl } = drag;
  const all = rowsOf(scroller);
  const first = new Map(all.map(r => [r, r.getBoundingClientRect()]));

  const before = others[index] || null;
  dragged.forEach(r => scroller.insertBefore(r, before));

  drag.rects = measure(all, scrollEl);
  const st = scrollEl.scrollTop;
  all.forEach(r => {
    const a = first.get(r);
    const b = drag.rects.get(r);
    const dx = a.left - b.left;
    const dy = a.top - (b.top - st);
    if (!dx && !dy) { r.style.transition = ''; return; }
    r.style.translate = `${dx}px ${dy}px`;
  });
  scroller.getBoundingClientRect(); // flush before animating back to 0
  all.forEach(r => {
    r.style.transition = '';
    r.style.translate = '';
  });
  drag.index = index;
}

function placeGhost() {
  const { ghost, px, py, offX, offY } = drag;
  ghost.style.translate = `${px - offX}px ${py - offY}px`;
}

function update() {
  if (!drag) return;
  // Dragged card's centre, in scroll-content coordinates
  const gx = drag.px - drag.offX + drag.ghostW / 2;
  const gy = drag.py - drag.offY + drag.ghostH / 2 + drag.scrollEl.scrollTop;
  const next = targetIndex(gx, gy);
  if (next !== drag.index) {
    applyOrder(next);
    drag.lastX = gx;
    drag.lastY = gy;
  }
}

function autoscrollLoop() {
  if (!drag) return;
  const box = viewBox(drag.scrollEl);
  let dy = 0;
  if (drag.py < box.top + EDGE) dy = -Math.ceil((box.top + EDGE - drag.py) / 4);
  else if (drag.py > box.bottom - EDGE) dy = Math.ceil((drag.py - (box.bottom - EDGE)) / 4);
  if (dy) {
    const beforeTop = drag.scrollEl.scrollTop;
    drag.scrollEl.scrollTop += dy;
    if (drag.scrollEl.scrollTop !== beforeTop) update();
  }
  drag.raf = requestAnimationFrame(autoscrollLoop);
}

function onMove(ev) {
  if (!drag || ev.pointerId !== drag.pointerId) return;
  ev.preventDefault();
  drag.px = ev.clientX;
  drag.py = ev.clientY;
  placeGhost();
  update();
}

function onUp(ev) {
  if (!drag || ev.pointerId !== drag.pointerId) return;
  finish(true);
}

function onCancel(ev) {
  if (!drag || (ev.pointerId !== undefined && ev.pointerId !== drag.pointerId)) return;
  finish(false);
}

function onKey(ev) {
  if (ev.key === 'Escape' && drag) {
    ev.stopPropagation();
    finish(false);
  }
}

function blockTouchScroll(ev) {
  if (drag) ev.preventDefault();
}

function teardown() {
  const { ghost, container, dragged, raf } = drag;
  cancelAnimationFrame(raf);
  ghost.remove();
  container.classList.remove('measures-reordering');
  dragged.forEach(r => r.classList.remove('measure-drag-slot'));
  window.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerup', onUp);
  window.removeEventListener('pointercancel', onCancel);
  window.removeEventListener('keydown', onKey, true);
  window.removeEventListener('touchmove', blockTouchScroll);
  drag = null;
}

function finish(commit) {
  const d = drag;
  if (!d || d.finishing) return;
  d.finishing = true;
  const moved = d.index !== d.from;

  // Ghost settles into the slot, then the grid re-renders in its new order
  const slot = d.dragged[0].getBoundingClientRect();
  d.ghost.classList.add('settling');
  d.ghost.style.translate = `${slot.left}px ${slot.top}px`;

  setTimeout(() => {
    teardown();
    if (commit && moved) moveMeasures(d.from, d.dragged.length, d.index, d.ctx);
    else if (moved) renderAllMeasures(d.ctx);
  }, SLIDE_MS);
}

/* Starts a drag of measures [from, from+count) from a pointer event.
   The caller has already decided this is a drag (moved past threshold). */
export function startMeasureDrag(ctx, from, count, ev) {
  if (drag) return;
  const container = ctx.container;
  const scroller = container?.querySelector('.measures-scroller');
  if (!scroller) return;
  const rows = rowsOf(scroller);
  const dragged = rows.slice(from, from + count);
  if (!dragged.length) return;

  const grabbed = ev.target.closest?.('.measure-row') || dragged[0];
  const gb = grabbed.getBoundingClientRect();
  const ghost = grabbed.cloneNode(true);
  ghost.classList.add('measure-drag-ghost');
  ghost.classList.remove('measure-selected', 'measure-armed');
  ghost.style.width = `${gb.width}px`;
  ghost.style.flexBasis = '';
  if (count > 1) {
    const badge = document.createElement('span');
    badge.className = 'measure-drag-count';
    badge.textContent = `×${count}`;
    ghost.appendChild(badge);
  }
  document.body.appendChild(ghost);

  // Offset keeps the grab point under the pointer; for a block, the ghost is the grabbed card
  drag = {
    ctx, container, scroller, dragged, ghost,
    scrollEl: scrollParentOf(scroller),
    others: rows.filter(r => !dragged.includes(r)),
    from, index: from,
    pointerId: ev.pointerId,
    px: ev.clientX, py: ev.clientY,
    offX: ev.clientX - gb.left, offY: ev.clientY - gb.top,
    ghostW: gb.width, ghostH: gb.height, lastX: 0, lastY: 0,
    rects: null, raf: 0, finishing: false,
  };
  drag.rects = measure(rows, drag.scrollEl);
  rows.forEach(r => { r.style.transition = ''; });
  drag.lastX = gb.left + gb.width / 2;
  drag.lastY = gb.top + gb.height / 2 + drag.scrollEl.scrollTop;

  container.classList.add('measures-reordering');
  dragged.forEach(r => r.classList.add('measure-drag-slot'));
  placeGhost();
  navigator.vibrate?.(10);

  window.addEventListener('pointermove', onMove, { passive: false });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('touchmove', blockTouchScroll, { passive: false });
  drag.raf = requestAnimationFrame(autoscrollLoop);
}

// A re-render mid-drag replaces the rows; drop the drag rather than act on stale nodes
Bus.on(BUS_EVENT.GRID_RENDERED, () => {
  if (drag && !drag.finishing) {
    teardown();
  }
});
