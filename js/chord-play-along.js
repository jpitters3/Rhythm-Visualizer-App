// Chord Play Along — Harmony domain game. Listen to a chord played as an
// arpeggio, echo it back on your own handpan, get graded in real time.
// Not really "about" chord progressions — they're just the mechanism that
// keeps the sequence of chords musical instead of random. See
// js/chord-progression-templates.js for that layer.
import { chordSignature, getInversionLabel } from './chord-analyzer.js';
import { getScaleChordPool, notesToLabels, playChordNotes, highlightChordNotes } from './chord-playback.js';
import { setHandpanSide } from './handpanmap.js';
import { gridA } from './grid-context.js';
import { clearGrid, setInnerLabel, renderAllMeasures } from './notegrid.js';
import { setBeats, setSubdivision, start, stop, addTickObserver, removeTickObserver, intervalMs } from './noteplayer.js';
import { TransportRegistry } from './transport-ui.js';
import { labelNotation, setLabelNotation, currentUser, getSelectedScaleName } from './state.js';
import { navigate } from './router.js';
import { showToast } from './toast.js';
import { startPitchListening, stopPitchListening, resetPitchHistory } from './pitch-detector.js';
import { AUDIO_DELAY } from './config.js';

const BEATS = 4;
const SUBDIVISION = 2; // 8th notes — "1&2&" notation, 8 steps per measure
const BPM = 45;
const ARPEGGIO_STEPS = [0, 2, 4]; // beats 1/2/3 within a measure, at this subdivision
const DEFAULT_ROUNDS = 4;

// The Ding note has three equivalent spellings across the codebase:
// notesToLabels() (js/chord-playback.js) returns 'D', the grid's own
// convention (js/notegrid.js) is 'Ding'/'0', and findClosestScaleNote()
// (js/transcription.js, used by js/pitch-detector.js) always returns
// 'Ding'. Comparing two of these directly made every correctly-played
// Ding register as a mismatch — normalize before comparing or displaying.
function normalizeNoteLabel(label) {
  return (label === 'D' || label === '0' || label === 'Ding') ? 'Ding' : label;
}

// getSelectedScaleName() isn't stable across a reload (e.g. "D Kurd" live
// vs. the slug "d_kurd" restored from saved prefs) — same normalization
// js/chord-wheel-game.js uses so a disabled-chords key lands on the same
// value either way.
function normalizeScaleKey(name) {
  return (name || 'default').toLowerCase().replace(/\s+/g, '_');
}

// Moves a fixed, app-singleton DOM element (by id) into a slot and back —
// same relocate/restore shape js/chord-wheel-game.js and
// js/create-rhythm-game.js both already use.
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

class ChordPlayAlong {
  constructor(view, { onBack } = {}) {
    this.view = view;
    this.onBack = onBack;
    this.step = 'settings'; // 'settings' | 'playing' | 'summary'
    this.tornDown = false;
    this.tickObserver = null;
    this.rounds = DEFAULT_ROUNDS;
    this.disabledChords = new Set(); // chordSignature(c) values excluded from the random pool

    this.gridMount = createRelocatableMount('measures');
    this.transportMount = createRelocatableMount('mainTransport-A');
    this.handpanMount = createRelocatableMount('handpanWrap');
    this.scaleSelectMount = createRelocatableMount('scaleSelect');

    this.onRouteChanged = this.onRouteChanged.bind(this);
    this.onScaleChanged = this.onScaleChanged.bind(this);
    this.render();
  }

  // --- Chord pool: the exact same pool js/chord-wheel-game.js's Scale
  // Chords mode uses — every playable triad on the current scale,
  // excluding Diminished, with inversions kept as separate entries. ---

  // Random, not progression-based — same spirit as Chord Wheel's own random
  // spin, so every game is a different mix of chords instead of always the
  // same fixed sequence. (js/chord-progression-templates.js is kept around
  // for when progressions come back, just not used here right now.)
  buildChordSequence(count) {
    const pool = getScaleChordPool().filter(c => !this.disabledChords.has(chordSignature(c)));
    if (!pool.length) return [];
    return Array.from({ length: count }, () => pool[Math.floor(Math.random() * pool.length)]);
  }

  // --- Disabled-chords persistence (scoped per user + scale, same shape
  // as js/chord-wheel-game.js's own disabled-chords storage) ---

  disabledChordsStorageKey() {
    const userId = currentUser?.id || 'guest';
    const scaleKey = normalizeScaleKey(getSelectedScaleName());
    return `cpa_disabled_chords_${userId}_${scaleKey}`;
  }

  loadDisabledChords() {
    const key = this.disabledChordsStorageKey();
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) {
        this.disabledChords = new Set(JSON.parse(raw));
        return;
      }
    } catch {
      // fall through to the default below
    }
    // First time for this user+scale (nothing saved yet): inversions start
    // UNCHECKED, root position starts checked — Increasing Complexity mode
    // will start the same way, unlocking inversions as rounds progress.
    this.disabledChords = new Set(
      getScaleChordPool()
        .filter(c => (c.inversion || 0) !== 0)
        .map(c => chordSignature(c))
    );
  }

  saveDisabledChords() {
    try {
      localStorage.setItem(this.disabledChordsStorageKey(), JSON.stringify([...this.disabledChords]));
    } catch {
      // ignore (private browsing, quota, etc.)
    }
  }

  // --- Lifecycle ---

  setupFreshPhrase() {
    this.prevLabelNotation = labelNotation;
    setLabelNotation('musical'); // "1&2&" ampersand notation
    window.dispatchEvent(new CustomEvent('labelNotationChanged', { detail: 'musical' }));

    clearGrid(gridA);
    setBeats(BEATS, gridA);
    setSubdivision(SUBDIVISION, gridA);
    gridA.setMeasures(2);
    // countdownEnabled (a per-context flag, not the shared isListening one)
    // is set per-round in beginRound() — only round 0 gets the "countdown
    // from 4" count-in.
    renderAllMeasures(gridA);
  }

  teardown() {
    if (this.tornDown) return;
    this.tornDown = true;

    if (this.roundAdvanceTimer) {
      clearTimeout(this.roundAdvanceTimer);
      this.roundAdvanceTimer = null;
    }
    if (this.tickObserver) {
      removeTickObserver(this.tickObserver);
      this.tickObserver = null;
    }
    stopPitchListening();
    if (gridA.playing) {
      stop(gridA);
      TransportRegistry.updateAll(gridA);
    }

    gridA.countdownEnabled = false;
    setLabelNotation(this.prevLabelNotation || 'musical');
    window.dispatchEvent(new CustomEvent('labelNotationChanged', { detail: this.prevLabelNotation }));

    setHandpanSide(this.prevHandpanSideRaw || 'top');
    if (this.prevHandpanSideRaw != null) localStorage.setItem('gp_handpanSide', this.prevHandpanSideRaw);
    else localStorage.removeItem('gp_handpanSide');

    if (this.transportPlayBtn) {
      this.transportPlayBtn.onclick = this.origPlayBtnOnClick || null;
      this.transportPlayBtn = null;
    }

    this.mountedScaleSelectEl?.removeEventListener('change', this.onScaleChanged);
    this.gridMount.unmount();
    this.transportMount.unmount();
    this.handpanMount.unmount();
    this.scaleSelectMount.unmount();
    window.removeEventListener('routeChanged', this.onRouteChanged);
  }

  onRouteChanged({ detail }) {
    if (detail.route !== 'games') this.teardown();
  }

  // Mirrors js/chord-ui.js's own scale-change refresh: the 100ms delay lets
  // js/handpanmap.js finish updating currentScale first. The disabled set
  // is scoped per-scale, so reload it and refresh the checklist if it's
  // currently open.
  onScaleChanged() {
    setTimeout(() => {
      this.loadDisabledChords();
      if (this.step === 'settings' && this.stageEl?.querySelector('.cpa-chords-panel:not([hidden])')) {
        this.renderChordsPanel();
      }
    }, 100);
  }

  // --- Exercise flow ---

  startExercise() {
    const sequence = this.buildChordSequence(this.rounds);
    if (!sequence.length) {
      showToast('At least one chord needs to stay checked to play.', { type: 'error' });
      return;
    }

    this.setupFreshPhrase();
    this.sequence = sequence;
    this.results = []; // { degree, name, notes: [{correct,timingError}x3] }
    this.roundIndex = 0;

    this.step = 'playing';
    this.renderStage();

    startPitchListening((label, ts) => this.onPitchDetected(label, ts)).then((ok) => {
      if (!ok) {
        showToast('Microphone access is needed to play along.', { type: 'error' });
        this.step = 'settings';
        this.renderStage();
        return;
      }
      this.beginRound();
    });
  }

  beginRound() {
    if (this.roundIndex >= this.sequence.length) {
      this.finishExercise();
      return;
    }

    const chord = this.sequence[this.roundIndex];
    this.currentRoundResult = { name: chord.name, notes: [] };
    this.gradingActive = false;
    this.graded = new Set(); // attempt-step indices already graded
    resetPitchHistory(); // previous round's sustain-gate history doesn't apply to a new chord

    clearGrid(gridA);
    const labels = notesToLabels(chord.notes);
    ARPEGGIO_STEPS.forEach((step, i) => setInnerLabel(step, labels[i] || '', gridA));
    // Hide the answer: visually swap those 3 cells to "?" without touching
    // the underlying data, so the real scheduler still plays them in sync.
    ARPEGGIO_STEPS.forEach((step) => {
      const cell = gridA.cells[step];
      const inner = cell?.querySelector('.inner');
      if (inner) inner.textContent = '?';
      cell?.classList.remove('label-ding', 'label-t', 'label-s', 'label-n', 'visual-ding');
      cell?.classList.add('label-q');
    });

    this.renderStage();

    const totalSteps = gridA.beats * gridA.subdivision * 2; // 2 measures
    let ticks = 0;
    this.tickObserver = (ctx) => {
      if (ctx.id !== 'A') return;
      ticks++;
      if (ticks === gridA.stepsPerMeasure + 1) this.gradingActive = true; // attempt measure just started
      if (ticks >= totalSteps) this.endRound();
    };
    addTickObserver(this.tickObserver);
    // Only the very first round gets a count-in — after that, playback
    // should flow straight from one round into the next with no further
    // "3, 2, 1" pause.
    gridA.countdownEnabled = this.roundIndex === 0;
    start(gridA);
  }

  onPitchDetected(label, timestampMs) {
    if (!this.gradingActive) return;

    const msPerStep = intervalMs(gridA);
    // js/noteplayer.js schedules ALL audio — including the metronome click
    // the player is actually following — AUDIO_DELAY seconds after each
    // step's nominal time (see scheduleAudio()/config.js). The click you
    // actually hear on "beat 2" therefore sounds AUDIO_DELAY late relative
    // to the raw step math, so the expected time here needs the same
    // compensation Coaching Mode already applies, or "on the click" reads
    // as late (and playing early reads as perfectly on time).
    const audioStartMs = (gridA.audioStartTime || 0) * 1000 + (AUDIO_DELAY * 1000);
    const attemptSteps = ARPEGGIO_STEPS.map(s => s + gridA.stepsPerMeasure);

    // Only attribute this detection to the one beat whose own time window
    // it actually falls in (±half a step) — not just whichever ungraded
    // beat happens to be numerically closest. Without this, a harmonic/
    // decay artifact right after the beat just played could get
    // mis-attributed to a LATER beat that hasn't been reached yet, simply
    // because the real beat was already graded.
    let matchedStep = null;
    for (const step of attemptSteps) {
      const expected = audioStartMs + step * msPerStep;
      if (Math.abs(timestampMs - expected) <= msPerStep / 2) { matchedStep = step; break; }
    }
    if (matchedStep === null || this.graded.has(matchedStep)) return;

    const expectedIdx = attemptSteps.indexOf(matchedStep);
    const expectedLabel = notesToLabels(this.sequence[this.roundIndex].notes)[expectedIdx];
    const timingError = Math.abs(timestampMs - (audioStartMs + matchedStep * msPerStep));
    this.gradeNote(matchedStep, expectedLabel, label, timingError);
  }

  gradeNote(step, expectedLabel, detectedLabel, timingError) {
    this.graded.add(step);

    const noteMatch = normalizeNoteLabel(detectedLabel) === normalizeNoteLabel(expectedLabel);
    const noteScore = noteMatch ? 100 : 0;
    const timingScore = Math.max(0, 100 - (timingError / 2));
    const overallScore = noteScore * 0.7 + timingScore * 0.3;
    const correct = noteMatch && timingError < 200;

    this.currentRoundResult.notes.push({ correct, noteScore, timingScore, overallScore, timingError });

    // Visual-only — the transport is still actively playing through this
    // very measure, and setInnerLabel() would write into the real
    // innerLabels data the live scheduler reads from, causing it to
    // audibly play back the note it just heard. Update the cell's DOM
    // directly instead, same technique as the '?' demo-measure override.
    const cell = gridA.cells[step];
    if (cell) {
      const inner = cell.querySelector('.inner');
      if (inner) inner.textContent = normalizeNoteLabel(detectedLabel) === 'Ding' ? 'D' : detectedLabel;
      cell.classList.remove('label-ding', 'label-t', 'label-s', 'label-n', 'label-q', 'visual-ding', 'ghost');
      cell.classList.add('has-label');
      cell.classList.remove('coach-correct', 'coach-timing', 'coach-wrong');
      if (correct) cell.classList.add('coach-correct');
      else if (noteScore === 100) cell.classList.add('coach-timing');
      else cell.classList.add('coach-wrong');
    }
  }

  endRound() {
    if (this.tickObserver) {
      removeTickObserver(this.tickObserver);
      this.tickObserver = null;
    }
    this.gradingActive = false;
    stop(gridA);
    TransportRegistry.updateAll(gridA);

    // Any arpeggio note never detected at all counts as missed (score 0).
    const attemptSteps = ARPEGGIO_STEPS.map(s => s + gridA.stepsPerMeasure);
    attemptSteps.forEach((step) => {
      if (!this.graded.has(step)) {
        this.currentRoundResult.notes.push({ correct: false, noteScore: 0, timingScore: 0, overallScore: 0, timingError: null });
        gridA.cells[step]?.classList.add('coach-wrong');
      }
    });

    this.results.push(this.currentRoundResult);
    this.roundIndex++;
    // brief pause so the round's feedback is visible — tracked so stopExercise()
    // can cancel it if Stop is pressed during this gap between rounds.
    this.roundAdvanceTimer = setTimeout(() => {
      this.roundAdvanceTimer = null;
      this.beginRound();
    }, 1200);
  }

  // Transport Stop (or leaving mid-exercise some other way) — halts
  // playback/listening and returns to the settings screen so Start works
  // cleanly again, same as a normal "stop" halts playback.
  stopExercise() {
    if (this.roundAdvanceTimer) {
      clearTimeout(this.roundAdvanceTimer);
      this.roundAdvanceTimer = null;
    }
    if (this.tickObserver) {
      removeTickObserver(this.tickObserver);
      this.tickObserver = null;
    }
    this.gradingActive = false;
    stopPitchListening();
    if (gridA.playing) {
      stop(gridA);
      TransportRegistry.updateAll(gridA);
    }
    this.step = 'settings';
    this.renderStage();
  }

  finishExercise() {
    stopPitchListening();
    this.step = 'summary';
    this.renderStage();
  }

  // --- Scoring summary ---

  overallStats() {
    const allNotes = this.results.flatMap(r => r.notes);
    if (!allNotes.length) return { noteAccuracy: 0, timingAccuracy: 0, overallScore: 0 };
    // "Notes" is pure pitch correctness (noteScore, 0 or 100), independent
    // of timing — NOT the combined `correct` flag (which also requires
    // timingError < 200ms). A note played on the right pitch but a little
    // early/late should still count as a correct NOTE; its timing is what
    // the separate "Timing" stat is for. "Overall" is the only stat meant
    // to blend both.
    const noteAccuracy = Math.round(100 * allNotes.filter(n => n.noteScore === 100).length / allNotes.length);
    const timingAccuracy = Math.round(allNotes.reduce((s, n) => s + n.timingScore, 0) / allNotes.length);
    const overallScore = Math.round(allNotes.reduce((s, n) => s + n.overallScore, 0) / allNotes.length);
    return { noteAccuracy, timingAccuracy, overallScore };
  }

  // --- Rendering ---

  renderChordsPanel() {
    const panel = this.stageEl?.querySelector('.cpa-chords-panel');
    if (!panel) return;

    // Same dedup js/chord-wheel-game.js's own chords panel uses — the raw
    // pool can list the same (root, quality, inversion) more than once if
    // multiple note combos produce it; one checkbox per unique signature.
    const seen = new Set();
    const unique = getScaleChordPool().filter((c) => {
      const sig = chordSignature(c);
      if (seen.has(sig)) return false;
      seen.add(sig);
      return true;
    });

    panel.innerHTML = '';
    if (!unique.length) {
      panel.innerHTML = '<p class="cpa-chords-empty">No chords available for this scale.</p>';
      return;
    }

    unique.forEach((c) => {
      const sig = chordSignature(c);
      const row = document.createElement('div');
      row.className = 'cpa-chord-toggle-row';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !this.disabledChords.has(sig);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) this.disabledChords.delete(sig);
        else this.disabledChords.add(sig);
        this.saveDisabledChords();
      });

      const previewBtn = document.createElement('button');
      previewBtn.type = 'button';
      previewBtn.className = 'cpa-chord-preview-btn';
      previewBtn.textContent = c.inversion ? `${c.name} (${getInversionLabel(c.inversion)})` : c.name;
      previewBtn.title = 'Play this chord';
      previewBtn.addEventListener('click', () => {
        playChordNotes(c.notes);
        highlightChordNotes(c, true);
      });

      row.append(checkbox, previewBtn);
      panel.appendChild(row);
    });
  }

  renderStage() {
    const stage = this.stageEl;
    if (!stage) return;

    if (this.step === 'settings') {
      stage.innerHTML = `
        <p class="cpa-instruction">Listen to each chord, then play it back on your handpan — beats 1, 2, 3 of each round.</p>
        <label class="cpa-field">
          Number of chords
          <input type="number" id="cpaRounds" min="2" max="12" value="${this.rounds}">
        </label>
        <button class="cpa-chords-toggle-btn" type="button">🎛️ Chords</button>
        <div class="cpa-chords-panel" hidden></div>
        <div class="cpa-cta-row"><button class="cpa-cta-btn cpa-cta-primary" type="button" data-action="play">▶ Start</button></div>
      `;
      stage.querySelector('#cpaRounds').addEventListener('change', (e) => {
        this.rounds = Math.max(2, Math.min(12, parseInt(e.target.value, 10) || DEFAULT_ROUNDS));
      });
      stage.querySelector('.cpa-chords-toggle-btn').addEventListener('click', () => {
        const panel = stage.querySelector('.cpa-chords-panel');
        panel.hidden = !panel.hidden;
        if (!panel.hidden) this.renderChordsPanel();
      });
      stage.querySelector('[data-action="play"]').addEventListener('click', () => this.startExercise());
      return;
    }

    if (this.step === 'playing') {
      const chord = this.sequence[this.roundIndex];
      const chordLabel = chord ? (chord.inversion ? `${chord.name} (${getInversionLabel(chord.inversion)})` : chord.name) : '…';
      stage.innerHTML = `
        <p class="cpa-round-count">Chord ${this.roundIndex + 1} of ${this.sequence.length}</p>
        <h2 class="cpa-chord-name">${chordLabel}</h2>
        <p class="cpa-instruction">Listen, then play it back on beats 1, 2, 3.</p>
      `;
      return;
    }

    if (this.step === 'summary') {
      const { noteAccuracy, timingAccuracy, overallScore } = this.overallStats();
      stage.innerHTML = `
        <h2 class="cpa-chord-name">Nice work! 🎉</h2>
        <div class="cpa-score-row">
          <div><strong>${overallScore}%</strong><span>Overall</span></div>
          <div><strong>${noteAccuracy}%</strong><span>Notes</span></div>
          <div><strong>${timingAccuracy}%</strong><span>Timing</span></div>
        </div>
        <div class="cpa-cta-row">
          <button class="cpa-cta-btn cpa-cta-secondary" type="button" data-action="again">Play Again</button>
          <button class="cpa-cta-btn cpa-cta-primary" type="button" data-action="done">Done</button>
        </div>
      `;
      stage.querySelector('[data-action="again"]').addEventListener('click', () => {
        this.step = 'settings';
        this.renderStage();
      });
      stage.querySelector('[data-action="done"]').addEventListener('click', () => {
        this.teardown();
        navigate('games');
      });
      return;
    }
  }

  render() {
    const view = this.view;
    view.innerHTML = `
      <div class="hg-container cpa-container">
        <button class="hg-back" type="button">← Back to Games</button>
        <header class="hg-header">
          <p class="hg-eyebrow">Harmony · Chord Play Along</p>
          <h1 class="hg-title">Chord Play Along</h1>
          <p class="hg-subtitle">Get to know the chords on your own handpan, by ear.</p>
        </header>

        <div class="cpa-scale-row">Scale: <span class="cpa-scale-select-slot"></span></div>

        <div class="cpa-board">
          <div class="cpa-handpan-slot"></div>
        </div>

        <div class="cpa-stage"></div>

        <div class="cpa-grid-slot"></div>
        <div class="cpa-transport-slot"></div>
      </div>
    `;

    this.stageEl = view.querySelector('.cpa-stage');

    const wrap = this.handpanMount.mount(view.querySelector('.cpa-handpan-slot'));
    if (wrap) wrap.style.maxWidth = '';
    this.prevHandpanSideRaw = localStorage.getItem('gp_handpanSide');
    setHandpanSide('perimeter');
    this.scaleSelectMount.mount(view.querySelector('.cpa-scale-select-slot'));
    this.mountedScaleSelectEl = document.getElementById('scaleSelect');
    this.mountedScaleSelectEl?.addEventListener('change', this.onScaleChanged);
    this.loadDisabledChords();

    this.gridMount.mount(view.querySelector('.cpa-grid-slot'));
    this.transportMount.mount(view.querySelector('.cpa-transport-slot'));

    // The relocated transport's own Play button should behave like this
    // game's own Start button, not its normal play/stop-the-grid behavior
    // (TransportUI assigns a single .onclick property, so saving and
    // restoring it is enough — no listener juggling needed). Restored in
    // teardown() so Studio's own Play button works normally again after.
    this.transportPlayBtn = document.querySelector('#mainTransport-A .t-play-btn');
    if (this.transportPlayBtn) {
      this.origPlayBtnOnClick = this.transportPlayBtn.onclick;
      this.transportPlayBtn.onclick = (e) => {
        e.stopPropagation();
        if (this.step === 'playing') this.stopExercise();
        else if (this.step === 'settings') this.startExercise();
      };
    }

    view.querySelector('.hg-back').addEventListener('click', () => {
      this.teardown();
      this.onBack?.();
    });
    window.addEventListener('routeChanged', this.onRouteChanged);

    this.setupFreshPhrase();
    // One-time default — later setupFreshPhrase() calls (Start, Play Again)
    // must NOT re-apply this, so a tempo the player sets via the transport
    // before starting actually sticks.
    gridA.setBpm(BPM);
    TransportRegistry.updateAll(gridA);
    this.renderStage();
  }
}

export function renderChordPlayAlong(view, options) {
  return new ChordPlayAlong(view, options);
}
