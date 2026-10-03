// Chord Wheel — Harmony domain game. Spin a wheel for 4 chords, reorder, send to Studio.
import { ChordAnalyzer, NOTE_MAP } from './chord-analyzer.js';
import { annotatePlayability } from './chord-playability.js';
import { getAllCurrentNotes, highlightChordNotes, playChordNotes } from './chord-playback.js';
import { getPitchPositionMap } from './handpanmap.js';
import { assignChordToSelectedCell, applySelection, renderAllMeasures } from './notegrid.js';
import { measureRange } from './measure-actions.js';
import { activeGrid, currentUser, getSelectedScaleName } from './state.js';
import { makeSortable } from './sortable.js';
import { navigate } from './router.js';
import { Bus, BUS_EVENT } from './bus.js';
import { guardBeforeReplacingGrid } from './lesson-settings.js';
import { HistoryManager } from './history.js';
import { updateCurrentPhraseName } from './controls.js';

const ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const QUALITIES = ['Major', 'Minor'];
const INVERSION_LABEL = ['', 'I', 'II'];
const PLAY_SPACING_MS = 750;
const SPIN_MS = 3200;
const WHEEL_COLORS = ['#f6c84c', '#5fb4e8', '#f08aa0', '#8fd19e', '#c89bf0', '#f0a35f', '#7fd4c8', '#e8838c'];

let slots = [null, null, null, null];
let mode = 'scale';
let includeUnplayable = false;
let wheelRotation = 0;
let wheelSpinning = false;
let activePool = [];
let disabledChords = new Set(); // signatures, e.g. "9-Minor" — off the wheel

let slotsEl, sendBtn, wheelSvgEl, wheelWrapEl, wheelHintEl, chordsPanelEl, mountedScaleSelectEl;
let handpanWrapOrigParent = null;
let handpanWrapOrigNextSibling = null;
let scaleSelectOrigParent = null;
let scaleSelectOrigNextSibling = null;

function getScalePool() {
  const notes = getAllCurrentNotes();
  if (!notes.length) return [];
  const chords = annotatePlayability(ChordAnalyzer.analyze(notes), getPitchPositionMap());
  return chords
    .filter(c => c.playable && c.quality !== 'Diminished')
    .map(c => ({ ...c, onThisPan: true }));
}

// "G Minor" -> "Gm", "F Major" -> "F"
function abbreviateChord(chord) {
  return chord.quality === 'Minor' ? `${chord.root}m` : chord.root;
}

function getAnyChordsPool() {
  const scalePool = getScalePool();
  const bySignature = new Map(scalePool.map(c => [`${NOTE_MAP[c.root.toUpperCase()]}-${c.quality}`, c]));

  const pool = [];
  for (const root of ROOTS) {
    for (const quality of QUALITIES) {
      const match = bySignature.get(`${NOTE_MAP[root]}-${quality}`);
      pool.push(match || { root, quality, name: `${root} ${quality}`, notes: null, onThisPan: false });
    }
  }
  return pool;
}

// Includes inversion — "Am" root position and "Am I" are toggled separately.
function chordSignature(c) {
  return `${NOTE_MAP[c.root.toUpperCase()]}-${c.quality}-${c.inversion || 0}`;
}

// Full vocabulary for the active mode, before the on/off toggle filter —
// what the "Chords" panel lists so a disabled chord can be re-enabled.
function getModeVocabulary() {
  if (mode === 'scale') return getScalePool();
  const pool = getAnyChordsPool();
  return includeUnplayable ? pool : pool.filter(c => c.onThisPan);
}

function getActivePool() {
  return getModeVocabulary().filter(c => !disabledChords.has(chordSignature(c)));
}

// getSelectedScaleName() isn't stable across a reload — it's "D Kurd" live
// in-session but restores as the slug "d_kurd" from its own saved prefs.
// Normalize so both forms land on the same key.
function normalizeScaleKey(name) {
  return (name || 'default').toLowerCase().replace(/\s+/g, '_');
}

function disabledChordsStorageKey() {
  const userId = currentUser?.id || 'guest';
  const scaleKey = normalizeScaleKey(getSelectedScaleName());
  return `cw_disabled_chords_${userId}_${scaleKey}`;
}

function loadDisabledChords() {
  try {
    const raw = localStorage.getItem(disabledChordsStorageKey());
    disabledChords = new Set(raw ? JSON.parse(raw) : []);
  } catch {
    disabledChords = new Set();
  }
}

function saveDisabledChords() {
  try {
    localStorage.setItem(disabledChordsStorageKey(), JSON.stringify([...disabledChords]));
  } catch {
    // ignore (private browsing, quota, etc.)
  }
}

// --- Handpan embed (same relocate/restore pattern as js/free-record.js) ---

function mountHandpan(slotEl) {
  const wrap = document.getElementById('handpanWrap');
  if (!wrap || !slotEl || slotEl.contains(wrap)) return;
  handpanWrapOrigParent = wrap.parentNode;
  handpanWrapOrigNextSibling = wrap.nextSibling;
  slotEl.appendChild(wrap);
  // js/panel-resize.js pins a mobile max-width inline on #handpanWrap for
  // Studio's own layout; clear it so this game's CSS sizes it instead.
  // Studio re-syncs it on its own next routeChanged, see panel-resize.js.
  wrap.style.maxWidth = '';
}

function unmountHandpan() {
  const wrap = document.getElementById('handpanWrap');
  if (wrap && handpanWrapOrigParent) {
    handpanWrapOrigParent.insertBefore(wrap, handpanWrapOrigNextSibling);
  }
  handpanWrapOrigParent = null;
  handpanWrapOrigNextSibling = null;
}

function mountScaleSelect(slotEl) {
  const select = document.getElementById('scaleSelect');
  if (!select || !slotEl || slotEl.contains(select)) return;
  scaleSelectOrigParent = select.parentNode;
  scaleSelectOrigNextSibling = select.nextSibling;
  slotEl.appendChild(select);
}

function unmountScaleSelect() {
  const select = document.getElementById('scaleSelect');
  if (select && scaleSelectOrigParent) {
    scaleSelectOrigParent.insertBefore(select, scaleSelectOrigNextSibling);
  }
  scaleSelectOrigParent = null;
  scaleSelectOrigNextSibling = null;
}

// Restores the handpan/scale-select to Studio and drops this instance's
// listeners — needed whenever the game view stops being the active one,
// however that happens. Safe to call more than once.
function teardownGame() {
  unmountHandpan();
  unmountScaleSelect();
  mountedScaleSelectEl?.removeEventListener('change', onScaleChanged);
  Bus.off(BUS_EVENT.AUTH_LOGIN, onAuthReady);
  window.removeEventListener('routeChanged', onRouteChanged);
}

// Catches every way of leaving besides the Back button (which stays on the
// #games route) — any other nav link, browser back/forward, etc. Same
// pattern as js/method.js's onLeave(), which has the identical handpan
// relocation problem.
function onRouteChanged({ detail }) {
  if (detail.route !== 'games') teardownGame();
}

// Mirrors js/chord-ui.js's own scale-change refresh: the 100ms delay lets
// js/handpanmap.js finish updating currentScale/getAllCurrentNotes() first.
// On a fresh page load, the game can mount before js/auth.js finishes its
// async getSession() restore — currentUser is still null at that instant, so
// the disabled-chords key would key off 'guest' and miss the real saved set.
// Re-load once the real user becomes known, if that happens after mount.
function onAuthReady() {
  loadDisabledChords();
  renderWheel();
  renderChordsPanel();
}

function onScaleChanged() {
  setTimeout(() => {
    slots = [null, null, null, null];
    wheelRotation = 0;
    loadDisabledChords(); // key includes the scale — a fresh set per scale
    renderWheel();
    renderSlots();
    renderChordsPanel();
  }, 100);
}

// --- Wheel ---

function buildWheelSVG(pool) {
  const n = pool.length;
  if (!n) return '<svg viewBox="0 0 300 300" class="cw-wheel-svg"></svg>';

  const cx = 150, cy = 150, r = 146;
  // Bigger text when there's room, shrinking as segments get narrower
  const fontSize = Math.max(9, Math.min(20, (2 * Math.PI * r * 0.78) / n / 2.6));
  let body = '';
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * 2 * Math.PI - Math.PI / 2;
    const a1 = ((i + 1) / n) * 2 * Math.PI - Math.PI / 2;
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    const largeArc = (a1 - a0) > Math.PI ? 1 : 0;
    const color = WHEEL_COLORS[i % WHEEL_COLORS.length];
    body += `<path d="M${cx},${cy} L${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${largeArc} 1 ${x1.toFixed(2)},${y1.toFixed(2)} Z" fill="${color}" stroke="#fff" stroke-width="2"/>`;

    const mid = (a0 + a1) / 2;
    const tx = cx + r * 0.78 * Math.cos(mid), ty = cy + r * 0.78 * Math.sin(mid);
    const rotDeg = (mid * 180 / Math.PI) + 90;
    const inv = pool[i].inversion;
    const invSpan = inv
      ? `<tspan x="${tx.toFixed(1)}" dy="${(fontSize * 1.05).toFixed(1)}" font-size="${(fontSize * 0.75).toFixed(1)}">${INVERSION_LABEL[inv]}</tspan>`
      : '';
    body += `<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" transform="rotate(${rotDeg.toFixed(1)} ${tx.toFixed(1)} ${ty.toFixed(1)})" class="cw-wheel-label" style="font-size:${fontSize.toFixed(1)}px">${abbreviateChord(pool[i])}${invSpan}</text>`;
  }
  return `<svg class="cw-wheel-svg" viewBox="0 0 300 300">${body}</svg>`;
}

function renderWheel() {
  activePool = getActivePool();
  wheelSvgEl.outerHTML = buildWheelSVG(activePool);
  wheelSvgEl = document.querySelector('.cw-wheel-svg');
  wheelSvgEl.style.transform = `rotate(${wheelRotation}deg)`;
}

function highlightTargetSlot(idx) {
  slotsEl?.querySelectorAll('.cw-slot').forEach((el) => {
    el.classList.toggle('cw-slot-target', el.dataset.id === `slot-${idx}`);
  });
}

function spinWheelTo(slotIndex) {
  if (wheelSpinning || !activePool.length) return Promise.resolve();
  wheelSpinning = true;
  highlightTargetSlot(slotIndex);

  const n = activePool.length;
  const targetIndex = Math.floor(Math.random() * n);
  const segment = 360 / n;
  const centerAngle = (targetIndex + 0.5) * segment;
  const jitter = (Math.random() - 0.5) * segment * 0.6;
  const extraSpins = 5 * 360;
  const normalizedTarget = ((360 - centerAngle - jitter) % 360 + 360) % 360;
  const currentMod = ((wheelRotation % 360) + 360) % 360;
  wheelRotation += extraSpins + ((normalizedTarget - currentMod + 360) % 360);

  wheelSvgEl.style.transition = `transform ${SPIN_MS}ms cubic-bezier(0.12, 0.67, 0.1, 1)`;
  wheelSvgEl.style.transform = `rotate(${wheelRotation}deg)`;

  return new Promise((resolve) => {
    const onEnd = () => {
      wheelSvgEl.removeEventListener('transitionend', onEnd);
      wheelSpinning = false;
      slots[slotIndex] = activePool[targetIndex];
      playChordAt(slots[slotIndex]);
      renderSlots();
      resolve();
    };
    wheelSvgEl.addEventListener('transitionend', onEnd);
  });
}

async function spinAll() {
  for (let i = 0; i < 4; i++) await spinWheelTo(i);
}

function nextEmptySlotIndex() {
  const idx = slots.findIndex(c => !c);
  return idx === -1 ? 0 : idx;
}

function handleReorder({ draggedId, beforeId }) {
  const fromIdx = parseInt(draggedId.split('-')[1], 10);
  const toIdx = beforeId ? parseInt(beforeId.split('-')[1], 10) : slots.length;
  const [moved] = slots.splice(fromIdx, 1);
  slots.splice(toIdx > fromIdx ? toIdx - 1 : toIdx, 0, moved);
  renderSlots();
}

function playChordAt(chord) {
  if (!chord?.notes) return;
  playChordNotes(chord.notes);
  highlightChordNotes(chord, true);
}

function playProgression() {
  slots.forEach((chord, i) => {
    if (!chord?.notes) return;
    setTimeout(() => playChordAt(chord), i * PLAY_SPACING_MS);
  });
  const lastPlayable = [...slots].reverse().find(c => c?.notes);
  if (lastPlayable) {
    setTimeout(() => highlightChordNotes(lastPlayable, false), slots.length * PLAY_SPACING_MS + 400);
  }
}

async function sendToStudio() {
  if (!await guardBeforeReplacingGrid('You have unsaved changes. Discard them and replace the grid with this progression?')) return;

  const ctx = activeGrid;
  HistoryManager?.pushState();
  ctx.setMeasures(slots.length); // one measure per chord, fully cleared
  ctx.step = 0;

  slots.forEach((chord, i) => {
    const { start } = measureRange(i, ctx);
    applySelection(start, ctx);
    const labels = playChordNotes(chord.notes);
    assignChordToSelectedCell(labels, ctx);
  });

  renderAllMeasures(ctx);
  // ex. "Chords Am Dm Dm II C" — abbreviated like the wheel, inversions spelled
  // out ("Dm II") since there's no second line to wrap them onto here.
  const chordLabels = slots.map((chord) => (
    chord.inversion ? `${abbreviateChord(chord)} ${INVERSION_LABEL[chord.inversion]}` : abbreviateChord(chord)
  ));
  updateCurrentPhraseName(`Chords ${chordLabels.join(' ')}`);
  teardownGame(); // restore the handpan/scale-select to Studio before leaving
  navigate('studio');
}

function renderSlots() {
  if (!slotsEl) return;

  slotsEl.innerHTML = slots.map((chord, i) => `
    <div class="cw-slot" draggable="true" data-id="slot-${i}">
      <div class="cw-slot-index">${i + 1}</div>
      <div class="cw-slot-body">
        ${chord
          ? `<div class="cw-chord-name">${chord.name}</div>${chord.inversion ? `<div class="cw-chord-inversion">${INVERSION_LABEL[chord.inversion]}</div>` : ''}${!chord.onThisPan ? '<div class="cw-chord-badge">Not on this scale</div>' : ''}`
          : '<div class="cw-chord-empty">—</div>'}
      </div>
      <button class="cw-spin-btn" type="button" data-slot="${i}" title="Spin">🎡</button>
    </div>
  `).join('');

  slotsEl.querySelectorAll('.cw-spin-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      spinWheelTo(parseInt(btn.dataset.slot, 10));
    });
  });

  slotsEl.querySelectorAll('.cw-slot').forEach((el, i) => {
    const chord = slots[i];
    if (!chord?.notes) return;
    el.addEventListener('click', () => playChordAt(chord));
  });

  const allFilled = slots.every(c => c?.notes);
  if (sendBtn) sendBtn.disabled = !allFilled;
  if (wheelHintEl) wheelHintEl.hidden = slots.some(c => c);
  highlightTargetSlot(nextEmptySlotIndex());
}

function renderModeRow(container) {
  container.querySelector('.cw-unplayable-toggle').hidden = mode !== 'any';
  container.querySelectorAll('.cw-mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
}

function chordToggleLabel(c) {
  return c.inversion ? `${c.name} (${INVERSION_LABEL[c.inversion]})` : c.name;
}

function renderChordsPanel() {
  if (!chordsPanelEl) return;

  const vocab = getModeVocabulary();
  const seen = new Set();
  const unique = vocab.filter((c) => {
    const sig = chordSignature(c);
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });

  chordsPanelEl.innerHTML = '';
  if (!unique.length) {
    chordsPanelEl.innerHTML = '<p class="cw-chords-empty">No chords available for this scale.</p>';
    return;
  }

  unique.forEach((c) => {
    const sig = chordSignature(c);
    const row = document.createElement('div');
    row.className = 'cw-chord-toggle-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = !disabledChords.has(sig);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) disabledChords.delete(sig);
      else disabledChords.add(sig);
      saveDisabledChords();
      renderWheel();
    });

    const previewBtn = document.createElement('button');
    previewBtn.type = 'button';
    previewBtn.className = 'cw-chord-preview-btn';
    previewBtn.textContent = chordToggleLabel(c);
    previewBtn.title = 'Play this chord';
    previewBtn.addEventListener('click', () => playChordAt(c));

    row.append(checkbox, previewBtn);
    chordsPanelEl.appendChild(row);
  });
}

export function renderChordWheelGame(view, { onBack } = {}) {
  view.innerHTML = `
    <div class="hg-container cw-container">
      <button class="hg-back" type="button">← Back to Games</button>
      <header class="hg-header">
        <p class="hg-eyebrow">Harmony · Chord Wheel</p>
        <h1 class="hg-title">Chord Wheel</h1>
        <p class="hg-subtitle">Spin 4 chords, reorder them, build a progression.</p>
      </header>

      <div class="cw-scale-row">Scale: <span class="cw-scale-select-slot"></span></div>

      <div class="cw-board">
        <div class="cw-handpan-slot"></div>
        <div class="cw-wheel-wrap">
          <div class="cw-wheel-pointer"></div>
          <svg class="cw-wheel-svg" viewBox="0 0 300 300"></svg>
          <div class="cw-wheel-hint">👆 Tap the wheel to spin</div>
        </div>
      </div>

      <div class="cw-mode-row">
        <div class="cw-mode-toggle">
          <button class="cw-mode-btn active" data-mode="scale" type="button">Scale Chords</button>
          <button class="cw-mode-btn" data-mode="any" type="button">Any Chords</button>
        </div>
        <label class="cw-unplayable-toggle" hidden>
          <input type="checkbox" id="cwIncludeUnplayable" />
          Include chords not on this scale
        </label>
        <button class="cw-chords-toggle-btn" type="button">🎛️ Chords</button>
      </div>

      <div class="cw-chords-panel" hidden></div>

      <div class="cw-actions-row">
        <button class="cw-spin-all-btn" type="button">🎡 Spin All 4</button>
        <button class="cw-play-btn" type="button">▶ Play Progression</button>
        <button class="cw-send-btn" type="button" disabled>→ Send to Studio</button>
      </div>

      <div class="cw-slots"></div>
    </div>
  `;

  slots = [null, null, null, null];
  mode = 'scale';
  includeUnplayable = false;
  wheelRotation = 0;

  slotsEl = view.querySelector('.cw-slots');
  sendBtn = view.querySelector('.cw-send-btn');
  wheelSvgEl = view.querySelector('.cw-wheel-svg');
  wheelWrapEl = view.querySelector('.cw-wheel-wrap');
  wheelHintEl = view.querySelector('.cw-wheel-hint');
  chordsPanelEl = view.querySelector('.cw-chords-panel');

  loadDisabledChords();
  mountHandpan(view.querySelector('.cw-handpan-slot'));
  mountScaleSelect(view.querySelector('.cw-scale-select-slot'));
  mountedScaleSelectEl = document.getElementById('scaleSelect');
  mountedScaleSelectEl?.addEventListener('change', onScaleChanged);
  Bus.on(BUS_EVENT.AUTH_LOGIN, onAuthReady);
  window.addEventListener('routeChanged', onRouteChanged);

  view.querySelector('.hg-back').addEventListener('click', () => {
    teardownGame();
    onBack?.();
  });
  wheelWrapEl.addEventListener('click', () => spinWheelTo(nextEmptySlotIndex()));
  view.querySelector('.cw-spin-all-btn').addEventListener('click', spinAll);
  view.querySelector('.cw-play-btn').addEventListener('click', playProgression);
  sendBtn.addEventListener('click', sendToStudio);

  view.querySelectorAll('.cw-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (wheelSpinning) return;
      mode = btn.dataset.mode;
      renderModeRow(view);
      renderWheel();
      renderChordsPanel();
    });
  });

  view.querySelector('#cwIncludeUnplayable').addEventListener('change', (e) => {
    includeUnplayable = e.target.checked;
    renderWheel();
    renderChordsPanel();
  });

  view.querySelector('.cw-chords-toggle-btn').addEventListener('click', () => {
    chordsPanelEl.hidden = !chordsPanelEl.hidden;
  });

  makeSortable(slotsEl, { itemSelector: '.cw-slot', axis: 'horizontal', onReorder: handleReorder });

  renderModeRow(view);
  renderWheel();
  renderSlots();
  renderChordsPanel();
}
