/* Measure cards: select (click / ctrl / shift, or long-press on touch),
   colour + name them as song sections, and hand drags to measure-reorder. */
import { gridA, gridB } from './grid-context.js';
import { setActiveGrid } from './state.js';
import { isReviewing } from './coaching-mode.js';
import { Bus, BUS_EVENT } from './bus.js';
import { SECTION_COLORS, setMeasureSections } from './measure-actions.js';
import { startMeasureDrag, isMeasureDragging } from './measure-reorder.js';
import { show, hide, isHidden } from './dom.js';

const LONG_PRESS_MS = 450;
const DRAG_PX = 6;
// Inside a card, these keep their own behaviour (cells, legend buttons…)
const NOT_CHROME = '.cell, .grid, button, input, a, .notation-legend';

const sel = { ctx: null, set: new Set(), anchor: null, touch: false };
let press = null;
let pop = null;

function isTouch(ev) {
  return ev.pointerType === 'touch' || ev.pointerType === 'pen';
}

function canEdit() {
  return !document.body.classList.contains('present') && !(isReviewing && isReviewing());
}

function rowAt(target, ctx) {
  const row = target.closest?.('.measure-row');
  return row && ctx.container?.contains(row) ? row : null;
}

function rowIndex(row) {
  return Number(row.dataset.measure);
}

// ── Selection ──
function paintSelection() {
  [gridA, gridB].forEach(ctx => {
    ctx.container?.querySelectorAll('.measure-row').forEach(row => {
      row.classList.toggle('measure-selected', sel.ctx === ctx && sel.set.has(rowIndex(row)));
    });
  });
}

function selectOnly(ctx, m) {
  sel.ctx = ctx;
  sel.set = new Set([m]);
  sel.anchor = m;
}

function selectRange(ctx, m) {
  if (sel.ctx !== ctx || sel.anchor === null) return selectOnly(ctx, m);
  const [a, b] = [Math.min(sel.anchor, m), Math.max(sel.anchor, m)];
  sel.set = new Set();
  for (let i = a; i <= b; i++) sel.set.add(i);
}

function toggleOne(ctx, m) {
  if (sel.ctx !== ctx) return selectOnly(ctx, m);
  if (sel.set.has(m)) sel.set.delete(m);
  else sel.set.add(m);
  sel.anchor = m;
}

function clearMeasureSelection() {
  if (pop && !isHidden(pop)) commitName(); // a typed name survives clicking away
  sel.ctx = null;
  sel.set = new Set();
  sel.anchor = null;
  sel.touch = false;
  paintSelection();
  hide(pop);
}

// Contiguous selection containing m drags as a block; otherwise just m
function dragBlock(ctx, m) {
  if (sel.ctx !== ctx || !sel.set.has(m)) return { from: m, count: 1 };
  const list = [...sel.set].sort((a, b) => a - b);
  const contiguous = list.every((v, i) => i === 0 || v === list[i - 1] + 1);
  return contiguous ? { from: list[0], count: list.length } : { from: m, count: 1 };
}

// ── Popover ──
function buildPopover() {
  pop = document.createElement('div');
  pop.className = 'measure-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Measure section');
  pop.hidden = true;

  const head = document.createElement('div');
  head.className = 'measure-pop-head';
  const title = document.createElement('span');
  title.className = 'measure-pop-title';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'measure-pop-close';
  close.setAttribute('aria-label', 'Close');
  close.textContent = '✕';
  close.addEventListener('click', clearMeasureSelection);
  head.append(title, close);

  const swatches = document.createElement('div');
  swatches.className = 'measure-pop-swatches';
  [null, ...SECTION_COLORS].forEach(color => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'measure-swatch';
    b.dataset.color = color || 'none';
    b.setAttribute('aria-label', color ? `${color} section` : 'No colour');
    b.addEventListener('click', () => applyToSelection({ color }));
    swatches.appendChild(b);
  });

  const name = document.createElement('input');
  name.type = 'text';
  name.className = 'measure-pop-name';
  name.maxLength = 24;
  name.placeholder = 'Section name (e.g. Chorus)';
  name.setAttribute('aria-label', 'Section name');
  name.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); clearMeasureSelection(); }
    if (e.key === 'Escape') { e.preventDefault(); clearMeasureSelection(); }
  });
  name.addEventListener('change', commitName);

  const hint = document.createElement('p');
  hint.className = 'measure-pop-hint';

  pop.append(head, swatches, name, hint);
  document.body.appendChild(pop);
}

function commitName() {
  if (!sel.ctx || !sel.set.size) return;
  const label = pop.querySelector('.measure-pop-name').value;
  const current = currentSections();
  if (current.every(s => (s?.label || '') === label.trim())) return;
  applyToSelection({ label });
}

function currentSections() {
  const list = sel.ctx?.measureSections || [];
  return [...sel.set].map(m => list[m] || null);
}

function applyToSelection(patch) {
  if (!sel.ctx || !sel.set.size) return;
  setMeasureSections([...sel.set], patch, sel.ctx);
}

function refreshPopover() {
  if (!pop) buildPopover();
  const list = [...sel.set].sort((a, b) => a - b);
  const sections = currentSections();
  const colors = new Set(sections.map(s => s?.color || null));
  const labels = new Set(sections.map(s => s?.label || ''));

  pop.querySelector('.measure-pop-title').textContent = list.length === 1
    ? `Measure ${list[0] + 1}`
    : `${list.length} measures`;
  pop.querySelectorAll('.measure-swatch').forEach(b => {
    const c = b.dataset.color === 'none' ? null : b.dataset.color;
    b.setAttribute('aria-pressed', String(colors.size === 1 && colors.has(c)));
  });
  const name = pop.querySelector('.measure-pop-name');
  if (document.activeElement !== name) name.value = labels.size === 1 ? [...labels][0] : '';
  pop.querySelector('.measure-pop-hint').textContent = sel.touch
    ? 'Tap another measure to select up to it'
    : 'Shift-click for a range, Ctrl/⌘-click to add';
  show(pop);
  positionPopover();
  // Ready to type a name; not on touch, where focus would pop the keyboard up
  if (!sel.touch) {
    name.focus({ preventScroll: true });
    name.select();
  }
}

function positionPopover() {
  if (!pop || isHidden(pop) || !sel.ctx) return;
  // Touch: docked at the bottom so the cards stay free to tap
  pop.classList.toggle('docked', sel.touch);
  if (sel.touch) {
    pop.style.translate = '';
    return;
  }
  const row = sel.ctx.container?.querySelector(`.measure-row[data-measure="${sel.anchor}"]`)
    || sel.ctx.container?.querySelector('.measure-row.measure-selected');
  if (!row) return clearMeasureSelection();
  const r = row.getBoundingClientRect();
  const header = row.querySelector('.measure-header')?.getBoundingClientRect();
  const w = pop.offsetWidth;
  const h = pop.offsetHeight;
  const gap = 6;
  let top = (header ? header.bottom : r.top) + gap;
  if (top + h > window.innerHeight - 8) top = r.top - h - gap;
  top = Math.min(Math.max(8, top), window.innerHeight - h - 8);
  const left = Math.min(Math.max(8, r.left + 8), window.innerWidth - w - 8);
  pop.style.translate = `${Math.round(left)}px ${Math.round(top)}px`;
}

function openFor(ctx) {
  setActiveGrid(ctx);
  paintSelection();
  if (sel.set.size) refreshPopover();
  else clearMeasureSelection();
}

// ── Gestures ──
function onPointerDown(ev, ctx) {
  if (!canEdit() || isMeasureDragging()) return;
  if (ev.button !== undefined && ev.button !== 0) return;
  const row = rowAt(ev.target, ctx);
  if (!row) return;
  const m = rowIndex(row);
  const touch = isTouch(ev);

  // Touch select mode: tapping anywhere on another card (cells too) extends the range
  if (touch && sel.touch && sel.ctx === ctx) {
    ev.stopPropagation();
    press = { ctx, row, m, x: ev.clientX, y: ev.clientY, id: ev.pointerId, touch, armed: false, extend: true };
    press.timer = setTimeout(arm, LONG_PRESS_MS);
    return;
  }
  // Desktop: ctrl/shift-click on cells adds measures while the popover is open
  const modifier = ev.shiftKey || ev.ctrlKey || ev.metaKey;
  if (ev.target.closest(NOT_CHROME) && !(modifier && !touch && sel.ctx === ctx && !isHidden(pop))) return;
  if (modifier && ev.target.closest('.cell')) ev.stopPropagation();

  press = { ctx, row, m, x: ev.clientX, y: ev.clientY, id: ev.pointerId, touch, armed: !touch };
  if (touch) press.timer = setTimeout(arm, LONG_PRESS_MS);
}

function arm() {
  if (!press) return;
  press.armed = true;
  press.row.classList.add('measure-armed');
  navigator.vibrate?.(8);
}

function endPress() {
  if (!press) return;
  clearTimeout(press.timer);
  press.row.classList.remove('measure-armed');
  press = null;
}

function onPointerMove(ev) {
  if (!press || ev.pointerId !== press.id) return;
  const moved = Math.hypot(ev.clientX - press.x, ev.clientY - press.y) > DRAG_PX;
  if (!moved) return;
  if (!press.armed) return endPress(); // touch: a scroll, not a hold
  const { ctx, m } = press;
  const { from, count } = dragBlock(ctx, m);
  endPress();
  clearMeasureSelection();
  setActiveGrid(ctx);
  startMeasureDrag(ctx, from, count, ev);
}

function onPointerUp(ev) {
  if (!press || ev.pointerId !== press.id) return;
  const { ctx, m, touch, armed, extend } = press;
  endPress();
  if (isMeasureDragging()) return;

  if (touch) {
    if (extend) {
      if (sel.set.has(m) && sel.set.size > 1) toggleOne(ctx, m);
      else selectRange(ctx, m);
    } else if (armed) {
      selectOnly(ctx, m);
      sel.touch = true;
    } else {
      return;
    }
  } else if (ev.shiftKey) selectRange(ctx, m);
  else if (ev.ctrlKey || ev.metaKey) toggleOne(ctx, m);
  else if (sel.ctx === ctx && sel.set.size === 1 && sel.set.has(m) && !isHidden(pop)) {
    return clearMeasureSelection(); // second click on the same card closes
  } else selectOnly(ctx, m);

  suppressClickUntil = performance.now() + 400;
  openFor(ctx);
}

// The click that follows a handled press must not reach the cell or the
// outside-click handlers. Time-boxed: after a long-press there may be no click.
let suppressClickUntil = 0;
function onClickCapture(ev) {
  if (performance.now() > suppressClickUntil) return;
  suppressClickUntil = 0;
  ev.stopPropagation();
  ev.preventDefault();
}

function onDocPointerDown(ev) {
  if (!pop || isHidden(pop)) return;
  if (pop.contains(ev.target)) return;
  if (sel.ctx && rowAt(ev.target, sel.ctx)) return; // handled by the grid listener
  clearMeasureSelection();
}

function bind(ctx) {
  const el = ctx.container;
  if (!el || el.dataset.measureSelectBound) return;
  el.dataset.measureSelectBound = '1';
  el.addEventListener('pointerdown', ev => onPointerDown(ev, ctx), true);
  el.addEventListener('click', onClickCapture, true);
  // Long-press on card chrome shouldn't open the OS menu / text selection
  el.addEventListener('contextmenu', (ev) => {
    if (rowAt(ev.target, ctx) && !ev.target.closest(NOT_CHROME)) ev.preventDefault();
  });
  // Once a hold has armed, the finger moves the card, not the page
  el.addEventListener('touchmove', (ev) => {
    if (press?.armed) ev.preventDefault();
  }, { passive: false });
  el.addEventListener('scroll', positionPopover, { passive: true });
}

export function initMeasureSelect() {
  [gridA, gridB].forEach(bind);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', endPress);
  document.addEventListener('pointerdown', onDocPointerDown, true);
  window.addEventListener('resize', positionPopover);
  window.addEventListener('scroll', positionPopover, { passive: true, capture: true });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pop && !isHidden(pop)) clearMeasureSelection();
  });

  Bus.on(BUS_EVENT.GRID_RENDERED, () => {
    if (!sel.ctx) return;
    const count = sel.ctx.measures;
    sel.set = new Set([...sel.set].filter(m => m < count));
    if (!sel.set.size) return clearMeasureSelection();
    if (sel.anchor >= count) sel.anchor = Math.max(...sel.set);
    paintSelection();
    if (pop && !isHidden(pop)) refreshPopover();
  });
  Bus.on(BUS_EVENT.CELL_CLICKED, () => {
    if (pop && !isHidden(pop) && !sel.touch) clearMeasureSelection();
  });
}
