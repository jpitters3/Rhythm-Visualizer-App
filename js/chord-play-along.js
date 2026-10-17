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
import { setBeats, setSubdivision, start, stop, addTickObserver, removeTickObserver, intervalMs, getAudioCtx } from './noteplayer.js';
import { TransportRegistry } from './transport-ui.js';
import { labelNotation, setLabelNotation, currentUser, getSelectedScaleName, getScale } from './state.js';
import { showToast } from './toast.js';
import { startPitchListening, stopPitchListening, resetPitchHistory } from './pitch-detector.js';
import { AUDIO_DELAY } from './config.js';
import { supabase } from './supabase-client.js';

const BEATS = 4;
const SUBDIVISION = 2; // 8th notes — "1&2&" notation, 8 steps per measure
const BPM = 45;
const ARPEGGIO_STEPS = [0, 2, 4]; // beats 1/2/3 within a measure, at this subdivision
const CHORDS_PER_ROUND = 4;
const DEFAULT_ROUND_COUNT = 1;
const MIN_ROUNDS = 1;
const MAX_ROUNDS = 6;
const ROUND_GOOD_THRESHOLD = 70; // average overallScore across a round's notes, 0-100
// "Known" for the My Progress dashboard — pitch-accuracy-only (see
// chordBreakdown()'s own note on why timing is excluded), so this is
// deliberately a separate constant from ROUND_GOOD_THRESHOLD even though
// they're numerically the same today; the two measure different things
// and have no reason to be forced to move together later.
const CHORD_KNOWN_THRESHOLD = 70;

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

// chord.notes holds raw pitch strings like "Fs4"/"Bb3" (js/chord-analyzer.js's
// parseNote() format) — notesToLabels() (js/chord-playback.js) converts
// those to the handpan's own position labels (Ding/1-8), which is right
// for the grid but not what "the notes that make up this chord" means in
// the summary breakdown. This keeps the letter name and strips the octave.
function formatPitchName(pitch) {
  const match = pitch.match(/^([A-G])([#bBs]?)(-?\d+)$/i);
  if (!match) return pitch;
  const letter = match[1].toUpperCase();
  const mod = match[2].toLowerCase();
  if (mod === '#' || mod === 's') return `${letter}♯`;
  if (mod === 'b') return `${letter}♭`;
  return letter;
}

// A quick synthesized chime for the round-transition banner — ascending
// major-triad arpeggio for a good round, a short descending dip for a
// rough one. No audio asset needed; same createOscillator()+gain-envelope
// approach js/transcription.js's countdown click already uses.
function playRoundResultSound(good) {
  const audioCtx = getAudioCtx();
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const freqs = good ? [523.25, 659.25, 783.99] : [392.00, 349.23]; // C5-E5-G5 vs. G4-F4
  const noteGap = good ? 0.09 : 0.12;
  freqs.forEach((freq, i) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = good ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(freq, now);
    const t = now + i * noteGap;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.18, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.32);
  });
}

// A short bright "ding" for a single fully-correct chord (every expected
// beat correct — see gradeNote()/finalizeChordGrading()), distinct from
// the round-transition chime above so the two don't read as the same
// event.
function playChordSuccessSound() {
  const audioCtx = getAudioCtx();
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const freqs = [880, 1108.73]; // A5 -> C#6
  freqs.forEach((freq, i) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    const t = now + i * 0.06;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.14, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.24);
  });
}

// Same shape as playChordSuccessSound() (short two-note synthesized blip,
// same envelope timing) but a flat, low "buzz" instead of a bright
// ascending ding — a new, distinct sound for a chord that wasn't fully
// correct, not a reuse of the success chime itself.
function playChordIncorrectSound() {
  const audioCtx = getAudioCtx();
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const freqs = [196.00, 185.00]; // G3 -> Fs3, a half-step down — a "buzz," not a tune
  freqs.forEach((freq, i) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, now);
    const t = now + i * 0.06;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.1, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.24);
  });
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
    this.roundCount = DEFAULT_ROUND_COUNT;
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
  //
  // Returns roundCount arrays of up to CHORDS_PER_ROUND chords each. No
  // chord signature (root+quality+inversion — so e.g. "A Minor" and
  // "A Minor I" count as different chords) repeats within a single round;
  // the same chord can reappear in a LATER round. A pool with fewer than
  // CHORDS_PER_ROUND unique chords just gives that round fewer chords
  // rather than repeating one to pad it out.
  buildChordSequence(roundCount) {
    const seen = new Set();
    const uniquePool = getScaleChordPool().filter((c) => {
      const sig = chordSignature(c);
      if (this.disabledChords.has(sig) || seen.has(sig)) return false;
      seen.add(sig);
      return true;
    });
    if (!uniquePool.length) return [];

    const roundSize = Math.min(CHORDS_PER_ROUND, uniquePool.length);
    return Array.from({ length: roundCount }, () => (
      [...uniquePool].sort(() => Math.random() - 0.5).slice(0, roundSize)
    ));
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
    // First time for this user+scale (nothing saved yet): 
    // inversions start UNCHECKED;
    // chords including the Ding start UNCHECKED; 
    // root position starts checked — Increasing Complexity mode
    // will start the same way, unlocking inversions as rounds progress.
    const dingPitch = getScale()?.ding;
    this.disabledChords = new Set(
      getScaleChordPool()
        .filter(c => (c.inversion || 0) !== 0 || (dingPitch && c.notes.includes(dingPitch)))
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

  // measureCount defaults to a single demo+attempt pair for the idle grid
  // shown behind the settings screen; startExercise() passes the real
  // count (2 measures per round, the whole phrase built up front so
  // playback never stops/restarts between chords — see beginPhrase()).
  setupFreshPhrase(measureCount = 2) {
    this.prevLabelNotation = labelNotation;
    setLabelNotation('musical'); // "1&2&" ampersand notation
    window.dispatchEvent(new CustomEvent('labelNotationChanged', { detail: 'musical' }));

    clearGrid(gridA);
    setBeats(BEATS, gridA);
    setSubdivision(SUBDIVISION, gridA);
    gridA.setMeasures(measureCount);
    renderAllMeasures(gridA);

    const headers = gridA.container?.querySelectorAll('.measure-header');
    if (headers?.[0]) headers[0].textContent = 'Listen';
    if (headers?.[1]) headers[1].textContent = 'Play';
  }

  teardown() {
    if (this.tornDown) return;
    this.tornDown = true;

    this.closeSummaryModal();
    this.closeProgressModal();
    this.closeRoundBanner();
    clearTimeout(this.chordSoundTimer);
    clearTimeout(this.chordPreviewFadeTimer);
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
    gridA.loopPlayback = true; // restore Studio's normal infinite-loop playback
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
    // Restores the real "Measure 1"/"Measure 2" headers the 'Listen'/'Play'
    // override (beginPhrase()) replaced — #measures is back in Studio's own
    // DOM at this point, so this repaints it there, not here.
    renderAllMeasures(gridA);
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
    const rounds = this.buildChordSequence(this.roundCount);
    if (!rounds.length || !rounds[0].length) {
      showToast('At least one chord needs to stay checked to play.', { type: 'error' });
      return;
    }

    // this.sequence is every round's chords flattened into one phrase;
    // roundSizes/roundEndIndices (chordIndex boundaries, cumulative) and
    // chordRoundIndex/chordPositionInRound (per-chord lookups) are what let
    // the tick observer and the UI talk about "round 2, chord 3 of 4"
    // without assuming every round has exactly CHORDS_PER_ROUND chords —
    // a small enabled-chords pool can make a round come up short.
    this.roundSizes = rounds.map(r => r.length);
    this.roundEndIndices = [];
    this.chordRoundIndex = [];
    this.chordPositionInRound = [];
    let cumulative = 0;
    rounds.forEach((roundChords, r) => {
      roundChords.forEach((_, i) => {
        this.chordRoundIndex.push(r);
        this.chordPositionInRound.push(i);
      });
      cumulative += roundChords.length;
      this.roundEndIndices.push(cumulative);
    });
    this.sequence = rounds.flat();

    // The whole phrase (every round's demo + attempt measure pair) is sized
    // and filled up front in beginPhrase(), then played start-to-finish in
    // a single start(gridA) call — one steady beat straight through, no
    // stop/restart gap between chords.
    this.setupFreshPhrase(this.sequence.length * 2);
    this.results = []; // { degree, name, notes: [{correct,timingError}x3] }
    this.chordIndex = 0;

    this.step = 'playing';
    this.renderStage();

    // The layout doesn't change on Start (it's the same reordered-for-mobile
    // layout throughout, see css/chord-play-along.css) — just bring the
    // stage into view, since the settings fields above are no longer
    // relevant once play begins. Scrolled to the TOP of .cpa-stage (with a
    // small gap above it), not all the way to the bottom of the page — the
    // stage is what the player needs to read first, and scrolling to the
    // bottom could crop its top edge off-screen on a short viewport.
    const scrollContainer = this.view.closest('.route-view');
    if (scrollContainer && this.stageEl) {
      const stageGapFromTop = this.stageEl.getBoundingClientRect().top - scrollContainer.getBoundingClientRect().top;
      scrollContainer.scrollTo({ top: scrollContainer.scrollTop + stageGapFromTop - 16, behavior: 'smooth' });
    }

    startPitchListening((label, ts) => this.onPitchDetected(label, ts)).then((ok) => {
      if (!ok) {
        showToast('Microphone access is needed to play along.', { type: 'error' });
        this.step = 'settings';
        this.renderStage();
        return;
      }
      this.beginPhrase();
    });
  }

  // Builds every chord's demo ("Listen") + attempt ("Play") measure pair
  // into the grid up front, then plays the whole thing through in one
  // uninterrupted start(gridA) call
  beginPhrase() {
    const stepsPerMeasure = gridA.stepsPerMeasure;
    const chordSteps = stepsPerMeasure * 2; // demo + attempt measure

    clearGrid(gridA);

    this.sequence.forEach((chord, c) => {
      const demoOffset = c * chordSteps;
      const attemptOffset = demoOffset + stepsPerMeasure;
      const labels = notesToLabels(chord.notes);

      ARPEGGIO_STEPS.forEach((step, i) => setInnerLabel(demoOffset + step, labels[i] || '', gridA));
      // Hide the answer: visually swap those 3 cells to "?" without
      // touching the underlying data, so the real scheduler still plays
      // them in sync.
      ARPEGGIO_STEPS.forEach((step) => {
        const cell = gridA.cells[demoOffset + step];
        const inner = cell?.querySelector('.inner');
        if (inner) inner.textContent = '?';
        cell?.classList.remove('label-ding', 'label-t', 'label-s', 'label-n', 'visual-ding');
        cell?.classList.add('label-q');
      });
      // Outline the 3 cells in each chord's attempt measure (beats 1, 2, 3)
      // the player is actually meant to play — see .cpa-target-cell in
      // css/chord-play-along.css.
      ARPEGGIO_STEPS.forEach((step) => {
        gridA.cells[attemptOffset + step]?.classList.add('cpa-target-cell');
      });
    });

    // "Listen"/"Play" read better than the grid's generic "Measure 1"/
    // "Measure 2" headers for what's actually happening in each pair —
    // visual-only, like the '?' override above; teardown() restores the
    // real headers.
    const headers = gridA.container?.querySelectorAll('.measure-header');
    this.sequence.forEach((_, c) => {
      if (headers?.[c * 2]) headers[c * 2].textContent = 'Listen';
      if (headers?.[c * 2 + 1]) headers[c * 2 + 1].textContent = 'Play';
    });

    this.chordIndex = 0;
    this.currentChordResult = { name: this.sequence[0].name, notes: [] };
    this.chordResultSoundPlayed = false; // success/incorrect chime fires once per chord — see gradeNote()
    this.gradingActive = false;
    this.graded = new Set(); // attempt-step indices already graded (absolute, whole-phrase)
    resetPitchHistory();

    this.renderStage();

    const totalSteps = chordSteps * this.sequence.length;
    let ticks = 0;
    this.tickObserver = (ctx) => {
      if (ctx.id !== 'A') return;
      ticks++;
      const posInChord = (ticks - 1) % chordSteps;
      const newChordIndex = Math.min(Math.floor((ticks - 1) / chordSteps), this.sequence.length - 1);

      if (newChordIndex !== this.chordIndex) {
        this.finalizeChordGrading(this.chordIndex);

        // A round of CHORDS_PER_ROUND chords (or fewer, on a small pool)
        // just finished — not on the very last chord of the whole phrase,
        // which has no "next round" to transition into and gets no banner
        // (finishPhrase()'s summary modal is its own payoff).
        const completedRoundIdx = this.roundEndIndices.indexOf(newChordIndex);
        if (completedRoundIdx !== -1) this.showRoundTransition(completedRoundIdx);

        this.chordIndex = newChordIndex;
        this.currentChordResult = { name: this.sequence[this.chordIndex].name, notes: [] };
        this.chordResultSoundPlayed = false;
        this.gradingActive = false;
        resetPitchHistory(); // previous chord's sustain-gate history doesn't apply to a new chord
        this.renderStage();
      }

      if (posInChord === stepsPerMeasure) this.gradingActive = true; // this chord's attempt measure just started
      if (ticks >= totalSteps) this.finishPhrase();
    };
    addTickObserver(this.tickObserver);
    gridA.countdownEnabled = true; // one count-in for the whole phrase, not per chord
    // The grid is normally an infinite loop sequencer — without this, the
    // ~100ms audio lookahead schedules (and briefly plays) the first steps
    // of "round 1 again" right as the phrase reaches its natural end, since
    // that end is reached mid-schedule, before finishPhrase()'s stop() can
    // land. See js/grid-context.js's loopPlayback and the matching guard in
    // js/noteplayer.js's audioSchedulerTick().
    gridA.loopPlayback = false;
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
    const chordOffset = this.chordIndex * gridA.stepsPerMeasure * 2;
    const attemptSteps = ARPEGGIO_STEPS.map(s => chordOffset + gridA.stepsPerMeasure + s);

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
    const expectedLabel = notesToLabels(this.sequence[this.chordIndex].notes)[expectedIdx];
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

    this.currentChordResult.notes.push({ correct, noteScore, timingScore, overallScore, timingError });

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

    // Engine-level rule, not specific to "3 chord notes": the instant every
    // expected beat for THIS chord (ARPEGGIO_STEPS here — a different game
    // built on this same grading loop might expect more or fewer beats,
    // spread across more measures) has been graded, play success or
    // incorrect right here — not deferred to the chord transition/round
    // banner, so it lands the moment the player actually finishes playing
    // the chord, even mid-measure. Only fires once per chord
    // (chordResultSoundPlayed) — a chord with a note that's never detected
    // at all only gets graded in full at finalizeChordGrading(), further
    // below, which is the fallback for exactly that case.
    const chordOffset = this.chordIndex * gridA.stepsPerMeasure * 2;
    const attemptSteps = ARPEGGIO_STEPS.map(s => chordOffset + gridA.stepsPerMeasure + s);
    const allBeatsGraded = attemptSteps.every(s => this.graded.has(s));
    if (allBeatsGraded && !this.chordResultSoundPlayed) {
      this.chordResultSoundPlayed = true;
      this.playChordResultSound(this.currentChordResult.notes.every(n => n.correct));
    }
  }

  // Any arpeggio note in chordIdx's attempt measure never detected at all
  // counts as missed (score 0). Called on every chord transition (for the
  // chord just finished) and once more at the very end of the phrase (for
  // the final chord, which has no "next chord" transition to trigger it).
  // A chord that WAS fully graded via gradeNote() (every beat detected)
  // already had its success/incorrect chime fire there, the instant that
  // happened (chordResultSoundPlayed) — this only ever adds MISSED beats,
  // so when it's the one triggering the sound, it can only ever be
  // incorrect (a missed note is never "correct").
  finalizeChordGrading(chordIdx) {
    const chordOffset = chordIdx * gridA.stepsPerMeasure * 2;
    const attemptSteps = ARPEGGIO_STEPS.map(s => chordOffset + gridA.stepsPerMeasure + s);
    attemptSteps.forEach((step) => {
      if (!this.graded.has(step)) {
        this.currentChordResult.notes.push({ correct: false, noteScore: 0, timingScore: 0, overallScore: 0, timingError: null });
        gridA.cells[step]?.classList.add('coach-wrong');
      }
    });
    if (!this.chordResultSoundPlayed && this.currentChordResult.notes.length) {
      this.chordResultSoundPlayed = true;
      this.playChordResultSound(false);
    }
    this.results.push(this.currentChordResult);
  }

  // A beat of breathing room before the chime, instead of it landing right
  // on top of the note that just decided it
  playChordResultSound(correct) {
    clearTimeout(this.chordSoundTimer);
    this.chordSoundTimer = setTimeout(() => {
      this.chordSoundTimer = null;
      if (correct) playChordSuccessSound();
      else playChordIncorrectSound();
    }, 500);
  }

  finishPhrase() {
    if (this.tickObserver) {
      removeTickObserver(this.tickObserver);
      this.tickObserver = null;
    }
    this.gradingActive = false;
    this.finalizeChordGrading(this.chordIndex);
    // Deferred past this tick on purpose: this method is itself called
    // from inside the tick observer, and stop() resets gridA.step to 0 as
    // part of its normal cleanup
    setTimeout(() => {
      stop(gridA);
      TransportRegistry.updateAll(gridA);
    }, 0);
    this.finishExercise();
  }

  // A round (CHORDS_PER_ROUND chords, or fewer on a small pool) just
  // finished while the phrase keeps playing underneath — this is a
  // non-blocking banner + chime, never a pause, so the steady beat holds.
  // roundIdx is 0-based into this.roundSizes/this.results.
  showRoundTransition(roundIdx) {
    this.closeRoundBanner();

    const roundResult = this.results.slice(-this.roundSizes[roundIdx]);
    const notes = roundResult.flatMap(r => r.notes);
    const avgScore = notes.length ? notes.reduce((s, n) => s + n.overallScore, 0) / notes.length : 0;
    const good = avgScore >= ROUND_GOOD_THRESHOLD;

    playRoundResultSound(good);

    const banner = document.createElement('div');
    banner.className = `cpa-round-banner ${good ? 'cpa-round-banner-good' : 'cpa-round-banner-bad'}`;
    // 🌱, not 💪 — a flexed bicep on a missed round reads as "you need to
    // get stronger," not encouragement. Growth/keep-going fits better.
    banner.innerHTML = `
      <span class="cpa-round-banner-icon">${good ? '🔥' : '🌱'}</span>
      <span class="cpa-round-banner-text">
        Round ${roundIdx + 1} complete<br>${good ? 'Great playing!' : 'Keep at it!'}
      </span>
    `;
    document.body.appendChild(banner);
    // Sits just above the measures grid, not a fixed viewport percentage —
    // the grid's scroll position varies by device and by how far down the
    // page the player has scrolled.
    const gridRect = this.view.querySelector('.cpa-grid-slot')?.getBoundingClientRect();
    if (gridRect) {
      banner.style.top = `${Math.max(8, gridRect.top - banner.offsetHeight - 12)}px`;
    }
    banner.addEventListener('animationend', () => this.closeRoundBanner());
    this.roundBannerEl = banner;
    // Safety net if animationend never fires (e.g. the tab was backgrounded).
    this.roundBannerTimer = setTimeout(() => this.closeRoundBanner(), 2200);
  }

  closeRoundBanner() {
    if (this.roundBannerTimer) {
      clearTimeout(this.roundBannerTimer);
      this.roundBannerTimer = null;
    }
    this.roundBannerEl?.remove();
    this.roundBannerEl = null;
  }

  // Transport Stop, the Reset button, or leaving mid-exercise some other
  // way — halts playback/listening and returns to the settings screen so
  // Start works cleanly again, same as a normal "stop" halts playback.
  stopExercise() {
    if (this.tickObserver) {
      removeTickObserver(this.tickObserver);
      this.tickObserver = null;
    }
    this.gradingActive = false;
    this.closeRoundBanner();
    clearTimeout(this.chordSoundTimer);
    stopPitchListening();
    if (gridA.playing) {
      stop(gridA);
      TransportRegistry.updateAll(gridA);
    }
    // Same reasoning as "Play Again" in renderSummaryModal(): wipe whatever
    // coach-correct/-timing/-wrong highlighting the in-progress phrase left
    // behind, back to a blank placeholder grid.
    this.setupFreshPhrase();
    this.step = 'settings';
    this.renderStage();
    // Back to the same top-of-view state Start scrolled away from.
    this.view.closest('.route-view')?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Reset button (header, visible only once play has begun) — a clearly
  // intentional "start over" distinct from the transport's own play/stop
  // icon, which doubles as this game's Start/Stop control.
  resetExercise() {
    this.stopExercise();
  }

  finishExercise() {
    stopPitchListening();
    this.saveSession(); // fire-and-forget — never blocks showing the summary
    this.step = 'summary';
    this.renderStage();
  }

  // --- Scoring summary ---

  // Persists this phrase to cpa_sessions (supabase/migrations/
  // 20261012000000_create_cpa_sessions.sql) so the My Progress dashboard
  // can aggregate across sessions. Guests (no account) just don't get
  // history — same as every other save-to-Supabase feature in this app.
  async saveSession() {
    if (!currentUser) return;
    const { overallScore, noteAccuracy, timingAccuracy } = this.overallStats();
    try {
      const { error } = await supabase.from('cpa_sessions').insert({
        user_id: currentUser.id,
        scale_key: normalizeScaleKey(getSelectedScaleName()),
        round_count: this.roundCount,
        bpm: gridA.bpm,
        overall_score: overallScore,
        note_accuracy: noteAccuracy,
        timing_accuracy: timingAccuracy,
        chord_results: this.chordBreakdown(),
      });
      if (error) throw error;
    } catch (err) {
      console.error('[ChordPlayAlong] Failed to save session:', err);
    }
  }

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

  // Per-chord breakdown for the summary modal (and the row saved to
  // cpa_sessions.chord_results) — one row per distinct chord signature (so
  // e.g. "A Minor" and "A Minor I" stay separate, same uniqueness rule as
  // buildChordSequence()'s one-per-round limit).
  //
  // "Correct" here is PITCH only (every note's noteScore === 100), not the
  // stricter correct flag (which also requires timingError < 200ms) — a
  // chord played at 200bpm will rack up late hits that a slower take
  // wouldn't, and that's a tempo/reaction-speed story, not a "do they know
  // this chord" story. Timing isn't tracked per-chord for progress at all
  // right now; it'd need its own tempo-aware treatment (see overallStats()'s
  // "Timing" stat for the session-level version), not a straight reuse of
  // this same threshold.
  chordBreakdown() {
    const bySignature = new Map();
    this.sequence.forEach((chord, i) => {
      const sig = chordSignature(chord);
      if (!bySignature.has(sig)) {
        bySignature.set(sig, {
          signature: sig,
          label: chord.inversion ? `${chord.name} (${getInversionLabel(chord.inversion)})` : chord.name,
          notesLabel: chord.notes.map(formatPitchName).join(' – '),
          correct: 0,
          incorrect: 0,
        });
      }
      const result = this.results[i];
      const allCorrect = !!result?.notes.length && result.notes.every(n => n.noteScore === 100);
      const entry = bySignature.get(sig);
      if (allCorrect) entry.correct++;
      else entry.incorrect++;
    });
    return Array.from(bySignature.values());
  }

  // --- My Progress dashboard ---

  // Every past session's chord_results for the CURRENT scale (progress on
  // one handpan layout isn't meaningful mixed with another — same reasoning
  // as scale_key's own column comment in the migration). Returns null on a
  // fetch error (distinct from [], which legitimately means "no sessions
  // yet") so the caller can tell "nothing to show" from "couldn't load."
  async fetchProgressRows() {
    if (!currentUser) return [];
    try {
      const { data, error } = await supabase
        .from('cpa_sessions')
        .select('chord_results')
        .eq('user_id', currentUser.id)
        .eq('scale_key', normalizeScaleKey(getSelectedScaleName()))
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return data || [];
    } catch (err) {
      console.error('[ChordPlayAlong] Failed to load progress:', err);
      return null;
    }
  }

  // Sums correct/incorrect per chord signature across every session row,
  // then splits into "known" vs. "struggling" at CHORD_KNOWN_THRESHOLD.
  // Known chords sort best-first (what's solid), struggling chords sort
  // worst-first (what most needs attention) — whichever list is more
  // useful to read top-to-bottom for that group.
  aggregateProgress(sessionRows) {
    const bySignature = new Map();
    sessionRows.forEach((row) => {
      (row.chord_results || []).forEach((entry) => {
        if (!bySignature.has(entry.signature)) {
          bySignature.set(entry.signature, {
            label: entry.label,
            notesLabel: entry.notesLabel,
            correct: 0,
            incorrect: 0,
          });
        }
        const agg = bySignature.get(entry.signature);
        agg.correct += entry.correct;
        agg.incorrect += entry.incorrect;
      });
    });

    const withAccuracy = Array.from(bySignature.values()).map((e) => {
      const total = e.correct + e.incorrect;
      return { ...e, total, accuracy: total ? Math.round(100 * e.correct / total) : 0 };
    });

    const known = withAccuracy
      .filter(e => e.accuracy >= CHORD_KNOWN_THRESHOLD)
      .sort((a, b) => b.accuracy - a.accuracy);
    const struggling = withAccuracy
      .filter(e => e.accuracy < CHORD_KNOWN_THRESHOLD)
      .sort((a, b) => a.accuracy - b.accuracy);
    return { known, struggling };
  }

  progressSectionHTML(title, icon, chords) {
    if (!chords.length) return '';
    const rows = chords.map(c => `
      <div class="cpa-breakdown-row">
        <div class="cpa-breakdown-main">
          <span class="cpa-breakdown-name">${c.label}</span>
          <span class="cpa-breakdown-notes">${c.notesLabel}</span>
        </div>
        <span class="cpa-progress-accuracy ${c.accuracy >= CHORD_KNOWN_THRESHOLD ? 'cpa-breakdown-correct' : 'cpa-breakdown-incorrect'}">${c.accuracy}%</span>
      </div>
    `).join('');
    return `
      <div class="cpa-progress-section">
        <h3 class="cpa-progress-heading">${icon} ${title}</h3>
        <div class="cpa-breakdown-list">${rows}</div>
      </div>
    `;
  }

  // Shared between the standalone "My Progress" modal and the summary
  // carousel's second page — both just hand it a container to fill.
  async loadProgressInto(container) {
    if (!currentUser) {
      container.innerHTML = '<p class="cpa-progress-empty">Sign in to track your progress over time.</p>';
      return;
    }
    container.innerHTML = '<p class="cpa-progress-empty">Loading your progress…</p>';
    const rows = await this.fetchProgressRows();
    if (!container.isConnected) return; // modal/page was closed while this was in flight
    if (rows === null) {
      container.innerHTML = '<p class="cpa-progress-empty">Couldn’t load your progress right now.</p>';
      return;
    }
    if (!rows.length) {
      container.innerHTML = '<p class="cpa-progress-empty">Play a round to start building your progress history.</p>';
      return;
    }
    const { known, struggling } = this.aggregateProgress(rows);
    container.innerHTML = this.progressSectionHTML('Known well', '✅', known)
      + this.progressSectionHTML('Still practicing', '🌱', struggling);
  }

  openProgressModal() {
    this.closeProgressModal();
    const backdrop = document.createElement('div');
    backdrop.className = 'cpa-modal-backdrop';
    backdrop.innerHTML = `
      <div class="cpa-modal-card">
        <h2 class="cpa-chord-name">My Progress</h2>
        <div class="cpa-progress-body"></div>
        <div class="cpa-cta-row">
          <button class="cpa-cta-btn cpa-cta-primary" type="button" data-action="close">Close</button>
        </div>
      </div>
    `;
    backdrop.querySelector('[data-action="close"]').addEventListener('click', () => this.closeProgressModal());
    document.body.appendChild(backdrop);
    this.progressModalEl = backdrop;
    this.loadProgressInto(backdrop.querySelector('.cpa-progress-body'));
  }

  closeProgressModal() {
    this.progressModalEl?.remove();
    this.progressModalEl = null;
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

    // "Tap"/"Click" swap by CSS media query (same breakpoint as the rest of
    // this file's mobile layout), not JS touch detection — a touch-capable
    // laptop with a mouse should still read "Click" if it's wide enough to
    // render the desktop layout.
    panel.innerHTML = `
      <p class="cpa-chords-hint">
        <span class="cpa-chords-hint-tap">Tap</span><span class="cpa-chords-hint-click">Click</span> a chord to play 🎶
      </p>
    `;
    if (!unique.length) {
      panel.insertAdjacentHTML('beforeend', '<p class="cpa-chords-empty">No chords available for this scale.</p>');
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
        clearTimeout(this.chordPreviewFadeTimer);
        this.chordPreviewFadeTimer = setTimeout(() => highlightChordNotes(c, false), 2500);
      });

      row.append(checkbox, previewBtn);
      panel.appendChild(row);
    });
  }

  renderStage() {
    const stage = this.stageEl;
    if (!stage) return;

    if (this.step !== 'summary') this.closeSummaryModal();
    if (this.resetBtn) this.resetBtn.hidden = this.step !== 'playing';
    // The modal (renderSummaryModal()) is the whole finish screen — an
    // emptied-but-still-styled .cpa-stage would otherwise leave a blank
    // panel-shaped box sitting behind it.
    stage.hidden = this.step === 'summary';

    if (this.step === 'settings') {
      stage.innerHTML = `
        <p class="cpa-instruction">Listen to each chord, then play it back on your handpan — beats 1, 2, 3 of each round.</p>
        <label class="cpa-field">
          Number of rounds
          <div class="cpa-round-stepper">
            <button class="cpa-round-step-btn" type="button" data-step="-1" aria-label="Fewer rounds">−</button>
            <input type="number" id="cpaRoundCount" min="${MIN_ROUNDS}" max="${MAX_ROUNDS}" value="${this.roundCount}" inputmode="numeric">
            <button class="cpa-round-step-btn" type="button" data-step="1" aria-label="More rounds">+</button>
          </div>
          <span class="cpa-field-hint">${CHORDS_PER_ROUND} chords per round</span>
        </label>
        <div class="cpa-settings-toggle-row">
          <button class="cpa-chords-toggle-btn" type="button">🎛️ Chords</button>
          <button class="cpa-chords-toggle-btn" type="button" data-action="progress">📊 My Progress</button>
        </div>
        <div class="cpa-chords-panel" hidden></div>
        <div class="cpa-cta-row"><button class="cpa-cta-btn cpa-cta-primary" type="button" data-action="play">▶ Start</button></div>
      `;
      const roundInput = stage.querySelector('#cpaRoundCount');
      const clampRounds = (n) => Math.max(MIN_ROUNDS, Math.min(MAX_ROUNDS, n));
      roundInput.addEventListener('change', (e) => {
        this.roundCount = clampRounds(parseInt(e.target.value, 10) || DEFAULT_ROUND_COUNT);
        roundInput.value = this.roundCount;
      });
      stage.querySelectorAll('.cpa-round-step-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          this.roundCount = clampRounds(this.roundCount + parseInt(btn.dataset.step, 10));
          roundInput.value = this.roundCount;
        });
      });
      stage.querySelector('.cpa-chords-toggle-btn').addEventListener('click', () => {
        const panel = stage.querySelector('.cpa-chords-panel');
        panel.hidden = !panel.hidden;
        if (!panel.hidden) this.renderChordsPanel();
      });
      stage.querySelector('[data-action="progress"]').addEventListener('click', () => this.openProgressModal());
      stage.querySelector('[data-action="play"]').addEventListener('click', () => this.startExercise());
      return;
    }

    if (this.step === 'playing') {
      const chord = this.sequence[this.chordIndex];
      const chordLabel = chord ? (chord.inversion ? `${chord.name} (${getInversionLabel(chord.inversion)})` : chord.name) : '…';
      const roundNum = (this.chordRoundIndex[this.chordIndex] ?? 0) + 1;
      const posInRound = (this.chordPositionInRound[this.chordIndex] ?? 0) + 1;
      const roundSize = this.roundSizes[roundNum - 1] ?? CHORDS_PER_ROUND;
      stage.innerHTML = `
        <p class="cpa-round-count">Round ${roundNum} of ${this.roundSizes.length} — Chord ${posInRound} of ${roundSize}</p>
        <h2 class="cpa-chord-name cpa-chord-name-reveal">${chordLabel}</h2>
        <p class="cpa-instruction">Listen, then play it back on beats 1, 2, 3.</p>
      `;
      return;
    }

    if (this.step === 'summary') {
      // A modal, not inline stage content — the finish screen should pop
      // over the darkened game board rather than just swap into the same
      // panel the chord name was sitting in.
      stage.innerHTML = '';
      this.renderSummaryModal();
      return;
    }
  }

  // Two pages: this phrase's results, then the same My Progress dashboard
  // openProgressModal() shows standalone — swipeable (plain CSS scroll-snap,
  // same technique as the Method rhythm carousel, js/method.js/css/method.css)
  // plus explicit arrow buttons for anyone not on a touchscreen. Page 2's
  // data loads lazily, only once the player actually swipes/clicks to it.
  renderSummaryModal() {
    this.closeSummaryModal();
    const { noteAccuracy, timingAccuracy, overallScore } = this.overallStats();
    const breakdownRows = this.chordBreakdown().map((row) => `
      <div class="cpa-breakdown-row">
        <div class="cpa-breakdown-main">
          <span class="cpa-breakdown-name">${row.label}</span>
          <span class="cpa-breakdown-notes">${row.notesLabel}</span>
        </div>
        <div class="cpa-breakdown-counts">
          <span class="cpa-breakdown-count cpa-breakdown-correct">✓ ${row.correct}</span>
          <span class="cpa-breakdown-count cpa-breakdown-incorrect">✗ ${row.incorrect}</span>
        </div>
      </div>
    `).join('');
    const backdrop = document.createElement('div');
    backdrop.className = 'cpa-modal-backdrop';
    backdrop.innerHTML = `
      <div class="cpa-modal-card">
        <div class="cpa-carousel-viewport">
          <div class="cpa-carousel-track">
            <section class="cpa-carousel-page">
              <h2 class="cpa-chord-name">Nice work! 🎉</h2>
              <div class="cpa-score-row">
                <div><strong>${overallScore}%</strong><span>Overall</span></div>
                <div><strong>${noteAccuracy}%</strong><span>Notes</span></div>
                <div><strong>${timingAccuracy}%</strong><span>Timing</span></div>
              </div>
              <div class="cpa-breakdown-list">${breakdownRows}</div>
            </section>
            <section class="cpa-carousel-page">
              <h2 class="cpa-chord-name">My Progress</h2>
              <div class="cpa-progress-body"></div>
            </section>
          </div>
          <button class="cpa-carousel-arrow cpa-carousel-arrow-right" type="button" aria-label="See your progress">›</button>
          <button class="cpa-carousel-arrow cpa-carousel-arrow-left" type="button" aria-label="Back to results" hidden>‹</button>
        </div>
        <div class="cpa-carousel-dots">
          <button class="cpa-carousel-dot active" type="button" data-page="0" aria-label="Results"></button>
          <button class="cpa-carousel-dot" type="button" data-page="1" aria-label="Progress"></button>
        </div>
        <div class="cpa-cta-row">
          <button class="cpa-cta-btn cpa-cta-secondary" type="button" data-action="again">Play Again</button>
          <button class="cpa-cta-btn cpa-cta-primary" type="button" data-action="done">Done</button>
        </div>
      </div>
    `;

    // .cpa-carousel-viewport is a non-scrolling positioning context for the
    // arrows (absolutely positioned, overlaid on top); .cpa-carousel-track
    // is the actual scroll-snap container underneath them.
    const track = backdrop.querySelector('.cpa-carousel-track');
    const dots = backdrop.querySelectorAll('.cpa-carousel-dot');
    const arrowLeft = backdrop.querySelector('.cpa-carousel-arrow-left');
    const arrowRight = backdrop.querySelector('.cpa-carousel-arrow-right');
    let progressLoaded = false;
    // Dot/arrow state updates on its own — a click already knows exactly
    // which page it's headed to, so it shouldn't wait out the ~300ms
    // smooth-scroll just to flip visibility at the end (that's what read
    // as janky: the outgoing arrow sitting there through the whole
    // animation, then both arrows swapping in one abrupt step at the end).
    // A touch swipe has no such click to key off, so the scroll-settle
    // listener below still drives this for that case — updatePageUI() is
    // idempotent either way.
    const updatePageUI = (index) => {
      dots.forEach((d, i) => d.classList.toggle('active', i === index));
      arrowLeft.hidden = index === 0;
      arrowRight.hidden = index === dots.length - 1;
      if (index === 1 && !progressLoaded) {
        progressLoaded = true;
        this.loadProgressInto(backdrop.querySelector('.cpa-progress-body'));
      }
    };
    const goToPage = (index) => {
      updatePageUI(index);
      track.scrollTo({ left: track.clientWidth * index, behavior: 'smooth' });
    };
    arrowRight.addEventListener('click', () => goToPage(1));
    arrowLeft.addEventListener('click', () => goToPage(0));
    dots.forEach((dot) => dot.addEventListener('click', () => goToPage(parseInt(dot.dataset.page, 10))));
    let scrollSettleTimer;
    track.addEventListener('scroll', () => {
      clearTimeout(scrollSettleTimer);
      scrollSettleTimer = setTimeout(() => {
        updatePageUI(Math.round(track.scrollLeft / track.clientWidth));
      }, 120);
    });

    backdrop.querySelector('[data-action="again"]').addEventListener('click', () => {
      this.closeSummaryModal();
      // Wipes the last phrase's coach-correct/-timing/-wrong highlighting
      // (and its full round count of measures) back to the same blank
      // placeholder grid the settings screen started with.
      this.setupFreshPhrase();
      this.step = 'settings';
      this.renderStage();
      // Settings fields are back at the top of the view; the player was
      // last scrolled down at the handpan/grid from the finished round.
      this.view.closest('.route-view')?.scrollTo({ top: 0, behavior: 'smooth' });
    });
    // Same exit path as the "Back to Games" button — resets to the games
    // hub, the same display the player saw before picking this game.
    backdrop.querySelector('[data-action="done"]').addEventListener('click', () => {
      this.closeSummaryModal();
      this.teardown();
      this.onBack?.();
    });
    document.body.appendChild(backdrop);
    this.modalEl = backdrop;
  }

  closeSummaryModal() {
    this.modalEl?.remove();
    this.modalEl = null;
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

        <div class="cpa-stage"></div>

        <div class="cpa-board">
          <div class="cpa-handpan-slot"></div>
        </div>

        <div class="cpa-grid-slot"></div>
        <div class="cpa-transport-row">
          <button class="cpa-reset-btn" type="button" hidden>↺ Reset</button>
          <div class="cpa-transport-slot"></div>
        </div>
      </div>
    `;

    this.stageEl = view.querySelector('.cpa-stage');
    this.resetBtn = view.querySelector('.cpa-reset-btn');
    this.resetBtn.addEventListener('click', () => this.resetExercise());

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
