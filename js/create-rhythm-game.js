// Create Your Own Rhythm — Rhythm domain game. Clap an 8-beat rhythm against
// a metronome, play it on your own handpan, then optionally harmonize it
// with the Chord Wheel game. Operates on the REAL Studio grid (gridA) via
// the same relocate/restore portal pattern js/chord-wheel-game.js already
// uses for the virtual handpan — "Send to Studio" is just unmounting and
// navigating, since gridA already IS the phrase being built.
import { gridA } from './grid-context.js';
import { clearGrid, setInnerLabel, renderAllMeasures } from './notegrid.js';
import { setBeats, setSubdivision, start, stop, addTickObserver, removeTickObserver, intervalMs } from './noteplayer.js';
import { TransportRegistry } from './transport-ui.js';
import { duplicateSelection } from './measure-actions.js';
import { setRange, clearRange } from './range-selection.js';
import { labelNotation, setLabelNotation, setIsListening, setTapToDingMode } from './state.js';
import { saveCurrentPatternAs } from './controls.js';
import { dbListPatternNames } from './pattern-crud.js';
import { navigate } from './router.js';
import { showToast } from './toast.js';
import { startClapListening, stopClapListening } from './clap-detector.js';

const BEATS = 8;
const SUBDIVISION = 1; // quarter notes — "123" numeric notation, not "1&2&"
const BPM = 90;

const PROGRESS_STEPS = [
  { label: 'Clap', matches: ['intro', 'counting-in', 'listening'] },
  { label: 'Review', matches: ['review'] },
  { label: 'Play', matches: ['play-on-handpan'] },
  { label: 'Chords', matches: ['choose'] },
  { label: 'Done', matches: ['celebrate'] },
];

// Moves a fixed, app-singleton DOM element (by id) into a slot and back —
// same relocate/restore shape js/chord-wheel-game.js uses for #handpanWrap.
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

class CreateRhythmGame {
  constructor(view, { onBack } = {}) {
    this.view = view;
    this.onBack = onBack;
    this.step = 'intro';
    this.tornDown = false;
    this.tickObserver = null;
    this.contentWatcherId = null;
    this.hasContent = false;

    this.gridMount = createRelocatableMount('measures');
    this.transportMount = createRelocatableMount('mainTransport-A');

    this.onRouteChanged = this.onRouteChanged.bind(this);

    this.setupFreshPhrase();
    this.render();
  }

  setupFreshPhrase() {
    // labelNotation is a global display preference, not phrase data — stash
    // and restore it on teardown. beats/subdivision/bpm, by contrast, ARE
    // the phrase being built, so they're left as-is when the game ends.
    this.prevLabelNotation = labelNotation;
    setLabelNotation('numeric');
    window.dispatchEvent(new CustomEvent('labelNotationChanged', { detail: 'numeric' }));

    // A plain tap on a beat writes Ding directly (same shortcut as a
    // Caps-Lock click in the Studio grid) — this game is all about quickly
    // building a rhythm of Ding strikes by hand, with or without clapping.
    setTapToDingMode(true);

    clearGrid(gridA);
    setBeats(BEATS, gridA);
    setSubdivision(SUBDIVISION, gridA);
    gridA.setMeasures(1);
    gridA.setBpm(BPM);
    renderAllMeasures(gridA);
  }

  teardown() {
    if (this.tornDown) return;
    this.tornDown = true;

    this.stopActiveListening();
    this.stopContentWatcher();
    setTapToDingMode(false);

    setLabelNotation(this.prevLabelNotation || 'musical');
    window.dispatchEvent(new CustomEvent('labelNotationChanged', { detail: this.prevLabelNotation }));

    this.gridMount.unmount();
    this.transportMount.unmount();
    window.removeEventListener('routeChanged', this.onRouteChanged);
  }

  // Catches every way of leaving besides the Back button (which stays on
  // the #games route) — same pattern as js/chord-wheel-game.js.
  onRouteChanged({ detail }) {
    if (detail.route !== 'games') this.teardown();
  }

  // Stops whatever's currently running (count-in/metronome, mic, tick
  // observer) without changing `this.step` — shared by the automatic
  // end-of-measure path and the user clicking Continue early.
  stopActiveListening() {
    if (this.tickObserver) {
      removeTickObserver(this.tickObserver);
      this.tickObserver = null;
    }
    stopClapListening();
    if (gridA.playing) {
      stop(gridA);
      TransportRegistry.updateAll(gridA);
    }
    setIsListening(false);
    gridA.countdownSteps = undefined;
  }

  // The grid is a real, always-interactive Studio grid — the user can tap
  // Ding/Tak/Slap onto it by hand at any point before Review, instead of
  // (or alongside) clapping. This polls for "is there at least one note
  // yet" so a Continue button can appear as soon as that's true, without
  // needing to hook every possible manual-edit code path individually.
  startContentWatcher() {
    this.stopContentWatcher();
    this.contentWatcherId = setInterval(() => {
      const hasContent = gridA.innerLabels.some(l => !!l);
      if (hasContent !== this.hasContent) {
        this.hasContent = hasContent;
        this.renderStage();
      }
    }, 300);
  }

  stopContentWatcher() {
    if (this.contentWatcherId) {
      clearInterval(this.contentWatcherId);
      this.contentWatcherId = null;
    }
  }

  // --- Clap capture: count-in -> listening -> review ---

  async beginCountIn() {
    this.step = 'counting-in';
    this.renderStage();

    setIsListening(true);
    gridA.countdownSteps = BEATS; // one full measure of count-in, not noteplayer's default of 4

    const totalSteps = gridA.beats * gridA.subdivision;
    let ticks = 0;
    // Tick observers only fire once the count-in is over (noteplayer.js's
    // tick() returns early while c.step < 0) — so the very first call here
    // IS "the real measure just started," no separate polling needed.
    this.tickObserver = (ctx) => {
      if (ctx.id !== 'A') return;
      if (this.step === 'counting-in') this.beginListening();
      if (this.step !== 'listening') return;
      ticks++;
      if (ticks >= totalSteps) this.endListening();
    };
    addTickObserver(this.tickObserver);
    await start(gridA); // await so gridA.audioStartTime (below) is actually set

    // Open the mic right away rather than waiting for listening to begin —
    // the count-in plays nothing but metronome clicks, so it doubles as a
    // calibration window the detector uses to learn how loud the click
    // sounds through this mic, and tell it apart from a real clap.
    //
    // Calibration must end exactly when the real listening measure begins
    // (gridA.audioStartTime, the precise Web-Audio-clock time step 0
    // fires) — NOT a fixed wall-clock duration from whenever getUserMedia
    // happens to resolve. getUserMedia's latency is unpredictable (tens to
    // hundreds of ms, more on a cold permission prompt), and the count-in's
    // audio clicks are scheduled against the audio clock regardless of how
    // long mic setup takes — so a wall-clock timer reliably drifted late
    // enough to still be "calibrating" into the first beat(s) of real
    // listening, silently swallowing claps right on beat 1.
    const ok = await startClapListening(
      (timestampMs) => this.onClapDetected(timestampMs),
      { calibrateUntilAudioTime: gridA.audioStartTime }
    );
    if (!ok && this.step !== 'review') {
      this.stopActiveListening();
      this.step = 'intro';
      this.renderStage();
      showToast('Microphone access is needed to clap your rhythm.', { type: 'error' });
    }
  }

  beginListening() {
    this.step = 'listening';
    this.renderStage();
  }

  onClapDetected(timestampMs) {
    if (this.step !== 'listening') return;
    const msPerStep = intervalMs(gridA);
    const audioStartMs = (gridA.audioStartTime || 0) * 1000;
    const totalSteps = gridA.beats * gridA.subdivision;

    let best = 0, bestErr = Infinity;
    for (let i = 0; i < totalSteps; i++) {
      const err = Math.abs(timestampMs - (audioStartMs + i * msPerStep));
      if (err < bestErr) { bestErr = err; best = i; }
    }
    setInnerLabel(best, 'Ding', gridA);
  }

  endListening() {
    this.stopActiveListening();
    this.stopContentWatcher(); // Continue's job is done — we're past intro/listening now
    this.step = 'review';
    this.renderStage();
  }

  // User-initiated early exit from intro/counting-in/listening, available
  // as soon as there's at least one note on the grid — manual taps don't
  // need to wait out a full measure of mic listening to move on.
  goToReview() {
    this.endListening();
  }

  resetRhythm() {
    clearGrid(gridA);
    this.hasContent = false;
    this.startContentWatcher();
    this.step = 'intro';
    this.renderStage();
  }

  // --- Add Chords hand-off ---

  async addChords() {
    // Duplicate measure 0 three more times, so there are 4 identical 8-beat
    // measures — one per chord the Chord Wheel hand-off will fill in.
    setRange(0, gridA.stepsPerMeasure - 1, gridA);
    for (let i = 0; i < 3; i++) await duplicateSelection(gridA);
    clearRange(gridA);

    await this.saveAsMyRhythm();

    this.teardown();
    const { renderChordWheelGame } = await import('./chord-wheel-game.js');
    renderChordWheelGame(this.view, { onBack: this.onBack, rhythmHandoff: true });
  }

  async finishWithoutChords() {
    await this.saveAsMyRhythm();
    showToast('Great job! You composed your own rhythm 🎉', { type: 'success', duration: 4000 });
    this.teardown();
    navigate('studio');
  }

  async saveAsMyRhythm() {
    const existing = new Set(await dbListPatternNames());
    let name = 'My Rhythm';
    let n = 2;
    while (existing.has(name)) name = `My Rhythm ${n++}`;
    await saveCurrentPatternAs(name);
  }

  // --- Rendering ---

  renderProgressHtml() {
    const currentIdx = PROGRESS_STEPS.findIndex(p => p.matches.includes(this.step));
    return `
      <div class="rg-progress">
        ${PROGRESS_STEPS.map((p, i) => `
          <div class="rg-progress-step${i === currentIdx ? ' rg-progress-current' : ''}${i < currentIdx ? ' rg-progress-done' : ''}">
            <span class="rg-progress-dot"></span>
            <span class="rg-progress-label">${p.label}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  renderStage() {
    if (this.progressEl) {
      this.progressEl.outerHTML = this.renderProgressHtml();
      this.progressEl = this.view.querySelector('.rg-progress');
    }

    const stage = this.stageEl;
    if (!stage) return;

    switch (this.step) {
      case 'intro':
        stage.innerHTML = `
          <p class="rg-instruction">Tap Start to turn on the metronome and clap your rhythm — or directly tap the beats you want to accentuate to build it by hand.</p>
          <div class="rg-cta-row">
            <button class="rg-cta-btn rg-cta-primary" type="button" data-action="start">🥁 Start</button>
            ${this.hasContent ? '<button class="rg-cta-btn rg-cta-secondary" type="button" data-action="continue">Continue →</button>' : ''}
          </div>
        `;
        stage.querySelector('[data-action="start"]').addEventListener('click', () => this.beginCountIn());
        stage.querySelector('[data-action="continue"]')?.addEventListener('click', () => this.goToReview());
        break;

      case 'counting-in':
        stage.innerHTML = `
          <p class="rg-instruction">Get ready… listen to the count-in and feel the tempo.</p>
          ${this.hasContent ? '<div class="rg-cta-row"><button class="rg-cta-btn rg-cta-secondary" type="button" data-action="continue">Continue →</button></div>' : ''}
        `;
        stage.querySelector('[data-action="continue"]')?.addEventListener('click', () => this.goToReview());
        break;

      case 'listening':
        stage.innerHTML = `
          <p class="rg-instruction rg-listening">🎤 Listening — clap your rhythm now!</p>
          ${this.hasContent ? '<div class="rg-cta-row"><button class="rg-cta-btn rg-cta-secondary" type="button" data-action="continue">Continue →</button></div>' : ''}
        `;
        stage.querySelector('[data-action="continue"]')?.addEventListener('click', () => this.goToReview());
        break;

      case 'review':
        stage.innerHTML = `
          <p class="rg-instruction">Press ▶ in the transport bar below to hear your rhythm. Not happy with it? Reset and try again.</p>
          <div class="rg-cta-row">
            <button class="rg-cta-btn rg-cta-secondary" type="button" data-action="reset">↺ Reset</button>
            <button class="rg-cta-btn rg-cta-primary" type="button" data-action="continue">Continue →</button>
          </div>
        `;
        stage.querySelector('[data-action="reset"]').addEventListener('click', () => this.resetRhythm());
        stage.querySelector('[data-action="continue"]').addEventListener('click', () => {
          this.step = 'play-on-handpan';
          this.renderStage();
        });
        break;

      case 'play-on-handpan':
        stage.innerHTML = `
          <p class="rg-instruction">Now play your rhythm on your own handpan. The <strong class="rg-hand-r">red, odd-numbered beats</strong> are your right hand; the <strong class="rg-hand-l">blue, even-numbered beats</strong> are your left hand.</p>
          <div class="rg-cta-row"><button class="rg-cta-btn rg-cta-primary" type="button">Continue →</button></div>
        `;
        stage.querySelector('.rg-cta-primary').addEventListener('click', () => {
          this.step = 'choose';
          this.renderStage();
        });
        break;

      case 'choose':
        stage.innerHTML = `
          <p class="rg-instruction">Happy with your rhythm?</p>
          <div class="rg-cta-row">
            <button class="rg-cta-btn rg-cta-secondary" type="button" data-action="done">Done!</button>
            <button class="rg-cta-btn rg-cta-primary" type="button" data-action="chords">Add Chords →</button>
          </div>
        `;
        stage.querySelector('[data-action="done"]').addEventListener('click', () => this.finishWithoutChords());
        stage.querySelector('[data-action="chords"]').addEventListener('click', () => this.addChords());
        break;
    }
  }

  render() {
    const view = this.view;
    view.innerHTML = `
      <div class="hg-container rg-container">
        <button class="hg-back" type="button">← Back to Games</button>
        <header class="hg-header">
          <p class="hg-eyebrow">Rhythm · Create Your Own Rhythm</p>
          <h1 class="hg-title">Create Your Own Rhythm</h1>
          <p class="hg-subtitle">Clap an 8-beat rhythm, play it on your handpan, and harmonize it if you like.</p>
        </header>

        ${this.renderProgressHtml()}

        <div class="rg-stage"></div>

        <div class="rg-grid-slot"></div>
        <div class="rg-transport-slot"></div>
      </div>
    `;

    this.progressEl = view.querySelector('.rg-progress');
    this.stageEl = view.querySelector('.rg-stage');

    this.gridMount.mount(view.querySelector('.rg-grid-slot'));
    this.transportMount.mount(view.querySelector('.rg-transport-slot'));

    view.querySelector('.hg-back').addEventListener('click', () => {
      this.teardown();
      this.onBack?.();
    });
    window.addEventListener('routeChanged', this.onRouteChanged);

    this.startContentWatcher();
    this.renderStage();
  }
}

export function renderCreateRhythmGame(view, options) {
  return new CreateRhythmGame(view, options);
}
