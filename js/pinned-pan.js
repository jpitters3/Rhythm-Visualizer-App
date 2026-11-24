// Borrowing the real handpan for a full-screen mode (Pan Hero, Play Along),
// and locating its tonefields on a canvas drawn over it.

import {
  HANDPAN_MAP, getDisplayPosition, isPerimeterNote, setHandpanSide, getHandpanSide,
} from './handpanmap.js';

// Moves #handpanWrap into `host` on the perimeter face (so Tak/Slap rim pucks
// show). Returns release(), which puts the pan and the user's face back.
export function borrowPan(host, pinClass) {
  const prevSide = localStorage.getItem('gp_handpanSide');
  setHandpanSide('perimeter');

  const wrap = document.getElementById('handpanWrap');
  const parent = wrap?.parentElement;
  const next = wrap?.nextSibling;
  const inline = wrap
    ? { maxWidth: wrap.style.maxWidth, width: wrap.style.width, margin: wrap.style.margin }
    : null;
  if (wrap) {
    wrap.style.maxWidth = wrap.style.width = wrap.style.margin = '';
    wrap.classList.add(pinClass);
    host.appendChild(wrap);
  }

  return function release() {
    if (wrap && parent) {
      wrap.classList.remove(pinClass);
      Object.assign(wrap.style, inline);
      parent.insertBefore(wrap, next);
    }
    // setHandpanSide overwrites gp_handpanSide, so write the saved value back.
    setHandpanSide(prevSide || 'top');
    if (prevSide != null) localStorage.setItem('gp_handpanSide', prevSide);
    else localStorage.removeItem('gp_handpanSide');
  };
}

// No scale-change event to hook, so modes call this every few frames.
export function keepPerimeterFace() {
  if (getHandpanSide() !== 'perimeter') setHandpanSide('perimeter');
}

export function measurePanBoxes(canvas) {
  const overlay = document.getElementById('handpanOverlay');
  const wrap = document.getElementById('handpanWrap');
  return {
    overlay: overlay ? overlay.getBoundingClientRect() : null,
    wrap: wrap ? wrap.getBoundingClientRect() : null,
    canvas: canvas.getBoundingClientRect(),
  };
}

// A tonefield's centre and radius in the canvas's CSS pixels. Rim pucks are
// 0-100 of #handpanWrap (padding included); the rest of #handpanOverlay.
export function tonefieldScreenPos(key, boxes) {
  const p = getDisplayPosition(key);
  if (!p) return null;
  const box = isPerimeterNote(key) ? boxes.wrap : boxes.overlay;
  if (!box || box.width === 0) return null;
  const r = HANDPAN_MAP[key]?.r || 8;
  return {
    x: (box.left - boxes.canvas.left) + (p.x / 100) * box.width,
    y: (box.top - boxes.canvas.top) + (p.y / 100) * box.height,
    rpx: (r / 100) * box.width,
  };
}
