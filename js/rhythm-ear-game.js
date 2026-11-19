// Rhythm by Ear — Rhythm domain game. A hidden phrase (Dings plus Tak/Slap
// accents, a named rhythm whenever one fits the level) plays; the player
// rebuilds it on the real Studio grid, relocated the same way
// js/create-rhythm-game.js does. A "run" is whatever is being played: a
// level, a Rhythm Library set, or one library rhythm.
import { gridA } from './grid-context.js';
import { clearGrid, setInnerLabel, renderAllMeasures } from './notegrid.js';
import { setBeats, setSubdivision, stop, unlockAudio, getAudioCtx, metroClick, playNoteByLabel, intervalMs } from './noteplayer.js';
import { TransportRegistry } from './transport-ui.js';
import { labelNotation, setLabelNotation, setTapCycle } from './state.js';
import { releaseOpenPhrase } from './controls.js';
import { BASE_PATH } from './config.js';
import {
  BEATS_PER_MEASURE, CATEGORIES, HINT_PENALTY, LIBRARY_SETS, NAMED_RHYTHMS, ROUND_MAX,
  distinctRhythmCount, fittingRhythms, generatePhrase, levelRules, libraryPhrase,
  libraryRhythms, rhythmKey, roundScore, verdict,
} from './rhythm-ear-levels.js';

const BPM = 120;
const TEMPO_STEP = 5;
const TEMPO_MIN = 40;
const TEMPO_MAX = 240;
const LIBRARY_BPM = 160; // library rhythms at a more natural tempo
const ROUNDS_PER_LEVEL = 4;
const COUNT_IN = 4;
const BEST_KEY = 'rhythmEarBestScore';
const CLICK_KEY = 'rhythmEarClick';
// Notes are handed to Web Audio only this far ahead, so stopping playback
// silences everything after the next ~0.1s.
const LOOKAHEAD_SEC = 0.1;
const SCHEDULER_MS = 25;

// public/assets/audio/success.mp3, decoded once and reused.
let successBuffer = null;
let successLoading = null;

function loadSuccessSound() {
  const audioCtx = getAudioCtx();
  if (!audioCtx) return Promise.resolve(null);
  successLoading ??= fetch(`${BASE_PATH}assets/audio/success.mp3`)
    .then(res => res.arrayBuffer())
    .then(data => audioCtx.decodeAudioData(data))
    .then(buffer => { successBuffer = buffer; return buffer; })
    .catch(err => {
      successLoading = null; // retry next time
      console.warn('[rhythm-ear] Could not load success sound', err);
      return null;
    });
  return successLoading;
}

async function playSuccessChime() {
  await unlockAudio();
  const audioCtx = getAudioCtx();
  const buffer = successBuffer || await loadSuccessSound();
  if (!audioCtx || !buffer) return;
  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  src.connect(audioCtx.destination);
  src.start();
}

function describeResult(result) {
  if (result.revealed) return 'answer shown';
  const tries = result.tries === 1 ? '1 try' : `${result.tries} tries`;
  return `${tries} · ${Math.round(result.seconds)}s${result.hint ? ' · hint used' : ''}`;
}

function normalize(label) {
  return label === '0' ? 'Ding' : (label || '');
}

// Levels with fewer distinct rhythms than ROUNDS_PER_LEVEL get fewer rounds,
// since no rhythm repeats within a level.
function roundsFor(category, level) {
  return distinctRhythmCount(category, level, ROUNDS_PER_LEVEL);
}

function bestKey(catIndex, levelIndex) {
  return `${CATEGORIES[catIndex].id}:${levelIndex}`;
}

function levelLabel(catIndex, levelIndex) {
  return `${CATEGORIES[catIndex].name} · Level ${levelIndex + 1}`;
}

function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function levelRun(c, i) {
  const cat = CATEGORIES[c];
  const level = cat.levels[i];
  const usedKeys = new Set();
  const usedNames = new Set();
  const rounds = roundsFor(cat, level);
  const nextRef = i < cat.levels.length - 1 ? [c, i + 1] : (c < CATEGORIES.length - 1 ? [c + 1, 0] : null);
  return {
    kind: 'level',
    catIndex: c,
    levelIndex: i,
    heading: cat.name,
    title: `Level ${i + 1}`,
    label: levelLabel(c, i),
    measures: cat.measures,
    rounds,
    bestKey: bestKey(c, i),
    replayText: '↺ Replay level',
    // No rhythm repeats within a level (see generatePhrase); rounds is capped
    // at the distinct rhythms available, so this never returns null.
    phrase: () => {
      const p = generatePhrase(cat, level, { usedKeys, usedNames });
      usedKeys.add(rhythmKey(p.labels));
      if (p.name) usedNames.add(p.name);
      return p;
    },
    replay: () => levelRun(c, i),
    next: nextRef && (() => levelRun(...nextRef)),
    nextLabel: nextRef && (nextRef[0] === c ? `Level ${nextRef[1] + 1}` : levelLabel(...nextRef)),
  };
}

// Every rhythm in a library set once, shuffled; names stay hidden until solved.
function setRun(s) {
  const set = LIBRARY_SETS[s];
  const order = shuffled(libraryRhythms(set));
  const nextIndex = s < LIBRARY_SETS.length - 1 ? s + 1 : null;
  return {
    kind: 'set',
    setIndex: s,
    heading: 'Rhythm Library',
    title: set.name,
    label: `Rhythm Library · ${set.name}`,
    measures: set.measures,
    rounds: order.length,
    bestKey: `library-set:${set.id}`,
    bpm: LIBRARY_BPM,
    replayText: '↺ Replay set',
    phrase: (round) => libraryPhrase(order[round]),
    replay: () => setRun(s),
    next: nextIndex != null && (() => setRun(nextIndex)),
    nextLabel: nextIndex != null && LIBRARY_SETS[nextIndex].name,
  };
}

// One library rhythm, learned on purpose: its name is shown from the start.
function singleRun(name) {
  const index = NAMED_RHYTHMS.findIndex(r => r.name === name);
  const rhythm = NAMED_RHYTHMS[index];
  const nextRhythm = NAMED_RHYTHMS[index + 1];
  return {
    kind: 'single',
    rhythmName: name,
    heading: 'Rhythm Library',
    title: name,
    label: `Rhythm Library · ${name}`,
    measures: rhythm.steps / BEATS_PER_MEASURE,
    rounds: 1,
    bestKey: `library-rhythm:${name}`,
    bpm: LIBRARY_BPM,
    replayText: '↺ Practise again',
    nameUpfront: true,
    phrase: () => libraryPhrase(rhythm),
    replay: () => singleRun(name),
    next: nextRhythm && (() => singleRun(nextRhythm.name)),
    nextLabel: nextRhythm && `Learn the ${nextRhythm.name}`,
  };
}

// Mini Ding/Tak/Slap pattern for a library card, one row per measure.
function patternHtml(labels) {
  const rows = [];
  for (let m = 0; m < labels.length / BEATS_PER_MEASURE; m++) {
    const cells = labels.slice(m * BEATS_PER_MEASURE, (m + 1) * BEATS_PER_MEASURE).map(l => {
      const kind = l === 'Ding' ? 'd' : (l === 'T' ? 't' : (l === 'S' ? 's' : ''));
      return `<span class="re-pattern-cell" data-kind="${kind}">${kind ? kind.toUpperCase() : ''}</span>`;
    }).join('');
    rows.push(`<span class="re-pattern-row">${cells}</span>`);
  }
  return `<span class="re-pattern" aria-hidden="true">${rows.join('')}</span>`;
}

function readStore(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

function writeStore(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}

function createRelocatableMount(elementId) {
  let origParent = null;
  let origNextSibling = null;
  return {
    mount(slotEl) {
      const el = document.getElementById(elementId);
      if (!el || !slotEl || slotEl.contains(el)) return;
      origParent = el.parentNode;
      origNextSibling = el.nextSibling;
      slotEl.appendChild(el);
    },
    unmount() {
      const el = document.getElementById(elementId);
      if (el && origParent) origParent.insertBefore(el, origNextSibling);
      origParent = null;
      origNextSibling = null;
    },
  };
}

class RhythmEarGame {
  constructor(view, { onBack } = {}) {
    this.view = view;
    this.onBack = onBack;
    this.step = 'answering';
    this.stepBeforeLevels = null;
    this.hintOn = false;
    this.run = null;
    this.pickerTab = 'levels';
    this.previewBtn = null;
    this.previewCard = null;
    this.round = 0;
    this.roundResults = [];
    this.attempts = 0;
    this.target = null;
    this.playingTarget = false;
    this.playingMine = false;
    this.playScheduler = null;
    this.cueTimers = [];
    this.tornDown = false;
    this.clickOn = readStore(CLICK_KEY, true);

    this.gridMount = createRelocatableMount('measures');
    this.onRouteChanged = this.onRouteChanged.bind(this);
    this.onGridTap = this.onGridTap.bind(this);

    this.prevLabelNotation = labelNotation;
    setLabelNotation('numeric');
    window.dispatchEvent(new CustomEvent('labelNotationChanged', { detail: 'numeric' }));
    setTapCycle(['Ding', 'T', 'S']);

    releaseOpenPhrase(); // never write the answer into the open phrase
    clearGrid(gridA);
    setBeats(BEATS_PER_MEASURE, gridA);
    setSubdivision(1, gridA);
    gridA.setMeasures(1);
    gridA.setBpm(BPM);
    renderAllMeasures(gridA);
    TransportRegistry.updateAll(gridA);

    this.render();
  }

  teardown() {
    if (this.tornDown) return;
    this.tornDown = true;
    this.cancelTargetPlayback();
    this.stopTransport();
    this.clearMarks();
    this.restoreTempo();
    setTapCycle(null);
    setLabelNotation(this.prevLabelNotation || 'musical');
    window.dispatchEvent(new CustomEvent('labelNotationChanged', { detail: this.prevLabelNotation }));
    this.gridMount.unmount();
    window.removeEventListener('routeChanged', this.onRouteChanged);
  }

  onRouteChanged({ detail }) {
    if (detail.route !== 'games') this.teardown();
  }

  get roundCount() {
    return this.run.rounds;
  }

  get levelMax() {
    return this.run.rounds * ROUND_MAX;
  }

  get totalScore() {
    return this.roundResults.reduce((sum, r) => sum + (r?.score ?? 0), 0);
  }

  // --- Flow ---

  startRun(run) {
    this.run = run;
    this.applyRunTempo(run);
    this.round = 0;
    this.roundResults = [];
    if (gridA.measures !== run.measures) {
      gridA.setMeasures(run.measures);
      renderAllMeasures(gridA);
    }
    this.startRound();
  }

  // Library runs play at LIBRARY_BPM; the tempo from before goes back once
  // a level starts again or the game closes.
  applyRunTempo(run) {
    if (run.bpm) {
      this.bpmBeforeLibrary ??= gridA.bpm;
      gridA.setBpm(run.bpm);
    } else {
      this.restoreTempo();
    }
    TransportRegistry.updateAll(gridA);
  }

  restoreTempo() {
    if (this.bpmBeforeLibrary == null) return;
    gridA.setBpm(this.bpmBeforeLibrary);
    this.bpmBeforeLibrary = null;
  }

  startRound() {
    this.cancelTargetPlayback();
    this.stopTransport();
    this.clearMarks();
    this.target = this.run.phrase(this.round);
    this.attempts = 0;
    this.hintOn = false;
    this.hintUsed = false;
    this.clockStart = null;
    this.pausedMs = 0;

    clearGrid(gridA);
    setInnerLabel(0, 'Ding', gridA); // beat 1 is a given
    this.step = 'answering';
    this.renderAll();
  }

  check() {
    this.clearMarks();
    let wrong = 0;
    this.target.labels.forEach((label, i) => {
      const ok = normalize(gridA.innerLabels[i]) === label;
      gridA.cells[i]?.classList.add(ok ? 're-right' : 're-wrong');
      if (!ok) wrong++;
    });
    this.attempts++;
    if (wrong === 0) {
      const seconds = this.elapsedSec();
      this.roundResults[this.round] = {
        score: roundScore(this.attempts, seconds, { hint: this.hintUsed }),
        tries: this.attempts,
        seconds,
        hint: this.hintUsed,
      };
      playSuccessChime();
      this.step = 'correct';
      this.renderStatus();
    } else {
      this.wrongCount = wrong;
      this.step = 'wrong';
    }
    this.renderStage();
  }

  reveal() {
    this.clearMarks();
    this.target.labels.forEach((label, i) => setInnerLabel(i, label, gridA));
    this.roundResults[this.round] = { score: 0, revealed: true };
    this.step = 'revealed';
    this.renderStatus();
    this.renderStage();
  }

  nextRound() {
    this.round++;
    if (this.round < this.roundCount) {
      this.startRound();
      return;
    }
    this.cancelTargetPlayback();
    const best = readStore(BEST_KEY, {});
    const key = this.run.bestKey;
    if ((best[key] ?? -1) < this.totalScore) {
      best[key] = this.totalScore;
      writeStore(BEST_KEY, best);
    }
    this.step = 'summary';
    this.renderAll();
  }

  showLevels() {
    this.cancelTargetPlayback();
    this.stopTransport();
    this.stepBeforeLevels = this.step;
    this.pauseStartedAt = performance.now();
    this.pickerTab = this.run.kind === 'level' ? 'levels' : 'library';
    this.step = 'levels';
    this.renderAll();
  }

  resumeLevel() {
    if (this.clockStart != null) this.pausedMs += performance.now() - this.pauseStartedAt;
    this.step = this.stepBeforeLevels || 'answering';
    this.renderAll();
  }

  // Clock runs from the end of the round's first full playback.
  elapsedSec() {
    if (this.clockStart == null) return 0;
    return Math.max(0, (performance.now() - this.clockStart - this.pausedMs) / 1000);
  }

  // −/+ buttons. The Studio transport (not shown here) is kept in sync.
  changeTempo(delta) {
    const bpm = Math.max(TEMPO_MIN, Math.min(TEMPO_MAX, Math.round(gridA.bpm) + delta));
    gridA.setBpm(bpm);
    TransportRegistry.updateAll(gridA);
    const value = this.view.querySelector('.re-tempo-value');
    if (value) value.textContent = bpm;
    this.view.querySelector('[data-action="slower"]')?.toggleAttribute('disabled', bpm <= TEMPO_MIN);
    this.view.querySelector('[data-action="faster"]')?.toggleAttribute('disabled', bpm >= TEMPO_MAX);
  }

  toggleHint() {
    this.hintOn = !this.hintOn;
    if (this.hintOn) this.hintUsed = true; // costs HINT_PENALTY once per round
    if (!this.hintOn && !this.playingMine) this.clearGridHighlights();
    this.renderStage();
    // Nudge toward Listen: the hint only shows while the rhythm plays.
    if (this.hintOn && !this.playingTarget) {
      const listen = this.view.querySelector('[data-action="listen"]');
      listen?.classList.add('re-flash');
      listen?.addEventListener('animationend', () => listen.classList.remove('re-flash'), { once: true });
    }
  }

  // Any edit after Check clears the right/wrong marks and resumes answering.
  onGridTap() {
    if (this.step === 'wrong') {
      this.clearMarks();
      this.step = 'answering';
      this.renderStage();
    }
  }

  clearMarks() {
    (gridA.cells || []).forEach(c => c.classList.remove('re-right', 're-wrong'));
  }

  stopTransport() {
    if (gridA.playing) {
      stop(gridA);
      TransportRegistry.updateAll(gridA);
    }
  }

  // --- Hidden target playback (never written to the grid) ---

  // Brings the grid into view unless some of it is already on screen.
  revealGrid() {
    const grid = this.view.querySelector('.re-grid-slot');
    if (!grid) return;
    const rect = grid.getBoundingClientRect();
    if (rect.bottom > 0 && rect.top < window.innerHeight) return;
    grid.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // Plays labels after the shaker count-in through a lookahead scheduler,
  // so cancelTargetPlayback() silences it within ~0.1s.
  async startPlayback(labels, { bpm, countIn = COUNT_IN, onStart, onDone } = {}) {
    this.cancelTargetPlayback();
    this.stopTransport();
    await unlockAudio();
    const audioCtx = getAudioCtx();
    if (!audioCtx || this.tornDown) return;
    loadSuccessSound(); // ready before the first correct answer

    const beatSec = bpm ? 60 / bpm : intervalMs(gridA) / 1000;
    const t0 = audioCtx.currentTime + 0.1;
    const events = [];
    // Count-in uses the shaker so it never sounds like part of the phrase.
    for (let i = 0; i < countIn; i++) {
      events.push({ at: t0 + i * beatSec, cue: ['count', countIn - i], play: (d) => metroClick('beat', d, 'Shaker') });
    }
    labels.forEach((label, i) => {
      events.push({
        at: t0 + (countIn + i) * beatSec,
        cue: ['beat', i],
        play: (d) => {
          if (this.clickOn) metroClick(i % BEATS_PER_MEASURE === 0 ? 'downbeat' : 'beat', d, 'Click');
          if (label) playNoteByLabel(label, i, d);
        },
      });
    });
    const endAt = t0 + (countIn + labels.length) * beatSec;

    onStart?.();
    let next = 0;
    const tick = () => {
      const now = audioCtx.currentTime;
      while (next < events.length && events[next].at < now + LOOKAHEAD_SEC) {
        const ev = events[next++];
        const delay = Math.max(0, ev.at - now);
        ev.play(delay);
        this.scheduleCue(ev.cue[0], ev.cue[1], delay);
      }
      if (now >= endAt) {
        this.cancelTargetPlayback();
        onDone?.();
      }
    };
    this.playScheduler = setInterval(tick, SCHEDULER_MS);
    tick();
  }

  async playTarget() {
    if (this.playingTarget || !this.target) return;
    this.revealGrid();
    await this.startPlayback(this.target.labels, {
      onStart: () => {
        this.playingTarget = true;
        this.renderStage();
      },
      onDone: () => {
        // The score clock starts once the rhythm has been heard in full.
        if (this.clockStart == null) {
          this.clockStart = performance.now();
          this.pausedMs = 0;
        }
        this.renderStage();
      },
    });
  }

  // ▶ Play mine: the player's grid straight away (no count-in), each cell
  // lighting as it plays.
  async playMine() {
    if (this.playingMine) {
      this.cancelTargetPlayback();
      this.renderStage();
      return;
    }
    this.revealGrid();
    const labels = Array.from({ length: this.target.labels.length }, (_, i) => normalize(gridA.innerLabels[i]));
    await this.startPlayback(labels, {
      countIn: 0,
      onStart: () => {
        this.playingMine = true;
        this.renderStage();
      },
      onDone: () => this.renderStage(),
    });
  }

  // 🔊 on a Rhythm Library card.
  previewRhythm(name, btn) {
    const wasThis = this.previewBtn === btn;
    this.cancelTargetPlayback();
    if (wasThis) return; // second tap stops it
    const rhythm = NAMED_RHYTHMS.find(r => r.name === name);
    this.startPlayback(libraryPhrase(rhythm).labels, {
      bpm: LIBRARY_BPM,
      onStart: () => {
        this.previewBtn = btn;
        this.previewCard = btn.closest('.re-rhythm-card');
        btn.classList.add('re-previewing');
        btn.textContent = '■ Stop';
      },
    });
  }

  // Beats that light up as the phrase plays: a library card's pattern while
  // previewing, otherwise the Hint dots (only present with Hint on).
  beatHighlights(root) {
    if (this.previewCard) return root.querySelectorAll('.re-pattern-cell');
    if (this.playingMine || (this.playingTarget && this.hintOn)) return gridA.cells;
    return [];
  }

  clearGridHighlights() {
    Array.from(gridA.cells).forEach(c => c.classList.remove('re-beat-on'));
  }

  // The cue line always shows count-in vs rhythm.
  scheduleCue(kind, value, delaySec) {
    this.cueTimers.push(setTimeout(() => {
      const root = this.previewCard ?? this.view;
      const cue = root.querySelector('.re-cue');
      if (cue) {
        cue.dataset.phase = kind;
        cue.innerHTML = kind === 'count'
          ? `Count-in <strong>${value}</strong> <br/><span class="re-cue-note">not part of the rhythm</span>`
          : (this.playingMine ? '▶ Playing your version' : '🎵 Rhythm playing');
      }
      const beats = this.beatHighlights(root);
      beats.forEach(d => d.classList.remove('re-beat-on'));
      if (kind === 'beat') beats[value]?.classList.add('re-beat-on');
    }, delaySec * 1000));
  }

  cancelTargetPlayback() {
    clearInterval(this.playScheduler);
    this.playScheduler = null;
    this.cueTimers.forEach(clearTimeout);
    this.cueTimers = [];
    this.playingTarget = false;
    this.clearGridHighlights();
    this.playingMine = false;
    if (this.previewBtn) {
      this.previewBtn.classList.remove('re-previewing');
      this.previewBtn.textContent = '🔊 Hear it';
      this.previewBtn = null;
    }
    if (this.previewCard) {
      this.beatHighlights(this.previewCard).forEach(d => d.classList.remove('re-beat-on'));
      const cue = this.previewCard.querySelector('.re-cue');
      cue.dataset.phase = 'idle';
      cue.textContent = '';
      this.previewCard = null;
    }
  }

  // --- Rendering ---

  renderLevelsHtml() {
    const best = readStore(BEST_KEY, {});
    const sections = CATEGORIES.map((cat, c) => {
      const cards = cat.levels.map((level, i) => {
        const score = best[bestKey(c, i)];
        const rounds = roundsFor(cat, level);
        const named = fittingRhythms(cat, level).map(r => r.name);
        const current = this.run?.kind === 'level' && c === this.run.catIndex && i === this.run.levelIndex;
        return `
          <button class="re-level-card${current ? ' re-level-current' : ''}" type="button" data-cat="${c}" data-level="${i}">
            <span class="re-level-topline">
              <span class="re-level-name">Level ${i + 1}</span>
              ${score != null ? `<span class="re-level-best">Best ${score}/${rounds * ROUND_MAX}</span>` : ''}
            </span>
            <ul class="re-level-rules">${levelRules(cat, level).map(r => `<li>${r}</li>`).join('')}</ul>
            ${named.length ? `<span class="re-level-named">🎵 ${named.join(', ')}</span>` : ''}
            <span class="re-level-play">Play →</span>
          </button>
        `;
      }).join('');
      return `
        <section class="re-category" data-category="${cat.id}">
          <h3 class="re-category-name">${cat.name}</h3>
          <p class="re-category-blurb">${cat.blurb}</p>
          <div class="re-level-grid">${cards}</div>
        </section>
      `;
    }).join('');

    return sections;
  }

  renderLibraryHtml() {
    const best = readStore(BEST_KEY, {});
    return `
      <p class="re-library-intro">Every real-world rhythm in the game. Tap 🔊 to hear one, <strong>Learn</strong> to practise it with its name showing, or play a whole set as a challenge where the names stay hidden until you solve each one.</p>
      ${LIBRARY_SETS.map((set, s) => {
        const rhythms = libraryRhythms(set);
        const setBest = best[`library-set:${set.id}`];
        const cards = rhythms.map(r => {
          const score = best[`library-rhythm:${r.name}`];
          return `
            <article class="re-rhythm-card" data-rhythm="${r.name}">
              <div class="re-level-topline">
                <h4 class="re-rhythm-card-name">${r.name}</h4>
                ${score != null ? `<span class="re-level-best">Best ${score}/${ROUND_MAX}</span>` : ''}
              </div>
              ${patternHtml(libraryPhrase(r).labels)}
              <div class="re-cue" data-phase="idle"></div>
              <p class="re-rhythm-card-about">${r.about}</p>
              <div class="re-rhythm-card-actions">
                <button class="re-card-btn" type="button" data-action="preview">🔊 Hear it</button>
                <button class="re-card-btn re-card-btn-primary" type="button" data-action="learn">Learn →</button>
              </div>
            </article>`;
        }).join('');
        return `
          <section class="re-category" data-library-set="${set.id}">
            <div class="re-library-set-head">
              <div>
                <h3 class="re-category-name">${set.name}</h3>
                <p class="re-category-blurb">${rhythms.length} rhythms${setBest != null ? ` · Best ${setBest}/${rhythms.length * ROUND_MAX}` : ''}</p>
              </div>
              <button class="re-btn re-btn-primary re-play-set-btn" type="button" data-set="${s}">Play all ${rhythms.length} →</button>
            </div>
            <div class="re-level-grid">${cards}</div>
          </section>`;
      }).join('')}
    `;
  }

  renderPickerHtml() {
    const tab = this.pickerTab;
    return `
      <div class="re-levels-head">
        <div class="re-tabs" role="tablist">
          <button class="re-tab" type="button" role="tab" data-tab="levels" aria-selected="${tab === 'levels'}">Levels</button>
          <button class="re-tab" type="button" role="tab" data-tab="library" aria-selected="${tab === 'library'}">🎵 Rhythm Library</button>
        </div>
        <button class="re-levels-btn" type="button" data-action="resume">← Back to ${this.run.label}</button>
      </div>
      ${tab === 'levels' ? this.renderLevelsHtml() : this.renderLibraryHtml()}
    `;
  }

  renderHeroHtml() {
    const hasPlayed = Object.keys(readStore(BEST_KEY, {})).length > 0;
    return `
      <details class="re-hero" ${hasPlayed ? '' : 'open'}>
        <summary class="re-hero-title">How to play</summary>
        <ol class="re-hero-steps">
          <li><strong>Listen.</strong> First you'll hear a ${COUNT_IN}-count shaker count-in. <em>The count-in is not part of the rhythm.</em> Then the rhythm plays. Replay it as often as you like.</li>
          <li><strong>Build it.</strong> Tap a beat on the grid to cycle <span class="re-chip">Ding</span> → <span class="re-chip">Tak</span> → <span class="re-chip">Slap</span> → empty. Beat 1 is always a Ding.</li>
          <li><strong>Check.</strong> Each level has up to ${ROUNDS_PER_LEVEL} rounds worth ${ROUND_MAX} points each, and no rhythm repeats within a level. Fewer tries and a quicker answer score more; the clock starts when the rhythm finishes playing. Stuck? Tap 💡 Hint to see the grid light up as the rhythm plays; it costs ${HINT_PENALTY} points that round.</li>
          <li><strong>Learn real rhythms.</strong> Whenever a famous rhythm fits the level, like the Tresillo or Son clave, you'll get that, and its name once you've solved it. To study them on purpose, open the 🎵 Rhythm Library from the menu.</li>
        </ol>
      </details>
    `;
  }

  renderStatusHtml() {
    const roundLabel = this.step === 'summary'
      ? 'Complete'
      : `Round ${this.round + 1} of ${this.roundCount}`;
    const chips = Array.from({ length: this.roundCount }, (_, i) => {
      const result = this.roundResults[i];
      const state = result ? 'done' : (i === this.round && this.step !== 'summary' ? 'current' : 'todo');
      return `
        <span class="re-round-chip" data-state="${state}">
          <span class="re-round-chip-label">R${i + 1}</span>
          <span class="re-round-chip-score">${result ? result.score : '–'}</span>
        </span>`;
    }).join('');
    return `
      <div class="re-status">
        <button class="re-levels-btn" type="button">☰ Levels & library</button>
        <div class="re-status-top">
          <div class="re-status-heading">
            <span class="re-status-cat">${this.run.heading}</span>
            <div class="re-status-main">
              <span class="re-status-level">${this.run.title}</span>
              <span class="re-status-round">${roundLabel}</span>
            </div>
          </div>
          <div class="re-total" aria-label="Total score">
            <span class="re-total-value">${this.totalScore}</span>
            <span class="re-total-max">/ ${this.levelMax}</span>
          </div>
        </div>
        <div class="re-round-chips">${chips}</div>
      </div>
    `;
  }

  renderStatus() {
    const statusEl = this.view.querySelector('.re-status-slot');
    if (!statusEl) return;
    statusEl.innerHTML = this.renderStatusHtml();
    statusEl.querySelector('.re-levels-btn').addEventListener('click', () => this.showLevels());
  }

  rhythmNameHtml() {
    if (!this.target?.name) return '';
    return `
      <div class="re-rhythm-name">
        <span class="re-rhythm-label">🎵 ${this.step === 'correct' ? 'You just played the' : 'This rhythm is the'}</span>
        <strong class="re-rhythm-title">${this.target.name}</strong>
        <span class="re-rhythm-about">${this.target.about}</span>
      </div>`;
  }

  // The play panel: top (Listen, cue, tempo), the grid, then bottom
  // (feedback, Play mine, Check, Hint, metronome).
  renderStage() {
    const top = this.view.querySelector('.re-stage-top');
    const stage = this.view.querySelector('.re-stage');
    if (!top || !stage) return;
    const playing = this.playingTarget || this.playingMine;
    const listenBtn = `<button class="re-btn re-btn-wide ${this.attempts === 0 && this.step === 'answering' ? 're-btn-primary' : 're-btn-secondary'}" type="button" data-action="listen" ${this.playingTarget ? 'disabled' : ''}>🔊 ${this.playingTarget ? 'Playing…' : 'Listen'}</button>`;
    // One line above Listen: a short instruction when idle, the count-in /
    // playing cue during playback (same slot, so nothing shifts).
    const idleText = {
      answering: 'Listen to the rhythm, then build it on the grid.',
      wrong: 'Listen again, then fix the beats marked in red.',
      correct: 'Listen again to hear it.',
      revealed: 'Listen again to hear how it lines up.',
    }[this.step] ?? '';
    const cue = `<div class="re-cue" data-phase="${playing ? 'ready' : 'idle'}">${playing ? (this.playingTarget ? 'Get ready…' : '▶ Playing your version') : idleText}</div>`;
    const bpm = Math.round(gridA.bpm);
    const tempo = `
      <div class="re-tempo" role="group" aria-label="Tempo">
        <button class="re-tempo-btn" type="button" data-action="slower" aria-label="Slower" ${bpm <= TEMPO_MIN ? 'disabled' : ''}>−</button>
        <span class="re-tempo-readout"><span class="re-tempo-value">${bpm}</span> BPM</span>
        <button class="re-tempo-btn" type="button" data-action="faster" aria-label="Faster" ${bpm >= TEMPO_MAX ? 'disabled' : ''}>+</button>
      </div>`;
    const mineBtn = `<button class="re-btn re-btn-wide re-btn-secondary${this.playingMine ? ' re-btn-on' : ''}" type="button" data-action="play-mine">${this.playingMine ? '■ Stop' : '▶ Play mine'}</button>`;
    const checkBtn = `<button class="re-btn re-btn-wide re-btn-primary" type="button" data-action="check">✓ Check</button>`;
    const options = `
      <div class="re-options-row">
        <button class="re-btn re-btn-ghost${this.hintOn ? ' re-btn-on' : ''}" type="button" data-action="hint" aria-pressed="${this.hintOn}">💡 ${this.hintOn ? 'Hint on' : (this.hintUsed ? 'Hint' : `Hint (−${HINT_PENALTY})`)}</button>
        <label class="re-switch">
          <input type="checkbox" role="switch" data-action="click" ${this.clickOn ? 'checked' : ''}>
          <span class="re-switch-track" aria-hidden="true"><span class="re-switch-thumb"></span></span>
          <span class="re-switch-label">Metronome</span>
        </label>
      </div>`;
    const upfront = this.run.nameUpfront
      ? `<div class="re-rhythm-name"><span class="re-rhythm-label">🎵 Learn the</span><strong class="re-rhythm-title">${this.target.name}</strong><span class="re-rhythm-about">${this.target.about}</span></div>`
      : '';

    let topHtml = '';
    let body = '';
    switch (this.step) {
      case 'answering':
        topHtml = `${upfront}${cue}${listenBtn}${tempo}`;
        body = `${mineBtn}${checkBtn}${options}`;
        break;
      case 'wrong':
        topHtml = `${upfront}${cue}${listenBtn}${tempo}`;
        body = `
          <p class="re-instruction re-feedback-wrong">Not quite: ${this.wrongCount} ${this.wrongCount === 1 ? 'beat is' : 'beats are'} off (marked in red).</p>
          ${mineBtn}
          <div class="re-cta-row">
            ${checkBtn}
            <button class="re-btn re-btn-ghost" type="button" data-action="reveal">Show answer</button>
          </div>
          ${options}`;
        break;
      case 'correct':
      case 'revealed': {
        const last = this.round === this.roundCount - 1;
        const result = this.roundResults[this.round];
        const msg = this.step === 'revealed'
          ? "Here's the answer. No points this round."
          : (this.attempts === 1 ? '🎯 Nailed it, first try!' : '✓ Got it!');
        const points = this.step === 'correct'
          ? `<p class="re-points">+${result.score} <span class="re-points-detail">${describeResult(result)}</span></p>`
          : '';
        topHtml = `${cue}${listenBtn}${tempo}`;
        body = `
          <p class="re-instruction ${this.step === 'correct' ? 're-feedback-right' : ''}">${msg}</p>
          ${points}
          ${this.rhythmNameHtml()}
          <button class="re-btn re-btn-wide re-btn-primary" type="button" data-action="next">${last ? 'Finish →' : 'Next round →'}</button>`;
        break;
      }
      case 'summary': {
        const total = this.totalScore;
        const rows = this.roundResults.map((r, i) => `
          <li class="re-breakdown-row">
            <span class="re-breakdown-round">Round ${i + 1}</span>
            <span class="re-breakdown-detail">${describeResult(r)}</span>
            <span class="re-breakdown-score">${r.score}</span>
          </li>`).join('');
        body = `
          <p class="re-summary-score">${total} <span class="re-summary-max">/ ${this.levelMax}</span></p>
          <p class="re-instruction re-verdict">${verdict(total, this.levelMax)}</p>
          <ul class="re-breakdown">${rows}</ul>
          <div class="re-cta-row">
            <button class="re-btn re-btn-secondary" type="button" data-action="replay">${this.run.replayText}</button>
            ${this.run.next ? `<button class="re-btn re-btn-primary" type="button" data-action="next-level">${this.run.nextLabel} →</button>` : ''}
          </div>`;
        break;
      }
    }
    top.innerHTML = topHtml;
    top.hidden = !topHtml;
    stage.innerHTML = body;

    const on = (action, event, fn) => this.view.querySelector(`.re-play [data-action="${action}"]`)?.addEventListener(event, fn);
    on('listen', 'click', () => this.playTarget());
    on('play-mine', 'click', () => this.playMine());
    on('check', 'click', () => this.check());
    on('hint', 'click', () => this.toggleHint());
    on('slower', 'click', () => this.changeTempo(-TEMPO_STEP));
    on('faster', 'click', () => this.changeTempo(TEMPO_STEP));
    on('reveal', 'click', () => this.reveal());
    on('next', 'click', () => this.nextRound());
    on('replay', 'click', () => this.startRun(this.run.replay()));
    on('next-level', 'click', () => this.startRun(this.run.next()));
    on('click', 'change', (e) => {
      this.clickOn = e.target.checked;
      writeStore(CLICK_KEY, this.clickOn);
    });
  }

  // Re-renders everything below the header for the current step.
  renderAll() {
    const levelsEl = this.view.querySelector('.re-levels');
    const playEl = this.view.querySelector('.re-play');
    const inLevels = this.step === 'levels';
    levelsEl.hidden = !inLevels;
    playEl.hidden = inLevels;

    if (inLevels) {
      levelsEl.innerHTML = this.renderPickerHtml();
      levelsEl.querySelectorAll('[data-tab]').forEach(tab => {
        tab.addEventListener('click', () => {
          this.cancelTargetPlayback();
          this.pickerTab = tab.dataset.tab;
          this.renderAll();
        });
      });
      levelsEl.querySelectorAll('[data-level]').forEach(card => {
        card.addEventListener('click', () => this.startRun(levelRun(Number(card.dataset.cat), Number(card.dataset.level))));
      });
      levelsEl.querySelectorAll('[data-set]').forEach(btn => {
        btn.addEventListener('click', () => this.startRun(setRun(Number(btn.dataset.set))));
      });
      levelsEl.querySelectorAll('.re-rhythm-card').forEach(card => {
        const name = card.dataset.rhythm;
        card.querySelector('[data-action="preview"]').addEventListener('click', (e) => this.previewRhythm(name, e.currentTarget));
        card.querySelector('[data-action="learn"]').addEventListener('click', () => this.startRun(singleRun(name)));
      });
      levelsEl.querySelector('[data-action="resume"]').addEventListener('click', () => this.resumeLevel());
      return;
    }

    this.renderStatus();
    this.view.querySelector('.re-board').hidden = this.step === 'summary';
    this.renderStage();
  }

  render() {
    this.view.innerHTML = `
      <div class="hg-container re-container">
        <button class="hg-back" type="button">← Back to Games</button>
        <header class="hg-header">
          <p class="hg-eyebrow">Rhythm · Rhythm by Ear</p>
          <h1 class="hg-title">Rhythm by Ear</h1>
          <p class="hg-subtitle">Hear a rhythm, then build it on the grid.</p>
        </header>

        ${this.renderHeroHtml()}

        <div class="re-levels" hidden></div>

        <div class="re-play">
          <div class="re-status-slot"></div>
          <div class="re-panel">
            <div class="re-stage-top"></div>
            <div class="re-board">
              <div class="re-grid-slot"></div>
            </div>
            <div class="re-stage"></div>
          </div>
        </div>
      </div>
    `;

    const gridSlot = this.view.querySelector('.re-grid-slot');
    this.gridMount.mount(gridSlot);
    gridSlot.addEventListener('click', this.onGridTap);

    this.view.querySelector('.hg-back').addEventListener('click', () => {
      this.teardown();
      this.onBack?.();
    });
    window.addEventListener('routeChanged', this.onRouteChanged);

    this.startRun(levelRun(0, 0));
  }
}

export function renderRhythmEarGame(view, options) {
  return new RhythmEarGame(view, options);
}
