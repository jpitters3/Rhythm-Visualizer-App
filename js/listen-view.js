// Chord listen's page: its markup, elements and drawing. No listening logic;
// chord cards call cardActions, which the page sets.
import { describeChord, labelToNote, noteName, pitchName } from './listen-notes.js';
import { each, listening, prefs, session, state } from './listen-state.js';
import { createChordShapeDiagramEl, setChordShapeLabels, updateChordShapeDiagram } from './chord-shape-diagram.js';

import { setVisible } from './dom.js';
import { beatsPerBar, chordLengths } from './live-follower.js';

// The page's elements, filled in by build(); els.view is the route's container
export const els = { view: null };

let replyTimer = null;

// What a chord card does when tapped or edited (set by the page)
export const cardActions = { play: () => {}, edit: () => {} };

function diagram(labels, className = '') {
  const svg = createChordShapeDiagramEl({ flat: true });
  if (className) svg.classList.add(className);
  updateChordShapeDiagram(svg, labels);
  return svg;
}

function chordCard(entry, { bars = null, playing = false, isNew = false, number = null, editing = false, onEdit = null } = {}) {
  const card = document.createElement('div');
  card.className = 'cl-card';
  card.classList.toggle('is-playing', playing);
  card.classList.toggle('is-new', isNew);
  card.classList.toggle('is-editing', editing);
  if (number) {
    const badge = document.createElement('span');
    badge.className = 'cl-card-num';
    badge.textContent = String(number);
    card.appendChild(badge);
  }
  const play = document.createElement('button');
  play.type = 'button';
  play.className = 'cl-card-play';
  play.setAttribute('aria-label', `Play ${entry.chord.short}`);
  play.appendChild(diagram(entry.labels));
  const name = document.createElement('span');
  name.className = 'cl-card-name';
  name.textContent = entry.chord.short;
  play.appendChild(name);
  if (bars) {
    const len = document.createElement('span');
    len.className = 'cl-card-len';
    len.textContent = bars;
    play.appendChild(len);
  }
  play.addEventListener('click', () => cardActions.play(entry.chord));
  card.appendChild(play);
  if (onEdit) {
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'cl-card-edit';
    edit.setAttribute('aria-label', `Edit chord ${number}`);
    edit.title = 'Edit this chord';
    edit.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"></path></svg>';
    edit.addEventListener('click', onEdit);
    card.appendChild(edit);
  }
  return card;
}

export function renderCurrent() {
  const labels = state.mode === 'live' && session.live?.current != null ? session.live.candidates[session.live.current].labels : session.current;
  updateChordShapeDiagram(els.bigDiagram, labels);
  const chord = labels.length ? describeChord(labels) : null;
  if (state.mode === 'record' && session.recording) {
    els.slot.textContent = 'Recording to your Clips';
    els.name.textContent = formatTime((Date.now() - session.recording.startedAt) / 1000);
    els.notes.textContent = '';
    els.stage.classList.add('has-chord');
    return;
  }
  els.slot.textContent = state.mode === 'live' ? ''
    : session.editingIndex != null ? `Chord ${session.editingIndex + 1} · ${session.current.length ? 'editing' : 'listening'}`
      : listening() ? `Chord ${session.captured.length + 1}` : '';
  els.name.textContent = chord?.short || (state.mode === 'live' ? 'Listening…' : listening() ? 'Play a note' : '');
  // Octaves only when a note is doubled, so "remove the lower D" has something to point at
  const names = chord ? chord.notes.map(pitchName) : [];
  const doubled = new Set(names).size < names.length;
  els.notes.textContent = chord ? chord.notes.map(doubled ? noteName : pitchName).join(' · ') : '';
  els.stage.classList.toggle('has-chord', !!chord);
}

// Rebuilt only when the chords or the one being edited change (each card draws a pan)
export function renderCaptured() {
  const key = JSON.stringify([session.editingIndex, session.captured.map(e => e.labels)]);
  if (els.captured.dataset.key === key) return;
  els.captured.dataset.key = key;
  const shown = els.captured.childElementCount;
  els.captured.replaceChildren(...session.captured.map((entry, i) => chordCard(entry, {
    isNew: i >= shown, number: i + 1, editing: i === session.editingIndex,
    onEdit: () => cardActions.edit(i),
  })));
  setVisible(els.capturedWrap, session.captured.length > 0);
  els.capturedCount.textContent = String(session.captured.length);
}

function lengthText(beats, perBar) {
  if (!beats) return '';
  if (perBar && beats % perBar === 0) {
    const bars = beats / perBar;
    return bars === 1 ? '1 bar' : `${bars} bars`;
  }
  return beats === 1 ? '1 beat' : `${beats} beats`;
}

export function renderLive() {
  if (!session.live) return;
  const beats = chordLengths(session.live);
  session.live.perBar = beatsPerBar(session.live);
  els.bpm.textContent = session.live.bpm ? String(session.live.bpm) : '–';
  els.meter.textContent = session.live.perBar ? `${session.live.perBar}/4` : '–';
  renderPulseDots();
  // Heard notes arrive many times a second: add cards for new chord changes and
  // update the rest in place. Undo or clear (fewer changes) starts again.
  const { changes } = session.live;
  if (els.progression.childElementCount > changes.length) els.progression.replaceChildren();
  const cards = els.progression.children;
  changes.forEach((c, i) => {
    const bars = lengthText(beats[i], session.live.perBar);
    let card = cards[i];
    if (!card) {
      card = chordCard(session.live.candidates[c.idx], { isNew: true });
      els.progression.appendChild(card);
    }
    setCardLength(card, bars);
    card.classList.toggle('is-playing', state.mode === 'live' && i === changes.length - 1);
  });
  setVisible(els.progressionEmpty, !changes.length);
}

function setCardLength(card, text) {
  let len = card.querySelector('.cl-card-len');
  if (!text) { len?.remove(); return; }
  if (!len) {
    len = document.createElement('span');
    len.className = 'cl-card-len';
    card.querySelector('.cl-card-play').appendChild(len);
  }
  if (len.textContent !== text) len.textContent = text;
}

function renderPulseDots() {
  const n = session.live?.perBar || 4;
  if (els.pulse.childElementCount === n) return;
  els.pulse.replaceChildren(...Array.from({ length: n }, () => {
    const dot = document.createElement('span');
    dot.className = 'cl-pulse-dot';
    return dot;
  }));
}

export function renderMode() {
  els.view.dataset.mode = listening() ? state.mode : 'idle'; // the CSS keys off this
  els.micBtn.classList.toggle('on', listening());
  els.micBtn.setAttribute('aria-pressed', String(listening()));
  els.micLabel.textContent = listening() ? 'Stop' : session.captured.length || session.live ? 'Listen again' : 'Start listening';
  els.modeCapture.classList.toggle('active', state.mode === 'capture');
  els.modeLive.classList.toggle('active', state.mode === 'live');
  els.modeRecord.classList.toggle('active', state.mode === 'record');
  els.micBtn.hidden = state.input === 'clip' || !!session.recording;
  els.hint.innerHTML = state.mode === 'record'
    ? 'Just play. Everything is recorded in high quality and saved to your <strong>Clips</strong>, to build the notation from later.'
    : state.input === 'clip'
      ? 'Press play and Panafide follows the chords in your clip, with the tempo and time signature. Fix any chord afterwards by voice or with ✎.'
      : state.mode === 'live'
        ? 'Play your progression in time. <strong>Double clap</strong> to stop.'
        : listening()
      ? `Play each note of the chord, or tap it. <strong>Clap or snap</strong> to lock it in, <strong>double clap</strong> to play it live.${prefs.voice ? ' Or just <strong>say</strong> what to change.' : ''}`
      : 'Turn on the mic and play a chord one note at a time, or tap the notes.';
  els.multiBtn.classList.toggle('on', prefs.multi);
  els.multiBtn.setAttribute('aria-pressed', String(prefs.multi));
  els.multiBtn.querySelector('.cl-voice-state').textContent = prefs.multi ? 'on' : 'off';
  els.lockBtn.disabled = state.mode === 'live' || state.mode === 'record' || !session.current.length;
  els.liveBtn.textContent = state.mode === 'live' ? 'Stop live' : 'Go live';
  els.liveBtn.disabled = !listening() || state.mode === 'record';
  // Mic off, a chord can still be tapped together: Lock shows once it has notes
  els.lockBtn.hidden = state.mode === 'record' || (!listening() && !session.current.length);
  els.liveBtn.hidden = state.mode === 'record';
  const showLive = state.mode === 'live' || !!session.live?.changes.length;
  setVisible(els.timing, showLive);
  setVisible(els.progressionWrap, showLive);
  const hasResult = session.captured.length > 0 || !!session.live?.changes.length;
  setVisible(els.steps, !hasResult && state.mode !== 'live');
  els.undoBtn.disabled = !session.undoStack.length;
  els.clearBtn.disabled = !hasResult && !session.current.length;
  els.toSongBtn.disabled = !hasResult;
  els.toStudioBtn.disabled = !hasResult;
  renderCurrent();
  each('render');
}

export function flashCue(kind) {
  els.stage.classList.remove('cue', 'cue-double');
  void els.stage.offsetWidth;
  els.stage.classList.add(kind === 'double' ? 'cue-double' : 'cue');
}

export function renderAll() {
  renderCaptured();
  renderLive();
  renderMode();
}

export function reply(text, { heard = null, tone = 'ok' } = {}) {
  clearTimeout(replyTimer);
  els.voice.dataset.tone = tone;
  els.voiceHeard.textContent = heard ? `“${heard}”` : '';
  els.voiceReply.textContent = text;
  els.voice.classList.add('show');
  replyTimer = setTimeout(() => els.voice.classList.remove('show'), tone === 'ask' ? 12000 : 5000);
}

// Note names on the big pan ("C4"), so there's something to say: "remove G4"
export function applyNoteNames() {
  setChordShapeLabels(els.bigDiagram, prefs.names ? (key => {
    const note = labelToNote(key);
    return note ? noteName(note) : '';
  }) : null);
  renderCurrent();
  each('render'); // the redraw dropped any marks features put on the pan
  els.namesBtn.classList.toggle('on', prefs.names);
  els.namesBtn.setAttribute('aria-pressed', String(prefs.names));
  els.namesBtn.querySelector('.cl-voice-state').textContent = prefs.names ? 'on' : 'off';
}

export function formatTime(secs) {
  const s = Math.max(0, Math.floor(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function build() {
  els.view.innerHTML = `
    <div class="cl-container">
      <header class="cl-head">
        <button class="cl-back" type="button">← Back</button>
        <div class="cl-titles">
          <p class="cl-eyebrow">Chord listen</p>
          <h1 class="cl-title">Play it. Panafide writes it down.</h1>
          <label class="cl-scale-pick">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><circle cx="12" cy="12" r="3"></circle></svg>
            <span class="cl-sr">Scale</span>
            <select class="cl-scale-select"></select>
          </label>
        </div>
        <div class="cl-modes" role="group" aria-label="Mode">
          <span class="cl-mode" data-m="capture">Capture</span>
          <span class="cl-mode" data-m="live">Live</span>
          <span class="cl-mode" data-m="record">Record</span>
        </div>
      </header>
      <div class="cl-layout">
        <section class="cl-stage" aria-live="polite">
          <div class="cl-clip" hidden>
            <button type="button" class="cl-clip-play" aria-label="Play"></button>
            <div class="cl-clip-main">
              <div class="cl-clip-title"></div>
              <input type="range" class="cl-clip-seek" min="0" max="0" step="0.1" value="0" aria-label="Position in the clip">
            </div>
            <span class="cl-clip-time">0:00</span>
            <button type="button" class="cl-clip-close" aria-label="Close the clip" title="Back to the mic">✕</button>
          </div>
          <div class="cl-big-wrap"><span class="cl-ring" aria-hidden="true"></span></div>
          <p class="cl-slot"></p>
          <p class="cl-name"></p>
          <p class="cl-notes"></p>
          <p class="cl-hint"></p>
          <div class="cl-saved" hidden>
            <span class="cl-saved-text"></span>
            <div class="cl-saved-actions">
              <button type="button" class="cl-btn cl-primary cl-saved-build">Build notation now</button>
              <button type="button" class="cl-btn cl-saved-transcribe">Transcribe notes</button>
              <button type="button" class="cl-btn cl-saved-open">Open Clips</button>
            </div>
          </div>
          <div class="cl-sounds-bar" hidden>
            <span class="cl-sounds-text"></span>
            <div class="cl-sounds-actions"></div>
          </div>
          <div class="cl-teach-bar" hidden>
            <span class="cl-teach-text"></span>
            <button type="button" class="cl-btn cl-teach-cancel">Cancel</button>
          </div>
          <div class="cl-controls">
            <button type="button" class="cl-mic" aria-pressed="false">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"></rect><path d="M5 11a7 7 0 0 0 14 0M12 18v4"></path></svg>
              <span class="cl-mic-label">Start listening</span>
            </button>
            <button type="button" class="cl-rec">
              <span class="cl-rec-dot" aria-hidden="true"></span>
              <span class="cl-rec-label">Record a flow</span>
            </button>
            <button type="button" class="cl-btn cl-lock">Lock chord</button>
            <button type="button" class="cl-btn cl-live">Go live</button>
          </div>
          <div class="cl-voice" aria-live="polite">
            <span class="cl-voice-dot" aria-hidden="true"></span>
            <span class="cl-voice-text"><span class="cl-voice-heard"></span><span class="cl-voice-reply"></span></span>
          </div>
          <div class="cl-toggles">
            <button type="button" class="cl-voice-btn cl-multi-btn" aria-pressed="false" title="Count several notes from one strike, octaves included. Off: only the strongest note counts.">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="15" r="3"></circle><circle cx="16" cy="9" r="3"></circle><circle cx="17" cy="18" r="2"></circle></svg>
              Multi-note <span class="cl-beta">beta</span> <span class="cl-voice-state">off</span>
            </button>
            <button type="button" class="cl-voice-btn cl-names-btn" aria-pressed="true" title="Show each note's name on the pan">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7V5h16v2M9 19h6M12 5v14"></path></svg>
              Note names <span class="cl-voice-state">on</span>
            </button>
            <button type="button" class="cl-voice-btn cl-sounds-btn" aria-pressed="false" title="Record your own handpan's sound for each note" hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5L6 9H2v6h4l5 4z"></path><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"></path></svg>
              Note sounds
            </button>
            <button type="button" class="cl-voice-btn cl-teach-btn" title="A note heard wrong? Teach it the sound">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 18V6M7 15V9M11 20V4M15 16V8M19 13v-2"></path></svg>
              Teach a note
            </button>
            <button type="button" class="cl-voice-btn" aria-pressed="false" title="Talk to it: “remove the G”, “next chord”…">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"></path><path d="M9 11h.01M12 11h.01M15 11h.01"></path></svg>
              Voice commands <span class="cl-voice-state">on</span>
            </button>
          </div>
        </section>
        <section class="cl-side">
          <div class="cl-timing">
            <div class="cl-stat"><span class="cl-stat-val cl-bpm">–</span><span class="cl-stat-key">BPM</span></div>
            <div class="cl-stat"><span class="cl-stat-val cl-meter">–</span><span class="cl-stat-key">Time</span></div>
            <div class="cl-stat cl-stat-pulse"><span class="cl-pulse"></span><span class="cl-stat-key">Pulse</span></div>
          </div>
          <ol class="cl-block cl-steps">
            <li><span class="cl-step-n">1</span><span><strong>Play a chord</strong>, one note at a time, or tap its notes. Each note lights up as it's heard; tap one again to take it out.</span></li>
            <li><span class="cl-step-n">2</span><span><strong>Clap or snap</strong> to lock it in, then play the next chord.</span></li>
            <li><span class="cl-step-n">3</span><span><strong>Double clap</strong> and play the progression in time. Panafide follows along and finds the tempo, pulse and time signature.</span></li>
            <li><span class="cl-step-n">4</span><span><strong>Just say it</strong>: “remove the G”, “add F sharp”, “remove the lower D”, “next chord”, “replace the third chord”, “undo”, “start over”.</span></li>
          </ol>
          <div class="cl-block cl-progression-wrap">
            <div class="cl-label">Progression</div>
            <div class="cl-cards cl-progression"></div>
            <p class="cl-empty">Play your chords in time. Each change appears here.</p>
          </div>
          <div class="cl-block cl-captured-wrap">
            <div class="cl-label">Captured chords <span class="cl-count"></span></div>
            <div class="cl-cards cl-captured"></div>
          </div>
          <button type="button" class="cl-btn cl-transcribe" hidden>Transcribe every note of this clip</button>
          <div class="cl-actions">
            <button type="button" class="cl-btn cl-undo">Undo</button>
            <button type="button" class="cl-btn cl-clear">Clear</button>
            <button type="button" class="cl-btn cl-primary cl-to-song">Song Builder</button>
            <button type="button" class="cl-btn cl-primary cl-to-studio">Send to Studio</button>
          </div>
        </section>
      </div>
    </div>`;

  const q = s => els.view.querySelector(s);
  Object.assign(els, {
    stage: q('.cl-stage'), slot: q('.cl-slot'), name: q('.cl-name'),
    voice: q('.cl-voice'), voiceHeard: q('.cl-voice-heard'), voiceReply: q('.cl-voice-reply'), voiceBtn: q('.cl-voice-btn:not(.cl-names-btn):not(.cl-teach-btn):not(.cl-multi-btn):not(.cl-sounds-btn)'),
    soundsBtn: q('.cl-sounds-btn'), soundsBar: q('.cl-sounds-bar'), soundsText: q('.cl-sounds-text'), soundsActions: q('.cl-sounds-actions'), namesBtn: q('.cl-names-btn'),
    multiBtn: q('.cl-multi-btn'),
    teachBtn: q('.cl-teach-btn'), teachBar: q('.cl-teach-bar'), teachText: q('.cl-teach-text'), notes: q('.cl-notes'), hint: q('.cl-hint'),
    micBtn: q('.cl-mic'), micLabel: q('.cl-mic-label'), lockBtn: q('.cl-lock'), liveBtn: q('.cl-live'),
    modeCapture: q('[data-m="capture"]'), modeLive: q('[data-m="live"]'), modeRecord: q('[data-m="record"]'),
    recordBtn: q('.cl-rec'), recordLabel: q('.cl-rec-label'),
    clipBar: q('.cl-clip'), clipPlay: q('.cl-clip-play'), clipTitle: q('.cl-clip-title'),
    clipSeek: q('.cl-clip-seek'), clipTime: q('.cl-clip-time'),
    savedBar: q('.cl-saved'), savedText: q('.cl-saved-text'), savedTranscribe: q('.cl-saved-transcribe'),
    transcribeBtn: q('.cl-transcribe'),
    steps: q('.cl-steps'), progressionWrap: q('.cl-progression-wrap'),
    timing: q('.cl-timing'), bpm: q('.cl-bpm'), meter: q('.cl-meter'), pulse: q('.cl-pulse'),
    progression: q('.cl-progression'), progressionEmpty: q('.cl-empty'),
    captured: q('.cl-captured'), capturedWrap: q('.cl-captured-wrap'), capturedCount: q('.cl-count'),
    undoBtn: q('.cl-undo'), clearBtn: q('.cl-clear'), toSongBtn: q('.cl-to-song'), toStudioBtn: q('.cl-to-studio'),
    back: q('.cl-back'), clipClose: q('.cl-clip-close'), savedBuild: q('.cl-saved-build'), savedOpen: q('.cl-saved-open'),
    teachCancel: q('.cl-teach-cancel'), scaleSelect: q('.cl-scale-select'),
  });
  els.bigDiagram = diagram([], 'cl-big');
  q('.cl-big-wrap').prepend(els.bigDiagram);
}
