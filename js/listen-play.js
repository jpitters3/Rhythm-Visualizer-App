// Chord listen's core: the mic, capturing chords, following them live, undo,
// and sending the result on. Features hook in through `features`.
import { startListening, stopListening } from './listen-engine.js';
import { describeChord, normLabel } from './listen-notes.js';
import { each, features, listening, session, setInput, setMode, setTask, state } from './listen-state.js';
import { els, flashCue, renderAll, renderLive, renderMode } from './listen-view.js';
import { alert as showAlert } from './alert.js';
import { getScaleChordPool, notesToLabels, playChordNotes } from './chord-playback.js';
import { appendHeardChords, openChordPanel } from './chord-sidepanel.js';
import { gridA } from './grid-context.js';
import { beatMs, chordLengths, hearNote, startFollowing, stopFollowing } from './live-follower.js';
import { getAudioCtx, unlockAudio } from './noteplayer.js';
import { sendChordsToStudio } from './progression-to-grid.js';
import { navigate } from './router.js';
import { getScale } from './state.js';
import { loadCalibrationProfile } from './transcription.js';

const DOUBLE_CUE_MS = 650;

const HISTORY_MAX = 60;

const PLAYBACK_MUTE_MS = 1800; // the pan's own playback must not be heard as notes

let lastCueAt = -Infinity;

let pulseRaf = null;

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

function snapshot() {
  return {
    current: [...session.current],
    captured: session.captured.map(e => ({ labels: [...e.labels], chord: e.chord })),
    editingIndex: session.editingIndex, live: session.live, mode: state.mode,
  };
}

export function restore(snap) {
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
export function change(fn, { audio = false } = {}) {
  session.undoStack.push({ at: performance.now(), audio, snap: snapshot() });
  if (session.undoStack.length > HISTORY_MAX) session.undoStack.shift();
  fn();
  renderAll();
}

export function undo() {
  const last = session.undoStack.pop();
  if (!last) return false;
  restore(last.snap);
  return true;
}

function addNote(label) {
  if (session.current.includes(label)) return;
  change(() => session.current.push(label), { audio: true });
}

export function lockChord({ audio = false } = {}) {
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

export function startLive({ audio = false } = {}) {
  each('beforeLive');
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

export function stopLive() {
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

function audioMuted() {
  if (state.input === 'clip') return false; // talking or the pan's playback isn't in the clip
  return session.voiceBusy || performance.now() < session.muteUntil;
}

export function onSound(sound) {
  if (!audioMuted()) each('onSound', sound);
}

export function onNote(rawLabel, at) {
  if (audioMuted()) return;
  const label = normLabel(rawLabel);
  els.stage.querySelector(`.cl-big [data-note="${label}"]`)?.classList.add('just-heard');
  setTimeout(() => els.stage.querySelector(`.cl-big [data-note="${label}"]`)?.classList.remove('just-heard'), 350);
  if (features.some(f => f.onNote?.(label))) return; // a feature's, not a chord note
  if (state.mode === 'capture') addNote(label);
  else if (state.mode === 'live') liveNote(label, at);
}

export function onCue(at) {
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

export function onLevel(rms) {
  each('onLevel', rms);
  els.stage.style.setProperty('--level', Math.min(1, rms * 12).toFixed(3));
}

export async function startMic() {
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
  each('onListen');
  renderMode();
}

// Stops whatever is listening (a recording in progress is saved)
export function stopMic() {
  each('beforeStop');
  if (!listening()) { // a feature stopped it (a clip closes itself)
    renderAll();
    return;
  }
  stopListening();
  if (state.mode === 'live') stopLive();
  setInput('off');
  session.current = [];
  session.editingIndex = null;
  els.stage.style.setProperty('--level', '0');
  renderAll();
}

export function playChord(chord) {
  if (!chord) return;
  unlockAudio();
  session.muteUntil = performance.now() + PLAYBACK_MUTE_MS;
  playChordNotes(chord.notes);
}

// Opens a captured chord on the big pan: changes go to it, "next" or Lock saves it
export function editChordAt(i) {
  if (!session.captured[i]) return { text: `There's no chord ${i + 1} yet.`, tone: 'warn' };
  if (state.mode === 'live') return { text: 'Stop live mode first, then edit.', tone: 'warn' };
  change(() => { session.editingIndex = i; session.current = [...session.captured[i].labels]; });
  const how = listening() ? 'Play or say what to change, then say “next” or clap.' : 'Say or tap what to change, then Lock chord.';
  return { text: `Editing chord ${i + 1} (${session.captured[i].chord.short}). ${how}` };
}

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

export function clearAll() {
  if (state.mode === 'live') stopLive();
  change(() => {
    session.captured = [];
    session.current = [];
    session.live = null;
    session.editingIndex = null;
    els.progression.replaceChildren();
  });
}

export function sendToSongBuilder() {
  const chords = session.live?.changes.length ? session.live.changes.map(c => session.live.candidates[c.idx].chord) : session.captured.map(e => e.chord);
  if (!chords.length) return;
  stopMic();
  appendHeardChords(chords);
  navigate('studio');
  setTimeout(openChordPanel, 50);
}

export async function sendToStudio() {
  const chords = resultChords();
  if (!chords.length) return;
  stopMic();
  navigate('studio');
  const sent = await sendChordsToStudio(chords, `Heard ${chords.slice(0, 4).map(c => c.short).join(' ')}`);
  if (sent && session.live?.bpm) gridA.setBpm(session.live.bpm);
}
