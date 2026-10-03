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

// --- Pure helpers (no instance state) ---

// "G Minor" -> "Gm", "F Major" -> "F"
function abbreviateChord(chord) {
  return chord.quality === 'Minor' ? `${chord.root}m` : chord.root;
}

// Includes inversion — "Am" root position and "Am I" are toggled separately.
function chordSignature(c) {
  return `${NOTE_MAP[c.root.toUpperCase()]}-${c.quality}-${c.inversion || 0}`;
}

function chordToggleLabel(c) {
  return c.inversion ? `${c.name} (${INVERSION_LABEL[c.inversion]})` : c.name;
}

// getSelectedScaleName() isn't stable across a reload — it's "D Kurd" live
// in-session but restores as the slug "d_kurd" from its own saved prefs.
// Normalize so both forms land on the same key.
function normalizeScaleKey(name) {
  return (name || 'default').toLowerCase().replace(/\s+/g, '_');
}

function playChordAt(chord) {
  if (!chord?.notes) return;
  playChordNotes(chord.notes);
  highlightChordNotes(chord, true);
}

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

// Moves a fixed, app-singleton DOM element (by id) into a slot and back —
// same relocate/restore shape js/free-record.js and js/method.js use for
// the same handpan element.
function createRelocatableMount(elementId) {
  let origParent = null;
  let origNextSibling = null;
  return {
    mount(slotEl) {
      const el = document.getElementById(elementId);
      if (!el || !slotEl || slotEl.contains(el)) return null;
      origParent = el.parentNode;
      origNextSibling = el.nextSibling;
      slotEl.appendChild(el);
      return el;
    },
    unmount() {
      const el = document.getElementById(elementId);
      if (el && origParent) origParent.insertBefore(el, origNextSibling);
      origParent = null;
      origNextSibling = null;
    },
  };
}

// --- The game ---

class ChordWheelGame {
  constructor(view, { onBack } = {}) {
    this.view = view;
    this.onBack = onBack;

    this.slots = [null, null, null, null];
    this.mode = 'scale';
    this.includeUnplayable = false;
    this.wheelRotation = 0;
    this.wheelSpinning = false;
    this.activeSpinAbort = null; // cancels the in-flight spin's pending transitionend
    this.activePool = [];
    this.disabledChords = new Set(); // signatures, e.g. "9-Minor-0" — off the wheel

    this.handpanMount = createRelocatableMount('handpanWrap');
    this.scaleSelectMount = createRelocatableMount('scaleSelect');
    this.mountedScaleSelectEl = null;

    // Stable per-instance references so add/removeEventListener match.
    this.onScaleChanged = this.onScaleChanged.bind(this);
    this.onAuthReady = this.onAuthReady.bind(this);
    this.onRouteChanged = this.onRouteChanged.bind(this);

    this.render();
  }

  // --- Chord pools ---

  getScalePool() {
    const notes = getAllCurrentNotes();
    if (!notes.length) return [];
    const chords = annotatePlayability(ChordAnalyzer.analyze(notes), getPitchPositionMap());
    return chords
      .filter(c => c.playable && c.quality !== 'Diminished')
      .map(c => ({ ...c, onThisPan: true }));
  }

  getAnyChordsPool() {
    const scalePool = this.getScalePool();
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

  // Full vocabulary for the active mode, before the on/off toggle filter —
  // what the "Chords" panel lists so a disabled chord can be re-enabled.
  getModeVocabulary() {
    if (this.mode === 'scale') return this.getScalePool();
    const pool = this.getAnyChordsPool();
    return this.includeUnplayable ? pool : pool.filter(c => c.onThisPan);
  }

  getActivePool() {
    return this.getModeVocabulary().filter(c => !this.disabledChords.has(chordSignature(c)));
  }

  // --- Disabled-chords persistence ---

  disabledChordsStorageKey() {
    const userId = currentUser?.id || 'guest';
    const scaleKey = normalizeScaleKey(getSelectedScaleName());
    return `cw_disabled_chords_${userId}_${scaleKey}`;
  }

  loadDisabledChords() {
    try {
      const raw = localStorage.getItem(this.disabledChordsStorageKey());
      this.disabledChords = new Set(raw ? JSON.parse(raw) : []);
    } catch {
      this.disabledChords = new Set();
    }
  }

  saveDisabledChords() {
    try {
      localStorage.setItem(this.disabledChordsStorageKey(), JSON.stringify([...this.disabledChords]));
    } catch {
      // ignore (private browsing, quota, etc.)
    }
  }

  // --- Lifecycle ---

  // Restores the handpan/scale-select to Studio and drops this instance's
  // listeners — needed whenever the game view stops being the active one,
  // however that happens. Safe to call more than once.
  teardown() {
    this.handpanMount.unmount();
    this.scaleSelectMount.unmount();
    this.mountedScaleSelectEl?.removeEventListener('change', this.onScaleChanged);
    Bus.off(BUS_EVENT.AUTH_LOGIN, this.onAuthReady);
    window.removeEventListener('routeChanged', this.onRouteChanged);
  }

  // Catches every way of leaving besides the Back button (which stays on
  // the #games route) — any other nav link, browser back/forward, etc.
  // Same pattern as js/method.js's onLeave().
  onRouteChanged({ detail }) {
    if (detail.route !== 'games') this.teardown();
  }

  // Mirrors js/chord-ui.js's own scale-change refresh: the 100ms delay lets
  // js/handpanmap.js finish updating currentScale/getAllCurrentNotes() first.
  // On a fresh page load, the game can mount before js/auth.js finishes its
  // async getSession() restore — currentUser is still null at that instant,
  // so the disabled-chords key would miss the real saved set. Re-load once
  // the real user becomes known, if that happens after mount.
  onAuthReady() {
    this.loadDisabledChords();
    this.renderWheel();
    this.renderChordsPanel();
  }

  onScaleChanged() {
    setTimeout(() => {
      this.slots = [null, null, null, null];
      this.wheelRotation = 0;
      this.loadDisabledChords(); // key includes the scale — a fresh set per scale
      this.renderWheel();
      this.renderSlots();
      this.renderChordsPanel();
    }, 100);
  }

  // --- Wheel ---

  renderWheel() {
    // Rebuilding mid-spin destroys the old SVG's pending transitionend
    // listener, which would otherwise strand wheelSpinning=true forever.
    this.activeSpinAbort?.();
    this.activePool = this.getActivePool();
    this.wheelSvgEl.outerHTML = buildWheelSVG(this.activePool);
    this.wheelSvgEl = this.view.querySelector('.cw-wheel-svg');
    this.wheelSvgEl.style.transform = `rotate(${this.wheelRotation}deg)`;
  }

  highlightTargetSlot(idx) {
    this.slotsEl?.querySelectorAll('.cw-slot').forEach((el) => {
      el.classList.toggle('cw-slot-target', el.dataset.id === `slot-${idx}`);
    });
  }

  spinWheelTo(slotIndex) {
    if (this.wheelSpinning || !this.activePool.length) return Promise.resolve();
    this.wheelSpinning = true;
    this.highlightTargetSlot(slotIndex);

    const n = this.activePool.length;
    const targetIndex = Math.floor(Math.random() * n);
    const segment = 360 / n;
    const centerAngle = (targetIndex + 0.5) * segment;
    const jitter = (Math.random() - 0.5) * segment * 0.6;
    const extraSpins = 5 * 360;
    const normalizedTarget = ((360 - centerAngle - jitter) % 360 + 360) % 360;
    const currentMod = ((this.wheelRotation % 360) + 360) % 360;
    this.wheelRotation += extraSpins + ((normalizedTarget - currentMod + 360) % 360);

    this.wheelSvgEl.style.transition = `transform ${SPIN_MS}ms cubic-bezier(0.12, 0.67, 0.1, 1)`;
    this.wheelSvgEl.style.transform = `rotate(${this.wheelRotation}deg)`;

    return new Promise((resolve) => {
      const onEnd = () => {
        this.wheelSvgEl.removeEventListener('transitionend', onEnd);
        this.wheelSpinning = false;
        this.activeSpinAbort = null;
        this.slots[slotIndex] = this.activePool[targetIndex];
        playChordAt(this.slots[slotIndex]);
        this.renderSlots();
        resolve();
      };
      this.wheelSvgEl.addEventListener('transitionend', onEnd);

      // No landing assignment on abort — the wheel's being rebuilt out from
      // under this spin (new scale/pool), so the slot should stay unfilled.
      this.activeSpinAbort = () => {
        this.wheelSvgEl.removeEventListener('transitionend', onEnd);
        this.wheelSpinning = false;
        this.activeSpinAbort = null;
        resolve();
      };
    });
  }

  async spinAll() {
    for (let i = 0; i < 4; i++) await this.spinWheelTo(i);
  }

  nextEmptySlotIndex() {
    const idx = this.slots.findIndex(c => !c);
    return idx === -1 ? 0 : idx;
  }

  handleReorder({ draggedId, beforeId }) {
    const fromIdx = parseInt(draggedId.split('-')[1], 10);
    const toIdx = beforeId ? parseInt(beforeId.split('-')[1], 10) : this.slots.length;
    const [moved] = this.slots.splice(fromIdx, 1);
    this.slots.splice(toIdx > fromIdx ? toIdx - 1 : toIdx, 0, moved);
    this.renderSlots();
  }

  playProgression() {
    this.slots.forEach((chord, i) => {
      if (!chord?.notes) return;
      setTimeout(() => playChordAt(chord), i * PLAY_SPACING_MS);
    });
    const lastPlayable = [...this.slots].reverse().find(c => c?.notes);
    if (lastPlayable) {
      setTimeout(() => highlightChordNotes(lastPlayable, false), this.slots.length * PLAY_SPACING_MS + 400);
    }
  }

  async sendToStudio() {
    if (!await guardBeforeReplacingGrid('You have unsaved changes. Discard them and replace the grid with this progression?')) return;

    const ctx = activeGrid;
    HistoryManager?.pushState();
    ctx.setMeasures(this.slots.length); // one measure per chord, fully cleared
    ctx.step = 0;

    this.slots.forEach((chord, i) => {
      const { start } = measureRange(i, ctx);
      applySelection(start, ctx);
      const labels = playChordNotes(chord.notes);
      assignChordToSelectedCell(labels, ctx);
    });

    renderAllMeasures(ctx);
    // ex. "Chords Am Dm Dm II C" — abbreviated like the wheel, inversions
    // spelled out ("Dm II") since there's no second line to wrap onto here.
    const chordLabels = this.slots.map((chord) => (
      chord.inversion ? `${abbreviateChord(chord)} ${INVERSION_LABEL[chord.inversion]}` : abbreviateChord(chord)
    ));
    updateCurrentPhraseName(`Chords ${chordLabels.join(' ')}`);
    this.teardown(); // restore the handpan/scale-select to Studio before leaving
    navigate('studio');
  }

  // --- Rendering ---

  renderSlots() {
    if (!this.slotsEl) return;

    this.slotsEl.innerHTML = this.slots.map((chord, i) => `
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

    this.slotsEl.querySelectorAll('.cw-spin-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.spinWheelTo(parseInt(btn.dataset.slot, 10));
      });
    });

    this.slotsEl.querySelectorAll('.cw-slot').forEach((el, i) => {
      const chord = this.slots[i];
      if (!chord?.notes) return;
      el.addEventListener('click', () => playChordAt(chord));
    });

    const allFilled = this.slots.every(c => c?.notes);
    if (this.sendBtn) this.sendBtn.disabled = !allFilled;
    if (this.wheelHintEl) this.wheelHintEl.hidden = this.slots.some(c => c);
    this.highlightTargetSlot(this.nextEmptySlotIndex());
  }

  renderModeRow() {
    this.view.querySelector('.cw-unplayable-toggle').hidden = this.mode !== 'any';
    this.view.querySelectorAll('.cw-mode-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === this.mode);
    });
  }

  renderChordsPanel() {
    if (!this.chordsPanelEl) return;

    const vocab = this.getModeVocabulary();
    const seen = new Set();
    const unique = vocab.filter((c) => {
      const sig = chordSignature(c);
      if (seen.has(sig)) return false;
      seen.add(sig);
      return true;
    });

    this.chordsPanelEl.innerHTML = '';
    if (!unique.length) {
      this.chordsPanelEl.innerHTML = '<p class="cw-chords-empty">No chords available for this scale.</p>';
      return;
    }

    unique.forEach((c) => {
      const sig = chordSignature(c);
      const row = document.createElement('div');
      row.className = 'cw-chord-toggle-row';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !this.disabledChords.has(sig);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) this.disabledChords.delete(sig);
        else this.disabledChords.add(sig);
        this.saveDisabledChords();
        this.renderWheel();
      });

      const previewBtn = document.createElement('button');
      previewBtn.type = 'button';
      previewBtn.className = 'cw-chord-preview-btn';
      previewBtn.textContent = chordToggleLabel(c);
      previewBtn.title = 'Play this chord';
      previewBtn.addEventListener('click', () => playChordAt(c));

      row.append(checkbox, previewBtn);
      this.chordsPanelEl.appendChild(row);
    });
  }

  render() {
    const view = this.view;
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

    this.slotsEl = view.querySelector('.cw-slots');
    this.sendBtn = view.querySelector('.cw-send-btn');
    this.wheelSvgEl = view.querySelector('.cw-wheel-svg');
    this.wheelWrapEl = view.querySelector('.cw-wheel-wrap');
    this.wheelHintEl = view.querySelector('.cw-wheel-hint');
    this.chordsPanelEl = view.querySelector('.cw-chords-panel');

    this.loadDisabledChords();
    const wrap = this.handpanMount.mount(view.querySelector('.cw-handpan-slot'));
    if (wrap) {
      // js/panel-resize.js pins a mobile max-width inline on #handpanWrap
      // for Studio's own layout; clear it so this game's CSS sizes it
      // instead. Studio re-syncs it on its own next routeChanged.
      wrap.style.maxWidth = '';
    }
    this.scaleSelectMount.mount(view.querySelector('.cw-scale-select-slot'));
    this.mountedScaleSelectEl = document.getElementById('scaleSelect');
    this.mountedScaleSelectEl?.addEventListener('change', this.onScaleChanged);
    Bus.on(BUS_EVENT.AUTH_LOGIN, this.onAuthReady);
    window.addEventListener('routeChanged', this.onRouteChanged);

    view.querySelector('.hg-back').addEventListener('click', () => {
      this.teardown();
      this.onBack?.();
    });
    this.wheelWrapEl.addEventListener('click', () => this.spinWheelTo(this.nextEmptySlotIndex()));
    view.querySelector('.cw-spin-all-btn').addEventListener('click', () => this.spinAll());
    view.querySelector('.cw-play-btn').addEventListener('click', () => this.playProgression());
    this.sendBtn.addEventListener('click', () => this.sendToStudio());

    view.querySelectorAll('.cw-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (this.wheelSpinning) return;
        this.mode = btn.dataset.mode;
        this.renderModeRow();
        this.renderWheel();
        this.renderChordsPanel();
      });
    });

    view.querySelector('#cwIncludeUnplayable').addEventListener('change', (e) => {
      this.includeUnplayable = e.target.checked;
      this.renderWheel();
      this.renderChordsPanel();
    });

    view.querySelector('.cw-chords-toggle-btn').addEventListener('click', () => {
      this.chordsPanelEl.hidden = !this.chordsPanelEl.hidden;
    });

    makeSortable(this.slotsEl, { itemSelector: '.cw-slot', axis: 'horizontal', onReorder: (e) => this.handleReorder(e) });

    this.renderModeRow();
    this.renderWheel();
    this.renderSlots();
    this.renderChordsPanel();
  }
}

export function renderChordWheelGame(view, options) {
  return new ChordWheelGame(view, options);
}
