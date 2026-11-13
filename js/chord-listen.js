// Chord listen (route #listen): play chords, and the app writes them down.
// Capture: play a chord's notes one at a time; a clap or snap locks it in and
// starts the next. A double clap goes live: play the progression in time and
// the app follows the chords, working out tempo, pulse and time signature.
// Everything can also be said out loud: "remove the G", "add F sharp",
// "next chord", "replace the third chord", "start over" (js/voice-commands.js).
// Record saves the raw audio as a Clip (Library → Clips) to just flow; a clip can
// come back here later and be listened to like the mic, to build its notation.
import { startListening, startListeningToClip, stopListening, getLastSound, getMicStream, setMultiNote } from './listen-engine.js';
import { startRawAudioRecording, stopRawAudioRecording } from './audio-recorder.js';
import { uploadClip, clipTitle, fetchClipBlob } from './clips.js';
import { openFreeRecordWithAudio } from './free-record.js';
import { openAuthModal } from './auth.js';
import { trimLeadIn, uploadNoteAudio, setNoteAudio } from './note-audio.js';
import { getActiveCustomHandpan, updateCustomHandpanNoteMap } from './handpanmap.js';
import { loadCalibrationProfile, teachSound, forgetTaughtSounds, taughtSoundCount } from './transcription.js';
import { startVoice, stopVoice, voiceSupported } from './voice-listener.js';
import { parseVoiceCommand, parseNoteName, pcName } from './voice-commands.js';
import { startFollowing, hearNote, stopFollowing, chordLengths, beatsPerBar, beatMs } from './live-follower.js';
import { createChordShapeDiagramEl, updateChordShapeDiagram, setChordShapeLabels, onChordShapeLayout } from './chord-shape-diagram.js';
import { Bus, BUS_EVENT } from './bus.js';
import { ChordAnalyzer, NOTE_MAP } from './chord-analyzer.js';
import { getAllCurrentNotes, getScaleChordPool, notesToLabels, playChordNotes } from './chord-playback.js';
import { chordShortLabel, sendChordsToStudio } from './progression-to-grid.js';
import { appendHeardChords, openChordPanel } from './chord-sidepanel.js';
import { getScale, getSelectedScaleName, currentUser, isAdminUser } from './state.js';
import { unlockAudio, getAudioCtx, reloadLabelSample } from './noteplayer.js';
import { navigate } from './router.js';
import { gridA } from './grid-context.js';
import { setVisible } from './dom.js';
import { alert as showAlert } from './alert.js';

const DOUBLE_CUE_MS = 650;
const HISTORY_MAX = 60;
const SPEECH_LOOKBACK_MS = 1200; // notes/claps heard this long before speech was recognised were the voice
const SPEECH_SETTLE_MS = 400;
const SPEECH_STALL_MS = 1500; // no new words for this long: give the mic back to the pan
const PLAYBACK_MUTE_MS = 1800; // the pan's own playback must not be heard as notes
const VOICE_KEY = 'gp_listenVoice';
const NAMES_KEY = 'gp_listenNoteNames';
const MULTI_KEY = 'gp_listenMultiNote';
const TEACH_STRIKES = 3;
const TEACH_MAX_SPREAD = 1.04; // strikes further apart than this weren't the same sound
const CORRECT_WITHIN_MS = 20000;
const RECORD_WARN_SECS = 20 * 60; // about 38 MB at 256 kbps; uploads stop at 50 MB
const RECORD_MAX_SECS = 25 * 60;
const TAKE_MS = 8000; // a note's sound: the strike and its long decay (as in guided calibration)
const TAKE_WAIT_MS = 15000; // give up if no strike comes
const TAKE_ONSET_RMS = 0.04; // "that was a G" refers to a sound this recent

let view = null;
let els = {};
// What Listen is doing. Changed only through setInput / setMode / setTask, which
// refuse combinations that make no sense (recording while a clip plays,
// teaching a note mid-live…):
//   input: 'off' | 'mic' | 'clip'          where the sound comes from
//   mode:  'capture' | 'live' | 'record'   what heard notes do (record: mic only)
//   task:  null | { kind: 'teach', label, freqs } | { kind: 'sounds', take }
//          a side job, one at a time, carrying its own data
const state = { input: 'off', mode: 'capture', task: null };
// What's been played and heard, shared by every part of Listen
const session = {
  current: [], // labels of the chord being captured
  captured: [], // [{ labels, chord }]
  editingIndex: null, // a captured chord being replaced or edited; null = a new chord
  live: null, // the live follower (js/live-follower.js) plus perBar / shownBeat on screen
  undoStack: [], // snapshots before each change: { at, audio, snap }
  recording: null, // { startedAt, timer }: set exactly while mode is 'record'
  clip: null, // the clip being built from: { row, blob, url }
  savedClip: null, // { row, blob } just recorded, offered for notation
  voiceBusy: false, // someone is talking: what the mic hears isn't the pan
  muteUntil: 0, // the pan's own playback: ignore the mic until then
};

// The player's switches (kept in localStorage)
const prefs = { voice: false, names: true, multi: false };

let lastCueAt = -Infinity;
let pulseRaf = null;
let sessionScale = null; // the scale the chords on screen were played on
let clipAudio = null;
let pendingClip = null; // asked for from the Library before the view was ready
let voiceSettleTimer = null;
let pending = null; // a question waiting for its answer, e.g. which D
let replyTimer = null;

// --- State transitions ---

function invalid(what) {
  throw new Error(`Chord listen: ${what} (input ${state.input}, mode ${state.mode}, task ${state.task?.kind || 'none'})`);
}

function setInput(input) {
  state.input = input;
  if (input === 'off' || (input === 'clip' && state.mode === 'record')) state.mode = 'capture';
  if (input === 'off' && state.task?.kind === 'teach') state.task = null;
}

function setMode(next) {
  if (next !== 'capture' && state.input === 'off') invalid(`${next} needs sound coming in`);
  if (next === 'record' && state.input !== 'mic') invalid('only the mic can be recorded');
  if (next !== 'capture' && state.task) invalid(`${next} with a ${state.task.kind} task open`);
  if ((next === 'record') !== !!session.recording) invalid('record mode and the recording must start and stop together');
  state.mode = next;
}

// task: null, { kind: 'teach', label, freqs } or { kind: 'sounds', take }
function setTask(task) {
  if (task && state.mode !== 'capture') invalid(`a ${task.kind} task in ${state.mode} mode`);
  if (task?.kind === 'teach' && state.input === 'off') invalid('teaching needs sound coming in');
  state.task = task;
}

const listening = () => state.input !== 'off';
const teaching = () => (state.task?.kind === 'teach' ? state.task : null);
const soundsOpen = () => state.task?.kind === 'sounds';
const currentTake = () => (state.task?.kind === 'sounds' ? state.task.take : null);

// --- Notes and names ---

function normLabel(label) {
  return label === 'D' ? 'Ding' : String(label);
}

function labelToNote(label) {
  const scale = getScale();
  if (!scale) return null;
  return label === 'Ding' ? scale.ding : scale.map?.[label] || null;
}

const midi = note => parseNoteName(note)?.midi ?? 0;

// "Cs4" (the scales' spelling) reads as C#
const pitchName = note => note.replace(/-?\d+$/, '').replace(/^([A-G])s$/, '$1#');
const noteName = note => pitchName(note) + (parseNoteName(note)?.octave ?? '');

// Every note on the pan, low to high
function panNotes() {
  const scale = getScale();
  if (!scale) return [];
  const entries = [['Ding', scale.ding], ...Object.entries(scale.map || {})];
  return entries
    .map(([label, name]) => ({ label, name, ...parseNoteName(name) }))
    .filter(n => n.midi != null)
    .sort((a, b) => a.midi - b.midi);
}

function scalePrefersFlats() {
  return panNotes().some(n => /^[A-G]b/.test(n.name));
}

// Extra notes over a triad, by interval from its root
const EXTENSIONS = { 10: '7', 11: 'maj7', 2: 'add9', 5: 'add11', 9: '6' };

// The chord a set of pan notes makes: the triad it contains (lowest note as root
// if it can be), plus any extension; otherwise its notes.
function describeChord(labels) {
  const notes = labels.map(labelToNote).filter(Boolean).sort((a, b) => midi(a) - midi(b));
  if (!notes.length) return null;
  const pcs = new Set(notes.map(n => midi(n) % 12));
  const triads = ChordAnalyzer.analyze(getAllCurrentNotes())
    .filter(t => t.notes.every(n => pcs.has(midi(n) % 12)));
  const bassPc = midi(notes[0]) % 12;
  const triad = triads.find(t => NOTE_MAP[t.root.toUpperCase()] === bassPc)
    || triads.find(t => !t.inversion) || triads[0];

  if (triad) {
    const rootPc = NOTE_MAP[triad.root.toUpperCase()];
    const triadPcs = new Set(triad.notes.map(n => midi(n) % 12));
    const ext = [...pcs].filter(pc => !triadPcs.has(pc))
      .map(pc => EXTENSIONS[(pc - rootPc + 12) % 12]).filter(Boolean).join('');
    const inversion = triad.root.toUpperCase() === pitchName(notes[0]).toUpperCase() ? 0 : triad.inversion;
    const chord = { root: triad.root, quality: triad.quality, name: triad.name, inversion, notes, playable: true };
    return { ...chord, short: chordShortLabel({ ...chord, inversion: 0 }) + ext };
  }
  const names = [...new Set(notes.map(pitchName))];
  const fifth = names.length === 2 && (midi(notes.at(-1)) - midi(notes[0])) % 12 === 7;
  const short = fifth ? `${names[0]}5` : names.join(' ');
  return { root: names[0], quality: 'Custom', name: short, inversion: 0, notes, playable: true, short };
}

// --- Rendering ---

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
  play.addEventListener('click', () => playChord(entry.chord));
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

function renderCurrent() {
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

function renderCaptured() {
  const shown = els.captured.childElementCount;
  els.captured.replaceChildren(...session.captured.map((entry, i) => chordCard(entry, {
    isNew: i >= shown, number: i + 1, editing: i === session.editingIndex,
    onEdit: () => {
      const r = editChordAt(i);
      reply(r.text, { tone: r.tone });
      els.stage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    },
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

function renderLive() {
  if (!session.live) return;
  const beats = chordLengths(session.live);
  session.live.perBar = beatsPerBar(session.live);
  els.bpm.textContent = session.live.bpm ? String(session.live.bpm) : '–';
  els.meter.textContent = session.live.perBar ? `${session.live.perBar}/4` : '–';
  renderPulseDots();
  const shown = els.progression.childElementCount;
  const cards = session.live.changes.map((c, i) => chordCard(session.live.candidates[c.idx], {
    bars: lengthText(beats[i], session.live.perBar),
    playing: state.mode === 'live' && i === session.live.changes.length - 1,
    isNew: i >= shown,
  }));
  els.progression.replaceChildren(...cards);
  setVisible(els.progressionEmpty, !cards.length);
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

// Beat dots follow the estimated pulse, counting from the last chord change
function pulseTick() {
  pulseRaf = requestAnimationFrame(pulseTick);
  const ms = beatMs(session.live);
  const anchor = session.live?.changes.at(-1)?.at;
  if (!ms || anchor == null) return;
  const now = (getAudioCtx()?.currentTime ?? 0) * 1000;
  const beat = Math.floor((now - anchor) / ms);
  const n = els.pulse.childElementCount;
  if (beat === session.live.shownBeat) return;
  session.live.shownBeat = beat;
  [...els.pulse.children].forEach((d, i) => d.classList.toggle('on', i === ((beat % n) + n) % n));
  els.stage.classList.remove('beat');
  void els.stage.offsetWidth; // restart the ring animation
  els.stage.classList.add('beat');
}

function renderMode() {
  view.dataset.mode = listening() ? state.mode : 'idle'; // the CSS keys off this
  els.micBtn.classList.toggle('on', listening());
  els.micBtn.setAttribute('aria-pressed', String(listening()));
  els.micLabel.textContent = listening() ? 'Stop' : session.captured.length || session.live ? 'Listen again' : 'Start listening';
  els.modeCapture.classList.toggle('active', state.mode === 'capture');
  els.modeLive.classList.toggle('active', state.mode === 'live');
  els.modeRecord.classList.toggle('active', state.mode === 'record');
  els.micBtn.hidden = state.input === 'clip' || !!session.recording;
  els.recordBtn.hidden = state.input === 'clip';
  els.recordBtn.classList.toggle('recording', !!session.recording);
  els.recordLabel.textContent = session.recording ? 'Stop & save' : 'Record a flow';
  setVisible(els.clipBar, state.input === 'clip');
  setVisible(els.savedBar, !!session.savedClip && !session.recording && state.input !== 'clip');
  // Free record (note-by-note transcription) is admin-only for now
  const canTranscribe = isAdminUser(currentUser);
  els.transcribeBtn.hidden = !canTranscribe || state.input !== 'clip';
  els.savedTranscribe.hidden = !canTranscribe;
  els.hint.innerHTML = state.mode === 'record'
    ? 'Just play. Everything is recorded in high quality and saved to your <strong>Clips</strong>, to build the notation from later.'
    : state.input === 'clip'
      ? 'Press play and Panafide follows the chords in your clip, with the tempo and time signature. Fix any chord afterwards by voice or with ✎.'
      : state.mode === 'live'
        ? 'Play your progression in time. <strong>Double clap</strong> to stop.'
        : listening()
      ? `Play each note of the chord, or tap it. <strong>Clap or snap</strong> to lock it in, <strong>double clap</strong> to play it live.${prefs.voice ? ' Or just <strong>say</strong> what to change.' : ''}`
      : 'Turn on the mic and play a chord one note at a time, or tap the notes.';
  view.toggleAttribute('data-teach', !!teaching());
  setVisible(els.teachBar, !!teaching());
  const task = teaching();
  if (task) {
    els.teachText.textContent = task.label
      ? `Teaching ${labelName(task.label)}: strike it ${TEACH_STRIKES} times (${task.freqs.length}/${TEACH_STRIKES})`
      : 'Tap the note you want to teach';
  }
  els.teachBtn.disabled = !listening() || state.mode === 'live';
  view.toggleAttribute('data-sounds', soundsOpen());
  renderSounds();
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
  els.voiceBtn.hidden = !voiceSupported();
  els.voiceBtn.classList.toggle('on', prefs.voice);
  els.voiceBtn.setAttribute('aria-pressed', String(prefs.voice));
  els.voiceBtn.querySelector('.cl-voice-state').textContent = prefs.voice ? 'on' : 'off';
  els.clearBtn.disabled = !hasResult && !session.current.length;
  els.toSongBtn.disabled = !hasResult;
  els.toStudioBtn.disabled = !hasResult;
  renderCurrent();
}

function flashCue(kind) {
  els.stage.classList.remove('cue', 'cue-double');
  void els.stage.offsetWidth;
  els.stage.classList.add(kind === 'double' ? 'cue-double' : 'cue');
}

// --- State and undo ---

function snapshot() {
  return {
    current: [...session.current],
    captured: session.captured.map(e => ({ labels: [...e.labels], chord: e.chord })),
    editingIndex: session.editingIndex, live: session.live, mode: state.mode,
  };
}

function restore(snap) {
  if (state.mode === 'live' && snap.mode !== 'live') {
    cancelAnimationFrame(pulseRaf);
    pulseRaf = null;
    setMode('capture');
  }
  session.current = snap.current;
  session.captured = snap.captured;
  session.editingIndex = snap.editingIndex;
  session.live = snap.live;
  els.progression.replaceChildren();
  renderAll();
}

// Every change goes through here so it can be undone; audio=true marks changes
// made by what the mic heard, which speech may take back.
function change(fn, { audio = false } = {}) {
  session.undoStack.push({ at: performance.now(), audio, snap: snapshot() });
  if (session.undoStack.length > HISTORY_MAX) session.undoStack.shift();
  fn();
  renderAll();
}

function undo() {
  const last = session.undoStack.pop();
  if (!last) return false;
  restore(last.snap);
  return true;
}

function renderAll() {
  renderCaptured();
  renderLive();
  renderMode();
}

// --- Capture ---

function addNote(label) {
  if (session.current.includes(label)) return;
  change(() => session.current.push(label), { audio: true });
}

function lockChord({ audio = false } = {}) {
  if (!session.current.length) return false;
  const chord = describeChord(session.current);
  if (!chord) return false;
  change(() => {
    const entry = { labels: [...session.current], chord };
    if (session.editingIndex != null && session.captured[session.editingIndex]) session.captured[session.editingIndex] = entry;
    else session.captured.push(entry);
    session.current = [];
    session.editingIndex = null;
  }, { audio });
  return chord;
}

// --- Live ---

function liveCandidates() {
  if (session.captured.length) {
    const seen = new Set();
    return session.captured.filter(e => {
      const key = [...e.labels].sort().join(',');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  // Nothing captured: follow any chord on the scale
  return getScaleChordPool().map(c => {
    const labels = notesToLabels(c.notes).map(normLabel);
    return { labels, chord: describeChord(labels) };
  }).filter(e => e.chord);
}

function startLive({ audio = false } = {}) {
  cancelTake();
  if (state.task) setTask(null); // a side job ends when playing in time begins
  lockChord({ audio });
  change(() => {
    session.editingIndex = null;
    session.current = [];
    // Plus what's on screen: the metre shown and the beat lit
    session.live = { ...startFollowing(liveCandidates()), perBar: null, shownBeat: null };
    els.progression.replaceChildren();
    setMode('live');
  }, { audio });
  cancelAnimationFrame(pulseRaf);
  pulseTick();
}

function stopLive() {
  cancelAnimationFrame(pulseRaf);
  pulseRaf = null;
  stopFollowing(session.live, (getAudioCtx()?.currentTime ?? 0) * 1000);
  setMode('capture');
  els.pulse.querySelectorAll('.on').forEach(d => d.classList.remove('on'));
  renderLive();
  renderMode();
}

function liveNote(label, at) {
  const changed = hearNote(session.live, label, at);
  if (changed) session.live.shownBeat = null;
  renderLive();
  if (changed) renderMode();
}

// --- Mic ---

function audioMuted() {
  if (state.input === 'clip') return false; // talking or the pan's playback isn't in the clip
  return session.voiceBusy || performance.now() < session.muteUntil;
}

function onSound(sound) {
  if (currentTake()) return;
  if (teaching() && !audioMuted()) onTeachSound(sound);
}

function onNote(rawLabel, at) {
  if (audioMuted()) return;
  const label = normLabel(rawLabel);
  els.stage.querySelector(`.cl-big [data-note="${label}"]`)?.classList.add('just-heard');
  setTimeout(() => els.stage.querySelector(`.cl-big [data-note="${label}"]`)?.classList.remove('just-heard'), 350);
  const take = currentTake();
  if (take) { take.heard.add(label); return; } // a note's sound being recorded
  if (teaching()) return; // the strikes being taught aren't chord notes
  if (state.mode === 'capture') addNote(label);
  else if (state.mode === 'live') liveNote(label, at);
}

function onCue(at) {
  if (audioMuted() || state.task) return;
  const double = at - lastCueAt < DOUBLE_CUE_MS;
  lastCueAt = double ? -Infinity : at;
  flashCue(double ? 'double' : 'single');
  if (state.mode === 'capture') {
    if (double) startLive({ audio: true });
    else lockChord({ audio: true });
  } else if (state.mode === 'live' && double && state.input !== 'clip') { // a clip is followed to its end
    stopLive();
  }
}

function onLevel(rms) {
  if (currentTake()?.phase === 'waiting' && rms > TAKE_ONSET_RMS) startTakeCountdown();
  els.stage.style.setProperty('--level', Math.min(1, rms * 12).toFixed(3));
}

async function startMic() {
  unlockAudio();
  if (!getScale()) {
    showAlert('Pick your handpan scale in the Studio first.');
    return;
  }
  await loadCalibrationProfile(); // this scale's taught sounds
  const ok = await startListening({ onNote, onCue, onLevel, onSound });
  if (!ok) {
    showAlert('Panafide needs the microphone to hear you play. Allow it in your browser settings and try again.');
    return;
  }
  setInput('mic');
  session.current = [];
  if (prefs.voice) beginVoice();
  renderMode();
}

function stopMic() {
  if (session.recording) stopRecord(); // what's recorded so far is saved
  if (state.input === 'clip') {
    closeClip();
    return;
  }
  stopListening();
  stopVoice();
  if (state.mode === 'live') stopLive();
  cancelTake();
  setInput('off');
  session.current = [];
  session.editingIndex = null;
  session.voiceBusy = false;
  pending = null;
  els.stage.style.setProperty('--level', '0');
  renderAll();
}

function playChord(chord) {
  if (!chord) return;
  unlockAudio();
  session.muteUntil = performance.now() + PLAYBACK_MUTE_MS;
  playChordNotes(chord.notes);
}

// --- Voice ---

function reply(text, { heard = null, tone = 'ok' } = {}) {
  clearTimeout(replyTimer);
  els.voice.dataset.tone = tone;
  els.voiceHeard.textContent = heard ? `“${heard}”` : '';
  els.voiceReply.textContent = text;
  els.voice.classList.add('show');
  replyTimer = setTimeout(() => els.voice.classList.remove('show'), tone === 'ask' ? 12000 : 5000);
}

// Said back the way it was said: "F sharp" stays F#, even on a pan spelled in flats
const say = n => pcName(n.pc, n.acc ? n.acc < 0 : scalePrefersFlats()) + (n.octave ?? '');
const listText = items => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
const byPitch = labels => [...labels].sort((a, b) => midiOf(a) - midiOf(b));
const labelName = label => noteName(labelToNote(label) || '');
const midiOf = label => midi(labelToNote(label));

function chordIndex(ref) {
  if (!ref) return null;
  if (ref.last) return session.captured.length - 1;
  if (ref.previous) return (session.editingIndex ?? session.captured.length) - 1;
  return ref.index;
}

// Which notes an edit works on: a named chord, else the one being played; with
// nothing played yet, a fix like "remove the G" means the chord just locked.
function resolveTarget(action, { fallbackToLast = false } = {}) {
  if (action.chord) {
    const i = chordIndex(action.chord);
    if (i == null || !session.captured[i]) return { error: `There's no chord ${i == null ? '' : i + 1} yet.` };
    return { index: i, labels: [...session.captured[i].labels] };
  }
  if (state.mode === 'live') return { error: 'Stop live mode first, then edit.' };
  if (!session.current.length && fallbackToLast && session.editingIndex == null && session.captured.length) {
    return { index: session.captured.length - 1, labels: [...session.captured.at(-1).labels] };
  }
  return { index: null, labels: [...session.current] };
}

function where(target, prep = 'in') {
  return target.index == null ? '' : ` ${prep} chord ${target.index + 1}`;
}

function writeTarget(target, labels) {
  if (target.index == null) {
    session.current = labels;
    return;
  }
  if (!labels.length) {
    session.captured.splice(target.index, 1);
    if (session.editingIndex != null && session.editingIndex > target.index) session.editingIndex--;
    return;
  }
  const chord = describeChord(labels);
  if (chord) session.captured[target.index] = { labels, chord };
}

const pickBy = (list, qual) => (qual === 'low' ? list[0] : list.at(-1));

// The pan's notes matching a spoken note, low to high
function panMatches(note) {
  return panNotes().filter(n => n.pc === note.pc && (note.octave == null || n.octave === note.octave));
}

function chordMatches(labels, note) {
  return labels
    .filter(l => {
      const p = parseNoteName(labelToNote(l));
      return p && p.pc === note.pc && (note.octave == null || p.octave === note.octave);
    })
    .sort((a, b) => midiOf(a) - midiOf(b));
}

// Each returns the reply; a question sets `pending` for the answer
function doRemove(action) {
  const target = resolveTarget(action, { fallbackToLast: true });
  if (target.error) return { text: target.error, tone: 'warn' };
  let labels = target.labels;
  const removed = [];
  for (const note of action.notes) {
    const hits = chordMatches(labels, note);
    if (!hits.length) return { text: `There's no ${say(note)}${where(target) || ' in this chord'}.`, tone: 'warn' };
    if (hits.length > 1 && !note.qual) {
      pending = { kind: 'remove', note, target: action.chord ? action : null };
      return { text: `There are two ${say(note)}s. The low one or the high one?`, tone: 'ask' };
    }
    const label = note.qual ? pickBy(hits, note.qual) : hits[0];
    labels = labels.filter(l => l !== label);
    removed.push(labelName(label));
  }
  change(() => writeTarget(target, labels));
  return { text: `Removed ${listText(removed)}${where(target, 'from')}.` };
}

function doRemoveOctave(action) {
  const target = resolveTarget(action, { fallbackToLast: true });
  if (target.error) return { text: target.error, tone: 'warn' };
  const byPc = new Map();
  target.labels.forEach(l => {
    const pc = parseNoteName(labelToNote(l))?.pc;
    byPc.set(pc, [...(byPc.get(pc) || []), l]);
  });
  const doubled = [...byPc.entries()].filter(([, ls]) => ls.length > 1);
  if (!doubled.length) return { text: `No note is doubled${where(target) || ' in this chord'}.`, tone: 'warn' };
  if (doubled.length > 1) {
    pending = { kind: 'removeOctave', qual: action.qual, target: action.chord ? action : null };
    return { text: `Which note: ${doubled.map(([pc]) => pcName(pc, scalePrefersFlats())).join(' or ')}?`, tone: 'ask' };
  }
  return doRemove({ ...action, type: 'remove', notes: [{ pc: doubled[0][0], qual: action.qual }] });
}

// Picks the pan note for "add D": a given octave or low/high, else one not in
// the chord yet, nearest the chord's other notes
function choosePanNote(note, labels) {
  const options = panMatches(note);
  if (!options.length) return { error: `There's no ${say(note)} on your ${getSelectedScaleName() || 'pan'}.` };
  if (note.qual) return { pick: pickBy(options, note.qual), options };
  const fresh = options.filter(o => !labels.includes(o.label));
  if (!fresh.length) return { error: `${say(note)} is already in.` };
  if (fresh.length === 1) return { pick: fresh[0], options };
  const centre = labels.length ? labels.reduce((sum, l) => sum + midiOf(l), 0) / labels.length : fresh[0].midi;
  const pick = [...fresh].sort((a, b) => Math.abs(a.midi - centre) - Math.abs(b.midi - centre))[0];
  return { pick, options, choice: true };
}

function doAdd(action) {
  const target = resolveTarget(action);
  if (target.error) return { text: target.error, tone: 'warn' };
  const labels = target.labels;
  const added = [];
  const skipped = [];
  let choice = null;
  for (const note of action.notes) {
    const r = choosePanNote(note, labels);
    if (r.error) {
      skipped.push(r.error);
      continue;
    }
    if (labels.includes(r.pick.label)) {
      skipped.push(`${noteName(r.pick.name)} is already in.`);
      continue;
    }
    labels.push(r.pick.label);
    added.push(r.pick.label);
    if (r.choice) choice = { note, picked: r.pick };
  }
  if (!added.length) return { text: skipped.join(' ') || 'Nothing to add.', tone: 'warn' };
  const addedText = listText(byPitch(added).map(labelName)) + where(target, 'to');
  const extra = skipped.length ? ` ${skipped.join(' ')}` : '';
  change(() => writeTarget(target, labels));
  if (choice && action.notes.length === 1) {
    pending = { kind: 'addOctave', note: choice.note, picked: choice.picked.label, target: action.chord ? action : null };
    const other = choice.picked.midi === panMatches(choice.note)[0].midi ? 'higher' : 'lower';
    return { text: `Added ${addedText}. Say “the ${other} one” to switch.${extra}` };
  }
  return { text: `Added ${addedText}.${extra}` };
}

function doSet(action) {
  const target = resolveTarget(action);
  if (target.error) return { text: target.error, tone: 'warn' };
  const labels = [];
  for (const note of action.notes) {
    const r = choosePanNote(note, labels);
    if (r.error) return { text: r.error, tone: 'warn' };
    labels.push(r.pick.label);
  }
  change(() => writeTarget(target, labels));
  return { text: `Set${where(target)} to ${listText(byPitch(labels).map(labelName))}.` };
}

function doSwap(action) {
  const target = resolveTarget(action, { fallbackToLast: true });
  if (target.error) return { text: target.error, tone: 'warn' };
  let labels = target.labels;
  for (const note of action.from) {
    const hits = chordMatches(labels, note);
    if (!hits.length) return { text: `There's no ${say(note)}${where(target) || ' in this chord'}.`, tone: 'warn' };
    labels = labels.filter(l => l !== (note.qual ? pickBy(hits, note.qual) : hits[0]));
  }
  const added = [];
  for (const note of action.to) {
    const r = choosePanNote(note, labels);
    if (r.error) return { text: r.error, tone: 'warn' };
    labels.push(r.pick.label);
    added.push(noteName(r.pick.name));
  }
  change(() => writeTarget(target, labels));
  return { text: `Swapped ${action.from.map(say).join(' ')} for ${added.join(' ')}${where(target)}.` };
}

function doShift(action) {
  const target = resolveTarget(action, { fallbackToLast: true });
  if (target.error) return { text: target.error, tone: 'warn' };
  let labels = target.labels;
  const moved = [];
  for (const note of action.notes) {
    const hits = chordMatches(labels, note);
    if (!hits.length) return { text: `There's no ${say(note)}${where(target) || ' in this chord'}.`, tone: 'warn' };
    const from = action.dir === 'up' ? hits.at(-1) : hits[0];
    const fromMidi = midiOf(from);
    const options = panMatches({ pc: note.pc }).filter(o => (action.dir === 'up' ? o.midi > fromMidi : o.midi < fromMidi));
    const to = action.dir === 'up' ? options[0] : options.at(-1);
    if (!to) return { text: `Your pan has no ${say(note)} ${action.dir === 'up' ? 'higher' : 'lower'} than ${labelName(from)}.`, tone: 'warn' };
    labels = labels.filter(l => l !== from && l !== to.label).concat(to.label);
    moved.push(`${labelName(from)} → ${noteName(to.name)}`);
  }
  change(() => writeTarget(target, labels));
  return { text: `Moved ${moved.join(', ')}${where(target)}.` };
}

// "The low one" / "the D": answers the last question
function doResolve(action) {
  const p = pending;
  pending = null;
  if (!p) return null;
  const extra = p.target ? { chord: p.target.chord } : {};
  if (p.kind === 'remove' && action.both) {
    const target = resolveTarget({ ...extra }, { fallbackToLast: true });
    const hits = chordMatches(target.labels, p.note);
    change(() => writeTarget(target, target.labels.filter(l => !hits.includes(l))));
    return { text: `Removed both ${say(p.note)}s.` };
  }
  if (p.kind === 'remove' && action.qual) return doRemove({ type: 'remove', notes: [{ ...p.note, qual: action.qual }], ...extra });
  if (p.kind === 'removeOctave' && action.note) return doRemove({ type: 'remove', notes: [{ ...action.note, qual: p.qual }], ...extra });
  if (p.kind === 'addOctave' && action.qual) {
    const target = resolveTarget({ ...extra });
    const options = panMatches(p.note);
    const want = pickBy(options, action.qual);
    if (!want || want.label === p.picked) return { text: `That's already the ${action.qual === 'low' ? 'lowest' : 'highest'} ${say(p.note)}.` };
    change(() => writeTarget(target, target.labels.filter(l => l !== p.picked).concat(want.label)));
    return { text: `Switched to ${noteName(want.name)}.` };
  }
  return null;
}

function doNext() {
  if (state.mode === 'live') return { text: 'You’re live. Say “stop” to finish.', tone: 'warn' };
  const wasEditing = session.editingIndex;
  const chord = lockChord();
  if (!chord) return { text: 'Play some notes first.', tone: 'warn' };
  flashCue('single');
  return { text: wasEditing != null ? `Chord ${wasEditing + 1} is now ${chord.short}.` : `Locked ${chord.short} as chord ${session.captured.length}.` };
}

function doChordCommand(action) {
  const i = chordIndex(action.chord);
  if (i == null || !session.captured[i]) return { text: `There's no chord ${i == null ? '' : i + 1} yet.`, tone: 'warn' };
  if (state.mode === 'live') return { text: 'Stop live mode first, then edit.', tone: 'warn' };
  const name = session.captured[i].chord.short;
  if (action.type === 'deleteChord') {
    change(() => {
      session.captured.splice(i, 1);
      if (session.editingIndex === i) { session.editingIndex = null; session.current = []; }
      else if (session.editingIndex != null && session.editingIndex > i) session.editingIndex--;
    });
    return { text: `Removed chord ${i + 1} (${name}).` };
  }
  if (action.type === 'replaceChord') {
    change(() => { session.editingIndex = i; session.current = []; });
    return { text: `Play the new chord ${i + 1}, then say “next” or clap.` };
  }
  return editChordAt(i);
}

// Opens a captured chord on the big pan: changes go to it, "next" or Lock saves it
function editChordAt(i) {
  if (!session.captured[i]) return { text: `There's no chord ${i + 1} yet.`, tone: 'warn' };
  if (state.mode === 'live') return { text: 'Stop live mode first, then edit.', tone: 'warn' };
  change(() => { session.editingIndex = i; session.current = [...session.captured[i].labels]; });
  const how = listening() ? 'Play or say what to change, then say “next” or clap.' : 'Say or tap what to change, then Lock chord.';
  return { text: `Editing chord ${i + 1} (${session.captured[i].chord.short}). ${how}` };
}

// --- Teaching notes ---

// The pan note a spoken note means, for a heard frequency: a given octave or
// low/high, else whichever octave is nearest the sound
function noteForSound(note, freq) {
  const options = panMatches(note);
  if (!options.length) return null;
  if (note.qual) return pickBy(options, note.qual);
  if (!freq || options.length === 1) return options[0];
  const cents = o => Math.abs(Math.log2(freq / (440 * 2 ** ((o.midi - 69) / 12))));
  return [...options].sort((a, b) => cents(a) - cents(b))[0];
}

function doCorrect(action) {
  const note = action.notes[0];
  const last = getLastSound();
  const nowMs = (getAudioCtx()?.currentTime ?? 0) * 1000;
  if (!last || nowMs - last.at > CORRECT_WITHIN_MS) {
    return startTeach(note);
  }
  const pick = noteForSound(note, last.freq);
  if (!pick) return { text: `There's no ${say(note)} on your ${getSelectedScaleName() || 'pan'}.`, tone: 'warn' };
  teachSound(pick.label, last.freq);
  // Put the chord right too: the misheard note becomes this one
  if (state.mode !== 'live' && listening()) {
    change(() => {
      const wrong = last.label ? normLabel(last.label) : null;
      if (wrong && wrong !== pick.label) session.current = session.current.filter(l => l !== wrong);
      if (!session.current.includes(pick.label)) session.current.push(pick.label);
    });
  }
  const before = last.label ? ` (I heard ${labelName(normLabel(last.label))})` : '';
  return { text: `Learned: that sound is ${noteName(pick.name)}${before}. I'll hear it that way on this scale from now on.` };
}

function startTeach(note = null) {
  if (!listening()) return { text: 'Turn on the mic first, then teach me the note.', tone: 'warn' };
  if (state.mode !== 'capture') return { text: `Stop ${state.mode === 'live' ? 'live mode' : 'recording'} first.`, tone: 'warn' };
  const pick = note ? noteForSound(note, null) : null;
  if (note && !pick) return { text: `There's no ${say(note)} on your ${getSelectedScaleName() || 'pan'}.`, tone: 'warn' };
  // "teach D" on a pan with two Ds: tap the right one
  const ambiguous = note && note.octave == null && !note.qual && panMatches(note).length > 1;
  setTask({ kind: 'teach', label: ambiguous ? null : pick?.label || null, freqs: [] });
  renderMode();
  const { label } = teaching();
  if (!label) return { text: ambiguous ? `Tap the ${say(note)} you mean on the pan, then strike it ${TEACH_STRIKES} times.` : `Tap the note on the pan, then strike it ${TEACH_STRIKES} times.`, tone: 'ask' };
  return { text: `Strike ${labelName(label)} ${TEACH_STRIKES} times.`, tone: 'ask' };
}

function stopTeach() {
  if (teaching()) setTask(null);
  renderMode();
}

function onTeachSound(sound) {
  const task = teaching();
  if (!task?.label) return;
  task.freqs.push(sound.freq);
  if (task.freqs.length < TEACH_STRIKES) {
    reply(`${task.freqs.length} of ${TEACH_STRIKES}… strike ${labelName(task.label)} again.`, { tone: 'ask' });
    renderMode();
    return;
  }
  const sorted = [...task.freqs].sort((a, b) => a - b);
  if (sorted.at(-1) / sorted[0] > TEACH_MAX_SPREAD) {
    task.freqs = [];
    reply(`Those strikes didn't sound alike. Strike ${labelName(task.label)} ${TEACH_STRIKES} more times, letting each ring.`, { tone: 'warn' });
    renderMode();
    return;
  }
  teachSound(task.label, sorted[1]);
  setTask(null);
  renderMode();
  reply(`Learned ${labelName(task.label)}. I'll recognise it on this scale from now on.`);
}

// Tapping a note puts it in the chord or takes it out (or picks the note for a task)
function onPanTap(e) {
  const key = e.target.closest?.('[data-note]')?.dataset.note;
  if (!key) return;
  if (soundsOpen()) {
    const take = currentTake();
    if (!take || take.phase === 'review') startTake(key);
    return;
  }
  const task = teaching();
  if (task) {
    task.label = key;
    task.freqs = [];
    renderMode();
    reply(`Strike ${labelName(key)} ${TEACH_STRIKES} times.`, { tone: 'ask' });
    return;
  }
  if (state.mode !== 'capture') return;
  const had = session.current.includes(key);
  change(() => { session.current = had ? session.current.filter(l => l !== key) : [...session.current, key]; });
  reply(`${had ? 'Removed' : 'Added'} ${labelName(key)}.`);
}

function doForget(action) {
  if (!action.notes.length) {
    const n = taughtSoundCount();
    if (!n) return { text: 'Nothing taught on this scale yet.' };
    forgetTaughtSounds();
    return { text: `Forgot all ${n} taught sound${n === 1 ? '' : 's'} on this scale.` };
  }
  const labels = action.notes.flatMap(n => panMatches(n).map(o => o.label));
  const n = labels.reduce((sum, l) => sum + taughtSoundCount(l), 0);
  if (!n) return { text: `Nothing taught for ${action.notes.map(say).join(' or ')}.` };
  labels.forEach(l => forgetTaughtSounds(l));
  return { text: `Forgot what you taught me for ${action.notes.map(say).join(' and ')}.` };
}

const HELP = 'Try: “remove the G”, “add F sharp”, “remove the lower D”, “next chord”, “replace the third chord”, “clear the second chord”, “go live”, “undo”, “start over”. Misheard a note? Say “that was a G”.';

function runAction(action) {
  // Teaching and a note named: that's the note being taught
  if (teaching() && !teaching().label && (action.type === 'add' || action.type === 'teach') && action.notes?.[0]) {
    return startTeach(action.notes[0]);
  }
  switch (action.type) {
    case 'add': return doAdd(action);
    case 'remove': return doRemove(action);
    case 'removeOctave': return doRemoveOctave(action);
    case 'set': return doSet(action);
    case 'swap': return doSwap(action);
    case 'shift': return doShift(action);
    case 'resolve': return doResolve(action);
    case 'next': return doNext();
    case 'deleteChord':
    case 'replaceChord':
    case 'editChord': return doChordCommand(action);
    case 'clearChord': {
      if (state.mode === 'live') return { text: 'Stop live mode first, then edit.', tone: 'warn' };
      if (!session.current.length) return { text: 'This chord is already empty.' };
      change(() => { session.current = []; });
      return { text: 'Cleared this chord.' };
    }
    case 'clearAll': {
      if (!session.captured.length && !session.current.length && !session.live) return { text: 'Already empty.' };
      clearAll();
      return { text: 'Started over. Say “undo” to bring it all back.' };
    }
    case 'live':
      if (state.mode === 'live') return { text: 'Already live.' };
      startLive();
      return { text: 'Live: play your progression in time.' };
    case 'stop':
      if (session.recording) return stopRecord();
      if (state.input === 'clip' && clipAudio && !clipAudio.paused) { clipAudio.pause(); return { text: 'Paused.' }; }
      if (teaching()) { stopTeach(); return { text: 'Stopped teaching.' }; }
      if (state.mode === 'live') { stopLive(); return { text: 'Stopped. Here’s your progression.' }; }
      stopMic();
      return { text: 'Stopped listening.' };
    case 'micOff':
      stopMic();
      return { text: 'Stopped listening.' };
    case 'undo':
      return undo() ? { text: 'Undone.' } : { text: 'Nothing to undo.', tone: 'warn' };
    case 'play': {
      const i = action.chord ? chordIndex(action.chord) : null;
      const entry = i != null ? session.captured[i] : null;
      const chord = entry ? entry.chord : session.current.length ? describeChord(session.current) : session.captured.at(-1)?.chord;
      if (!chord) return { text: 'Nothing to play yet.', tone: 'warn' };
      playChord(chord);
      return { text: `Playing ${chord.short}.` };
    }
    case 'help': return { text: HELP };
    case 'correct': return doCorrect(action);
    case 'teach': return startTeach(action.notes[0] || null);
    case 'forget': return doForget(action);
    case 'record':
      startRecord().then(r => r && reply(r.text, { tone: r.tone }));
      return { text: 'Starting to record…' };
    case 'recordStop': return stopRecord() || { text: 'Not recording.' };
    default: return null;
  }
}

// The first reading of what was said that makes sense wins
function onVoiceFinal(alternatives) {
  settleVoice();
  for (const text of alternatives) {
    let actions = parseVoiceCommand(text);
    if (!actions.length) continue;
    // A bare note answers "which note?" ("the D"); a bare octave word answers "which one?"
    if (pending && actions.length === 1 && actions[0].type === 'add' && actions[0].bare && pending.kind === 'removeOctave') {
      actions = [{ type: 'resolve', note: actions[0].notes[0] }];
    }
    if (!pending && actions.every(a => a.type === 'resolve')) continue;
    if (actions.some(a => a.type !== 'resolve')) pending = null;
    const replies = actions.map(runAction).filter(Boolean);
    if (!replies.length) continue;
    const last = replies.at(-1);
    reply(replies.map(r => r.text).join(' '), { heard: text, tone: replies.some(r => r.tone === 'warn') ? 'warn' : last.tone || 'ok' });
    return;
  }
  if (alternatives[0]) reply('Didn’t catch a command. Say “help” for ideas.', { heard: alternatives[0], tone: 'warn' });
}

// Talking: the mic's notes and claps since just before were the voice; undo them
function onVoiceSpeech() {
  session.voiceBusy = true;
  clearTimeout(voiceSettleTimer);
  const cutoff = performance.now() - SPEECH_LOOKBACK_MS;
  let k = session.undoStack.length;
  while (k > 0 && session.undoStack[k - 1].audio && session.undoStack[k - 1].at >= cutoff) k--;
  if (k < session.undoStack.length) {
    const { snap } = session.undoStack[k];
    session.undoStack.length = k;
    restore(snap);
  }
  els.voice.classList.add('listening');
}

function settleVoice() {
  clearTimeout(voiceSettleTimer);
  voiceSettleTimer = setTimeout(() => {
    session.voiceBusy = false;
    els.voice.classList.remove('listening');
  }, SPEECH_SETTLE_MS);
}

function beginVoice() {
  startVoice({
    onSpeech: onVoiceSpeech,
    onInterim: (text) => {
      els.voiceHeard.textContent = `“${text}”`;
      els.voiceReply.textContent = '';
      els.voice.classList.add('show');
      // A final result normally ends this; don't stay deaf if it never comes
      clearTimeout(voiceSettleTimer);
      voiceSettleTimer = setTimeout(settleVoice, SPEECH_STALL_MS);
    },
    onFinal: onVoiceFinal,
    onIdle: settleVoice,
    onError: code => {
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        prefs.voice = false;
        renderMode();
        reply('Voice commands are blocked in this browser’s settings.', { tone: 'warn' });
      }
    },
  });
}

// Note names on the big pan ("C4"), so there's something to say: "remove G4"
function applyNoteNames() {
  setChordShapeLabels(els.bigDiagram, prefs.names ? (key => {
    const note = labelToNote(key);
    return note ? noteName(note) : '';
  }) : null);
  renderCurrent();
  markNoteAudio(); // the redraw dropped the marks
  els.namesBtn.classList.toggle('on', prefs.names);
  els.namesBtn.setAttribute('aria-pressed', String(prefs.names));
  els.namesBtn.querySelector('.cl-voice-state').textContent = prefs.names ? 'on' : 'off';
}

function setNamesOn(on) {
  prefs.names = on;
  try { localStorage.setItem(NAMES_KEY, on ? '1' : '0'); } catch { /* private mode */ }
  applyNoteNames();
}

function setVoiceOn(on) {
  prefs.voice = on;
  try { localStorage.setItem(VOICE_KEY, on ? '1' : '0'); } catch { /* private mode */ }
  if (on && listening()) beginVoice();
  if (!on) { stopVoice(); session.voiceBusy = false; }
  renderMode();
  reply(on ? HELP : 'Voice commands off.');
}

// --- Record a Clip ---

function formatTime(secs) {
  const s = Math.max(0, Math.floor(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

async function startRecord() {
  if (session.recording) return { text: 'Already recording.' };
  if (!currentUser) {
    openAuthModal();
    return { text: 'Sign in to save recordings to your Clips.', tone: 'warn' };
  }
  if (state.input === 'clip') closeClip();
  if (state.mode === 'live') stopLive();
  if (state.task) setTask(null);
  if (!listening()) await startMic();
  if (!listening()) return { text: 'The mic is needed to record.', tone: 'warn' };
  const startedAt = Date.now();
  // The same stream the pan is heard on: one mic, no echo cancellation or gain games
  const ok = await startRawAudioRecording(blob => saveRecording(blob, startedAt), { stream: getMicStream() });
  if (!ok) return { text: 'Couldn’t start recording.', tone: 'warn' };
  session.savedClip = null;
  session.recording = {
    startedAt,
    timer: setInterval(() => {
      const secs = (Date.now() - startedAt) / 1000;
      if (secs >= RECORD_MAX_SECS) {
        stopRecord();
        reply('Stopped at 25 minutes, the most one clip can hold.', { tone: 'warn' });
        return;
      }
      els.stage.classList.toggle('rec-warn', secs >= RECORD_WARN_SECS);
      renderCurrent();
    }, 500),
  };
  setMode('record');
  session.current = [];
  session.editingIndex = null;
  renderMode();
  return { text: 'Recording. Just play; say “stop recording” or press Stop & save when you’re done.' };
}

function stopRecord() {
  if (!session.recording) return null;
  clearInterval(session.recording.timer);
  session.recording = null;
  setMode('capture');
  els.stage.classList.remove('rec-warn');
  stopRawAudioRecording(); // saveRecording runs once the audio is finalised
  renderMode();
  return { text: 'Saving your clip…' };
}

async function saveRecording(blob, startedAt) {
  const durationSecs = Math.round((Date.now() - startedAt) / 1000);
  const title = clipTitle(`${scaleLabel()} flow`);
  const { clip: row, error } = await uploadClip(blob, { title, durationSecs });
  if (error) {
    reply(error, { tone: 'warn' });
    return;
  }
  session.savedClip = { row, blob };
  els.savedText.textContent = `Saved “${title}” to your Clips.`;
  renderMode();
  reply('Saved to your Clips. Build the notation now, or any time from Library → Clips.');
}

// --- Build from a Clip ---

async function openClip(row, blob = null) {
  if (session.recording) stopRecord();
  if (listening()) stopMic();
  unlockAudio();
  reply(`Loading “${row.title}”…`);
  const audioBlob = blob || await fetchClipBlob(row);
  if (!audioBlob) {
    reply('Couldn’t load that clip. Check your connection and try again.', { tone: 'warn' });
    return;
  }
  closeClip({ quiet: true });
  if (!clipAudio) {
    clipAudio = new Audio();
    clipAudio.preload = 'auto';
    ['timeupdate', 'loadedmetadata', 'play', 'pause'].forEach(ev => clipAudio.addEventListener(ev, renderClipTime));
    clipAudio.addEventListener('ended', onClipEnded);
  }
  session.clip = { row, blob: audioBlob, url: URL.createObjectURL(audioBlob) };
  clipAudio.src = session.clip.url;
  const ok = await startListeningToClip(clipAudio, { onNote, onCue, onLevel, onSound });
  if (!ok) {
    reply('Couldn’t open the clip for listening.', { tone: 'warn' });
    return;
  }
  await loadCalibrationProfile();
  setInput('clip');
  session.savedClip = null;
  session.current = [];
  els.clipTitle.textContent = row.title;
  renderAll();
  renderClipTime();
  reply('Press play. I’ll follow the chords as they change.');
}

function closeClip({ quiet = false } = {}) {
  if (!session.clip) return;
  clipAudio?.pause();
  if (state.mode === 'live') stopLive();
  stopListening();
  URL.revokeObjectURL(session.clip.url);
  session.clip = null;
  setInput('off');
  if (!quiet) renderAll();
}

function toggleClipPlay() {
  if (!clipAudio || !session.clip) return;
  if (!clipAudio.paused) {
    clipAudio.pause();
    return;
  }
  unlockAudio();
  // A flowing recording has no claps to lock chords with: follow it live
  if (state.mode === 'capture' && !session.current.length && clipAudio.currentTime < 0.5) startLive();
  clipAudio.play();
}

function onClipEnded() {
  if (state.mode === 'live') stopLive();
  renderClipTime();
  const n = session.live?.changes.length || 0;
  reply(n
    ? `Done: ${n} chord change${n === 1 ? '' : 's'}. Send it to the Studio or the Song Builder, or fix chords by voice.`
    : 'Done. No chord changes heard; try Capture and pause on each chord.');
}

function renderClipTime() {
  if (!clipAudio || !els.clipTime) return;
  const dur = Number.isFinite(clipAudio.duration) ? clipAudio.duration : (session.clip?.row.duration_secs || 0);
  els.clipTime.textContent = `${formatTime(clipAudio.currentTime)} / ${formatTime(dur)}`;
  els.clipSeek.max = String(dur || 0);
  els.clipSeek.value = String(clipAudio.currentTime);
  const playing = !clipAudio.paused;
  els.clipPlay.classList.toggle('playing', playing);
  els.clipPlay.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  els.clipPlay.innerHTML = playing
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"></rect><rect x="14" y="5" width="4" height="14" rx="1"></rect></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"></path></svg>';
}

// Every note, not just chords: Free record's offline transcription of the clip
function transcribeNotes(target = session.clip || session.savedClip) {
  if (!target) return;
  const { blob } = target;
  const name = target.row.title;
  if (session.clip) closeClip();
  navigate('studio');
  setTimeout(() => openFreeRecordWithAudio(blob, name), 60);
}

// --- Note sounds (a custom handpan's own recorded notes) ---

function ownHandpan() {
  const hp = getActiveCustomHandpan();
  return hp && currentUser && hp.user_id === currentUser.id ? hp : null;
}

const hasNoteAudio = label => !!getScale()?.audioOverrides?.[label];

function panLabels() {
  const scale = getScale();
  return scale ? ['Ding', ...Object.keys(scale.map || {})] : [];
}

function setSoundsOn(on) {
  if (on && !ownHandpan()) return;
  cancelTake();
  if (on) {
    if (state.mode === 'live') stopLive();
    if (session.recording) stopRecord();
    setTask({ kind: 'sounds', take: null });
  } else if (soundsOpen()) {
    setTask(null);
  }
  renderMode();
  if (on) reply('Tap a note to record its sound. Strike it once and let it ring.');
}

// The note being recorded lives on the sounds task, so it can't outlast it
function setTake(take) {
  if (soundsOpen()) state.task.take = take;
}

// Dashed outline on notes with no recording yet; the note being recorded pulses
function markNoteAudio() {
  const take = currentTake();
  els.bigDiagram.querySelectorAll('[data-note]').forEach((el) => {
    const label = el.dataset.note;
    el.classList.toggle('cl-no-audio', soundsOpen() && !hasNoteAudio(label));
    el.classList.toggle('cl-take', take?.label === label);
  });
}

function renderSounds() {
  setVisible(els.soundsBar, soundsOpen());
  els.soundsBtn.hidden = !ownHandpan();
  els.soundsBtn.classList.toggle('on', soundsOpen());
  els.soundsBtn.setAttribute('aria-pressed', String(soundsOpen()));
  markNoteAudio();
  if (!soundsOpen()) return;
  const take = currentTake();
  const labels = panLabels();
  const missing = labels.filter(l => !hasNoteAudio(l));
  const name = take ? labelName(take.label) : '';
  let text;
  let actions = '';
  if (!take) {
    text = missing.length
      ? `Tap a note to record its sound. ${labels.length - missing.length} of ${labels.length} recorded; missing ${listText(byPitch(missing).map(labelName))}.`
      : `All ${labels.length} notes have their own sound. Tap one to record it again.`;
    actions = '<button type="button" class="cl-btn" data-take="done">Done</button>';
  } else if (take.phase === 'waiting') {
    text = `Strike ${name} once and let it ring…`;
    actions = '<button type="button" class="cl-btn" data-take="cancel">Cancel</button>';
  } else if (take.phase === 'recording') {
    const left = Math.max(0, Math.ceil((TAKE_MS - (performance.now() - take.onsetAt)) / 1000));
    text = `Recording ${name}… stay quiet (${left})`;
    actions = '<button type="button" class="cl-btn" data-take="cancel">Cancel</button>';
  } else if (take.phase === 'review') {
    const other = [...take.heard].filter(l => l !== take.label);
    const doubt = other.length && !take.heard.has(take.label) ? ` That sounded like ${listText(other.map(labelName))}; check it's ${name}.` : '';
    text = `${name} recorded.${doubt}`;
    actions = `
      <button type="button" class="cl-btn" data-take="play">▶ Listen</button>
      <button type="button" class="cl-btn" data-take="again">Re-record</button>
      <button type="button" class="cl-btn cl-primary" data-take="save">Save</button>
      <button type="button" class="cl-btn" data-take="cancel">Cancel</button>`;
  } else {
    text = `Saving ${name}…`;
  }
  els.soundsText.textContent = text;
  const phase = take?.phase || 'idle';
  if (els.soundsActions.dataset.phase !== phase) {
    els.soundsActions.innerHTML = actions;
    els.soundsActions.dataset.phase = phase;
  }
}

async function startTake(label) {
  cancelTake();
  if (state.input === 'clip') closeClip();
  if (!listening()) await startMic();
  const stream = getMicStream();
  if (!stream || !soundsOpen()) return;
  const mimeType = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
  const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 256000 });
  const take = { label, phase: 'waiting', recorder, chunks: [], startedAt: performance.now(), onsetAt: 0, timer: null, blob: null, url: null, heard: new Set() };
  recorder.ondataavailable = (e) => { if (e.data.size) take.chunks.push(e.data); };
  recorder.start();
  take.timer = setInterval(tickTake, 250);
  setTake(take);
  renderMode();
}

function startTakeCountdown() {
  const take = currentTake();
  take.phase = 'recording';
  take.onsetAt = performance.now();
  take.heard.clear();
  renderMode();
}

function tickTake() {
  const take = currentTake();
  if (!take) return;
  const now = performance.now();
  if (take.phase === 'waiting' && now - take.startedAt > TAKE_WAIT_MS) {
    cancelTake();
    reply('Didn’t hear a strike. Tap the note to try again.', { tone: 'warn' });
    renderMode();
    return;
  }
  if (take.phase === 'recording' && now - take.onsetAt >= TAKE_MS) {
    finishTake();
    return;
  }
  renderSounds();
}

function finishTake() {
  const take = currentTake();
  clearInterval(take.timer);
  take.phase = 'processing';
  take.recorder.onstop = async () => {
    if (currentTake() !== take) return;
    try {
      const raw = new Blob(take.chunks, { type: take.recorder.mimeType || 'audio/webm' });
      take.blob = await trimLeadIn(raw, getAudioCtx());
      take.url = URL.createObjectURL(take.blob);
      take.phase = 'review';
    } catch (err) {
      console.error('Note sound processing failed', err);
      setTake(null);
      reply('That recording didn’t come through. Tap the note to try again.', { tone: 'warn' });
    }
    renderMode();
  };
  take.recorder.stop();
  renderMode();
}

function cancelTake() {
  const take = currentTake();
  if (!take) return;
  clearInterval(take.timer);
  if (take.recorder.state !== 'inactive') {
    take.recorder.onstop = null;
    take.recorder.stop();
  }
  if (take.url) URL.revokeObjectURL(take.url);
  setTake(null);
}

async function saveTake() {
  const take = currentTake();
  const hp = ownHandpan();
  if (!take?.blob || !hp) return;
  take.phase = 'saving';
  renderMode();
  try {
    const name = labelToNote(take.label);
    const parsed = parseNoteName(name);
    const path = await uploadNoteAudio(hp, { note: pitchName(name), octave: parsed.octave }, take.blob);
    const noteMap = await setNoteAudio(hp.id, take.label, path);
    updateCustomHandpanNoteMap(hp.id, noteMap);
    await reloadLabelSample(take.label);
    if (take.label === 'Ding') await reloadLabelSample('D');
    reply(`Saved ${labelName(take.label)}'s sound. It plays your own pan now.`);
  } catch (err) {
    console.error('Saving note sound failed', err);
    reply('Couldn’t save that sound. Check your connection and try again.', { tone: 'warn' });
  }
  if (currentTake() === take) {
    URL.revokeObjectURL(take.url);
    setTake(null);
  }
  renderMode();
}

function onTakeAction(e) {
  const action = e.target.closest('[data-take]')?.dataset.take;
  if (!action) return;
  const take = currentTake();
  if (action === 'done') setSoundsOn(false);
  else if (action === 'cancel') { cancelTake(); renderMode(); }
  else if (action === 'again' && take) startTake(take.label);
  else if (action === 'save') saveTake();
  else if (action === 'play' && take?.url) new Audio(take.url).play();
}

// --- Results ---

// Live order with each chord repeated per bar when heard live; else capture order
function resultChords() {
  if (session.live?.changes.length) {
    const beats = chordLengths(session.live);
    const perBar = session.live.perBar || 4;
    return session.live.changes.flatMap((c, i) => {
      const bars = beats[i] ? Math.max(1, Math.round(beats[i] / perBar)) : 1;
      return Array(bars).fill(session.live.candidates[c.idx].chord);
    });
  }
  return session.captured.map(e => e.chord);
}

function clearAll() {
  if (state.mode === 'live') stopLive();
  change(() => {
    session.captured = [];
    session.current = [];
    session.live = null;
    session.editingIndex = null;
    els.progression.replaceChildren();
  });
}

function sendToSongBuilder() {
  const chords = session.live?.changes.length ? session.live.changes.map(c => session.live.candidates[c.idx].chord) : session.captured.map(e => e.chord);
  if (!chords.length) return;
  stopMic();
  appendHeardChords(chords);
  navigate('studio');
  setTimeout(openChordPanel, 50);
}

async function sendToStudio() {
  const chords = resultChords();
  if (!chords.length) return;
  stopMic();
  navigate('studio');
  const sent = await sendChordsToStudio(chords, `Heard ${chords.slice(0, 4).map(c => c.short).join(' ')}`);
  if (sent && session.live?.bpm) gridA.setBpm(session.live.bpm);
}

// --- View ---

function build() {
  view.innerHTML = `
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

  const q = s => view.querySelector(s);
  els = {
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
  };
  els.bigDiagram = diagram([], 'cl-big');
  q('.cl-big-wrap').prepend(els.bigDiagram);

  q('.cl-back').addEventListener('click', () => (window.history.length > 1 ? window.history.back() : navigate('studio')));
  els.micBtn.addEventListener('click', () => (listening() ? stopMic() : startMic()));
  els.lockBtn.addEventListener('click', () => { flashCue('single'); lockChord(); });
  els.voiceBtn.addEventListener('click', () => setVoiceOn(!prefs.voice));
  els.recordBtn.addEventListener('click', async () => {
    const r = session.recording ? stopRecord() : await startRecord();
    if (r) reply(r.text, { tone: r.tone });
  });
  els.clipPlay.addEventListener('click', toggleClipPlay);
  els.clipSeek.addEventListener('input', () => { if (clipAudio) clipAudio.currentTime = Number(els.clipSeek.value); });
  q('.cl-clip-close').addEventListener('click', () => closeClip());
  q('.cl-saved-build').addEventListener('click', () => session.savedClip && openClip(session.savedClip.row, session.savedClip.blob));
  els.savedTranscribe.addEventListener('click', () => transcribeNotes(session.savedClip));
  els.transcribeBtn.addEventListener('click', () => transcribeNotes());
  q('.cl-saved-open').addEventListener('click', () => {
    navigate('library');
    setTimeout(() => Bus.emit(BUS_EVENT.OPEN_LIBRARY_TAB, { tab: 'clips' }), 0);
  });
  els.namesBtn.addEventListener('click', () => setNamesOn(!prefs.names));
  els.soundsBtn.addEventListener('click', () => setSoundsOn(!soundsOpen()));
  els.soundsActions.addEventListener('click', onTakeAction);
  els.multiBtn.addEventListener('click', () => {
    prefs.multi = !prefs.multi;
    try { localStorage.setItem(MULTI_KEY, prefs.multi ? '1' : '0'); } catch { /* private mode */ }
    setMultiNote(prefs.multi);
    renderMode();
    reply(prefs.multi
      ? 'Multi-note on: every note heard in a strike counts, octaves included.'
      : 'Multi-note off: only the strongest note in each strike counts.');
  });
  els.teachBtn.addEventListener('click', () => {
    if (teaching()) { stopTeach(); return; }
    const r = startTeach();
    reply(r.text, { tone: r.tone });
  });
  q('.cl-teach-cancel').addEventListener('click', stopTeach);
  els.bigDiagram.addEventListener('click', onPanTap);
  els.liveBtn.addEventListener('click', () => (state.mode === 'live' ? stopLive() : startLive()));
  els.undoBtn.addEventListener('click', undo);
  els.clearBtn.addEventListener('click', clearAll);
  els.toSongBtn.addEventListener('click', sendToSongBuilder);
  els.toStudioBtn.addEventListener('click', sendToStudio);
  const scaleSelect = q('.cl-scale-select');
  scaleSelect.addEventListener('pointerdown', syncScaleSelect); // custom handpans may have loaded since
  scaleSelect.addEventListener('focus', syncScaleSelect);
  scaleSelect.addEventListener('change', () => pickScale(scaleSelect.value));
}

// --- Scale ---

// The Studio's own scale list (system scales and the player's custom handpans)
function syncScaleSelect() {
  const main = document.getElementById('scaleSelect');
  const select = view.querySelector('.cl-scale-select');
  if (!main || !select) return;
  if (select.innerHTML !== main.innerHTML) select.innerHTML = main.innerHTML;
  select.value = main.value;
}

function pickScale(value) {
  const main = document.getElementById('scaleSelect');
  if (!main || main.value === value) return;
  main.value = value;
  main.dispatchEvent(new Event('change')); // handpanmap.js applies it, then SCALE_APPLIED
}

// The pan changed under us (picked here, in the Studio, or restored on load):
// redraw, reload what was taught for it, and drop chords from the old pan
async function onScaleApplied() {
  if (!view.firstElementChild) return;
  const name = getSelectedScaleName();
  const hasChords = session.captured.length || session.current.length || session.live;
  if (sessionScale && name !== sessionScale && hasChords) {
    if (state.mode === 'live') stopLive();
    change(() => {
      session.captured = [];
      session.current = [];
      session.live = null;
      session.editingIndex = null;
      els.progression.replaceChildren();
    });
    reply(`Switched to ${scaleLabel()}. Those chords were on the other pan, so this is a fresh start (Undo brings them back).`);
  }
  sessionScale = name;
  if (teaching()) setTask(null);
  if (soundsOpen() && !ownHandpan()) setSoundsOn(false);
  pending = null;
  if (listening()) await loadCalibrationProfile();
  refreshScaleView();
}

function scaleLabel() {
  const main = document.getElementById('scaleSelect');
  return main?.options[main.selectedIndex]?.textContent?.trim() || getSelectedScaleName() || 'this scale';
}

function refreshScaleView() {
  if (!view.firstElementChild) return;
  syncScaleSelect();
  applyNoteNames();
  renderCaptured();
  renderLive();
  renderMode();
}

function onEnter() {
  if (!view.firstElementChild) build();
  if (pendingClip) {
    const row = pendingClip;
    pendingClip = null;
    setTimeout(() => openClip(row), 0);
  }
  sessionScale ??= getSelectedScaleName();
  // The pan or scale may have changed: redraw the shape and its note names
  syncScaleSelect();
  applyNoteNames();
  renderCaptured();
  renderLive();
  renderMode();
}

export function initChordListen() {
  view = document.getElementById('view-listen');
  if (!view) return;
  try { prefs.voice = voiceSupported() && localStorage.getItem(VOICE_KEY) !== '0'; } catch { prefs.voice = voiceSupported(); }
  try { prefs.names = localStorage.getItem(NAMES_KEY) !== '0'; } catch { prefs.names = true; }
  try { prefs.multi = localStorage.getItem(MULTI_KEY) === '1'; } catch { prefs.multi = false; }
  setMultiNote(prefs.multi);
  addEventListener('routeChanged', (e) => {
    if (e.detail.route === 'listen') onEnter();
    else if (listening() || session.recording) stopMic(); // a recording in progress is saved
  });
  // The saved scale arrives after load (and again after sign-in); follow it.
  // Deferred a tick: custom handpans set their name just after their notes.
  Bus.on(BUS_EVENT.SCALE_APPLIED, () => setTimeout(onScaleApplied, 0));
  Bus.on(BUS_EVENT.OPEN_CLIP_IN_LISTEN, (e) => {
    pendingClip = e.detail?.clip || null;
    if (document.body.classList.contains('route-listen')) onEnter();
  });
  onChordShapeLayout(() => { if (view.firstElementChild) applyNoteNames(); });
  if (document.body.classList.contains('route-listen')) onEnter();
}
