// Chord listen: editing the t-grid (Transcribe's result). Select cells, then
// move, copy, cut, paste or delete their notes.
//   tap / click: one cell (again: none) · hold, or ⌘/Ctrl-click: add or remove one
//   drag from an unselected cell, or Shift-click: a range · drag a selection: move it
// A mouse drag on an unselected note moves just that note.
import { canUndoEdit, beatLength, editNotes, stepTime, stopPlayback, tgridResult, tgridTake, undoEdit } from './listen-transcribe.js';
import { els, reply } from './listen-view.js';

const DRAG_START_PX = 6; // a tap that wobbles isn't a drag
const HOLD_MS = 450;

const sel = new Set(); // selected steps
let anchor = null; // where a Shift-click range starts
let adding = false; // after a hold, taps add and remove cells
let selKey = ''; // the take and grid the selection belongs to
let clip = null; // copied notes: [{ label, beats }] from the first copied step
let press = null; // the pointer held down on the t-grid

const stepLabels = s => (Array.isArray(s) ? s : s ? [s] : []);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const resultKey = r => `${tgridTake()}:${r.subdivision}`;
const stepOf = el => Number(el.dataset.step);
const cellAt = step => els.txPhrase.querySelector(`.cl-tx-cell[data-step="${step}"]`);
const range = (a, b) => Array.from({ length: Math.abs(b - a) + 1 }, (_, i) => Math.min(a, b) + i);
const onListen = () => document.body.classList.contains('route-listen');

function cellUnder(x, y) {
  const el = document.elementFromPoint(x, y)?.closest('.cl-tx-cell');
  return el && els.txPhrase.contains(el) ? el : null;
}

// --- The selection ---

function select(steps, base = []) {
  sel.clear();
  [...base, ...steps].forEach(s => sel.add(s));
  if (!sel.size) adding = false;
  render();
}

function toggle(step) {
  if (sel.has(step)) sel.delete(step);
  else sel.add(step);
  if (!sel.size) adding = false;
  render();
}

function clearSelection() {
  sel.clear();
  adding = false;
  anchor = null;
  render();
}

// The notes (indices) on the selected steps
const selectedNotes = r => r.noteSteps.flatMap((s, i) => (s != null && sel.has(s) ? [i] : []));

// After an edit: the selection is where these notes landed
function selectNotes(indices) {
  const r = tgridResult();
  sel.clear();
  if (r) {
    indices.forEach((i) => { if (r.noteSteps[i] != null) sel.add(r.noteSteps[i]); });
    selKey = resultKey(r);
  }
  render();
}

// --- Edits ---

function moveSelection(delta) {
  const r = tgridResult();
  if (!r || !delta) return;
  const moved = selectedNotes(r);
  if (!moved.length || Math.min(...moved.map(i => r.noteSteps[i])) + delta < 0) return;
  const times = new Map(moved.map(i => [i, stepTime(r.noteSteps[i] + delta)]));
  editNotes(notes => notes.map((n, i) => (times.has(i) ? { ...n, at: times.get(i) } : n)));
  selectNotes(moved);
}

function deleteSelection() {
  const r = tgridResult();
  const gone = new Set(r ? selectedNotes(r) : []);
  if (!gone.size) return 0;
  editNotes(notes => notes.filter((_, i) => !gone.has(i)));
  clearSelection();
  return gone.size;
}

// Kept from the first selected cell, so leading rests paste too
function copySelection() {
  const r = tgridResult();
  if (!r || !sel.size) return 0;
  const first = Math.min(...sel);
  clip = [...sel].flatMap(s => stepLabels(r.steps[s]).map(label => ({ label, beats: (s - first) / r.subdivision })));
  render();
  return clip.length;
}

// At the first selected cell; notes already there stay (they play together)
function paste() {
  if (!clip?.length || !sel.size || !tgridResult()) return 0;
  const base = stepTime(Math.min(...sel));
  let from = 0;
  editNotes((notes) => {
    from = notes.length;
    return notes.concat(clip.map(c => ({ label: c.label, at: base + c.beats * beatLength() })));
  });
  selectNotes(range(from, from + clip.length - 1));
  return clip.length;
}

function runAction(name) {
  if (name === 'copy') {
    const n = copySelection();
    if (n) reply(`Copied ${plural(n, 'note')}. Select where it goes, then Paste.`);
  } else if (name === 'cut') {
    const n = copySelection();
    if (n) { deleteSelection(); reply(`Cut ${plural(n, 'note')}. Select where it goes, then Paste.`); }
  } else if (name === 'paste') {
    const n = paste();
    if (n) reply(`Pasted ${plural(n, 'note')}.`);
  } else if (name === 'delete') {
    const n = deleteSelection();
    if (n) reply(`Deleted ${plural(n, 'note')}.`);
  } else if (name === 'undo') {
    undoEdit();
    clearSelection();
  } else if (name === 'clear') {
    clearSelection();
  }
}

// --- Pointer: tap, hold, drag ---

function onDown(e) {
  const cell = e.target.closest('.cl-tx-cell');
  if (!cell || e.button > 0 || !tgridResult()) return;
  press = {
    cell, step: stepOf(cell), x: e.clientX, y: e.clientY, touch: e.pointerType !== 'mouse',
    mod: e.metaKey || e.ctrlKey, shift: e.shiftKey, mode: null, held: false, base: [], ghost: null, delta: null, drops: [],
  };
  cell.setPointerCapture(e.pointerId);
  if (press.touch) press.timer = setTimeout(onHold, HOLD_MS);
}

function onHold() {
  if (!press || press.mode) return;
  press.held = true;
  adding = true;
  toggle(press.step);
  anchor = press.step;
  navigator.vibrate?.(10);
}

function onMove(e) {
  if (!press) return;
  if (!press.mode) {
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < DRAG_START_PX) return;
    clearTimeout(press.timer);
    const filled = press.cell.classList.contains('has-note');
    if (filled && (sel.has(press.step) || (!press.touch && !press.mod && !press.shift))) {
      if (!sel.has(press.step)) select([press.step]);
      startMove();
    } else {
      press.mode = 'range';
      press.base = press.mod || adding ? [...sel] : [];
      anchor = press.step;
    }
  }
  const over = cellUnder(e.clientX, e.clientY);
  if (press.mode === 'range') {
    if (over) select(range(anchor, stepOf(over)), press.base);
  } else {
    showMove(e, over);
  }
}

function startMove() {
  press.mode = 'move';
  stopPlayback();
  const ghost = press.cell.cloneNode(true);
  ghost.classList.remove('selected');
  ghost.classList.add('cl-tx-ghost');
  ghost.style.setProperty('--size', `${press.cell.offsetWidth}px`);
  if (sel.size > 1) ghost.dataset.count = String(sel.size);
  document.body.appendChild(ghost);
  press.ghost = ghost;
  sel.forEach(s => cellAt(s)?.classList.add('dragging'));
}

// The cells the selection would land on are ringed
function showMove(e, over) {
  press.ghost.style.setProperty('--x', `${e.clientX}px`);
  press.ghost.style.setProperty('--y', `${e.clientY}px`);
  const delta = over ? stepOf(over) - press.step : null;
  if (delta === press.delta) return;
  press.delta = delta;
  press.drops.forEach(c => c.classList.remove('drop'));
  press.drops = delta == null ? [] : [...sel].map(s => cellAt(s + delta)).filter(Boolean);
  press.drops.forEach(c => c.classList.add('drop'));
}

function onUp(e) {
  if (!press) return;
  const p = press;
  press = null;
  clearTimeout(p.timer);
  p.ghost?.remove();
  p.drops.forEach(c => c.classList.remove('drop'));
  els.txPhrase.querySelectorAll('.dragging').forEach(c => c.classList.remove('dragging'));
  if (e.type === 'pointercancel' || p.held || p.mode === 'range') return;
  if (p.mode === 'move') {
    if (p.delta) moveSelection(p.delta);
    return;
  }
  // A tap or click
  if (p.shift && anchor != null) {
    select(range(anchor, p.step));
    return;
  }
  if (p.mod || adding) toggle(p.step);
  else if (sel.size === 1 && sel.has(p.step)) clearSelection();
  else select([p.step]);
  anchor = p.step;
}

// --- Keyboard (desktop) ---

function onKey(e) {
  const r = tgridResult();
  if (!r || !onListen() || e.target.closest?.('input, select, textarea, [contenteditable]')) return;
  const mod = e.metaKey || e.ctrlKey;
  const key = e.key.toLowerCase();
  let handled = true;
  if (mod && key === 'z' && !e.shiftKey && canUndoEdit()) runAction('undo');
  else if (mod && key === 'a') select(range(0, r.steps.length - 1));
  else if (mod && key === 'v' && clip && sel.size) runAction('paste');
  else if (!sel.size) handled = false;
  else if (key === 'delete' || key === 'backspace') runAction('delete');
  else if (mod && key === 'c') runAction('copy');
  else if (mod && key === 'x') runAction('cut');
  else if (key === 'escape') runAction('clear');
  else if (!mod && (key === 'arrowleft' || key === 'arrowright')) moveSelection(key === 'arrowleft' ? -1 : 1);
  else handled = false;
  if (handled) e.preventDefault();
}

// --- Plugged into the core ---

function render() {
  const r = tgridResult();
  if (!r) return;
  const key = resultKey(r);
  if (key !== selKey) { // a new take or grid: steps mean something else now
    sel.clear();
    adding = false;
    anchor = null;
    selKey = key;
  }
  els.txPhrase.querySelectorAll('.cl-tx-cell').forEach(c => c.classList.toggle('selected', sel.has(stepOf(c))));
  const notes = [...sel].reduce((n, s) => n + stepLabels(r.steps[s]).length, 0);
  els.txSel.textContent = sel.size
    ? `${plural(sel.size, 'cell')} · ${plural(notes, 'note')}`
    : 'Tap a note to select it';
  const disabled = {
    copy: !notes, cut: !notes, delete: !notes, paste: !clip?.length || !sel.size, undo: !canUndoEdit(), clear: !sel.size,
  };
  els.txEdit.querySelectorAll('[data-ed]').forEach((b) => { b.disabled = disabled[b.dataset.ed]; });
}

export function wireTgrid() {
  els.txPhrase.addEventListener('pointerdown', onDown);
  els.txPhrase.addEventListener('pointermove', onMove);
  els.txPhrase.addEventListener('pointerup', onUp);
  els.txPhrase.addEventListener('pointercancel', onUp);
  els.txPhrase.addEventListener('contextmenu', e => e.preventDefault()); // a hold selects, no menu
  els.txEdit.addEventListener('click', (e) => {
    const name = e.target.closest('[data-ed]')?.dataset.ed;
    if (name) runAction(name);
  });
  document.addEventListener('keydown', onKey);
}

export const tgridFeature = { render };
