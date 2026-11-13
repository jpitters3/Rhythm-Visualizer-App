// Chord listen (route #listen): play chords, and the app writes them down.
// Capture: play a chord's notes one at a time; a clap or snap locks it in and
// starts the next. A double clap goes live: play the progression in time and
// the app follows the chords, working out tempo, pulse and time signature.
// Everything can also be said out loud: "remove the G", "add F sharp",
// "next chord", "replace the third chord", "start over" (js/voice-commands.js).
// Record saves the raw audio as a Clip (Library → Clips) to just flow; a clip can
// come back here later and be listened to like the mic, to build its notation.
import { clipsFeature, closeClip, openClip, seekClip, startRecord, stopRecord, toggleClipPlay, transcribeNotes } from './listen-clips.js';
import { setMultiNote } from './listen-engine.js';
import { labelName, scaleLabel } from './listen-notes.js';
import { change, clearAll, editChordAt, lockChord, playChord, sendToSongBuilder, sendToStudio, startLive, startMic, stopLive, stopMic, undo } from './listen-play.js';
import { onTakeAction, ownHandpan, setSoundsOn, soundsFeature, startTake } from './listen-sounds.js';
import { currentTake, features, listening, prefs, session, setTask, soundsOpen, state, teaching } from './listen-state.js';
import { TEACH_STRIKES, startTeach, stopTeach, teachFeature } from './listen-teach.js';
import { applyNoteNames, build, cardActions, els, flashCue, renderCaptured, renderLive, renderMode, reply } from './listen-view.js';
import { VOICE_KEY, resetPending, setVoiceOn, voiceFeature } from './listen-voice.js';
import { BUS_EVENT, Bus } from './bus.js';
import { onChordShapeLayout } from './chord-shape-diagram.js';
import { navigate } from './router.js';
import { getSelectedScaleName } from './state.js';
import { loadCalibrationProfile } from './transcription.js';
import { voiceSupported } from './voice-listener.js';

const NAMES_KEY = 'gp_listenNoteNames';

const MULTI_KEY = 'gp_listenMultiNote';

let sessionScale = null; // the scale the chords on screen were played on

let pendingClip = null; // asked for from the Library before the view was ready

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

function setNamesOn(on) {
  prefs.names = on;
  try { localStorage.setItem(NAMES_KEY, on ? '1' : '0'); } catch { /* private mode */ }
  applyNoteNames();
}

// The page's controls, once it's built
function wire() {
  els.back.addEventListener('click', () => (window.history.length > 1 ? window.history.back() : navigate('studio')));
  els.micBtn.addEventListener('click', () => (listening() ? stopMic() : startMic()));
  els.lockBtn.addEventListener('click', () => { flashCue('single'); lockChord(); });
  els.voiceBtn.addEventListener('click', () => setVoiceOn(!prefs.voice));
  els.recordBtn.addEventListener('click', async () => {
    const r = session.recording ? stopRecord() : await startRecord();
    if (r) reply(r.text, { tone: r.tone });
  });
  els.clipPlay.addEventListener('click', toggleClipPlay);
  els.clipSeek.addEventListener('input', () => seekClip(Number(els.clipSeek.value)));
  els.clipClose.addEventListener('click', () => closeClip());
  els.savedBuild.addEventListener('click', () => session.savedClip && openClip(session.savedClip.row, session.savedClip.blob));
  els.savedTranscribe.addEventListener('click', () => transcribeNotes(session.savedClip));
  els.transcribeBtn.addEventListener('click', () => transcribeNotes());
  els.savedOpen.addEventListener('click', () => {
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
  els.teachCancel.addEventListener('click', stopTeach);
  els.bigDiagram.addEventListener('click', onPanTap);
  els.liveBtn.addEventListener('click', () => (state.mode === 'live' ? stopLive() : startLive()));
  els.undoBtn.addEventListener('click', undo);
  els.clearBtn.addEventListener('click', clearAll);
  els.toSongBtn.addEventListener('click', sendToSongBuilder);
  els.toStudioBtn.addEventListener('click', sendToStudio);
  const { scaleSelect } = els;
  scaleSelect.addEventListener('pointerdown', syncScaleSelect); // custom handpans may have loaded since
  scaleSelect.addEventListener('focus', syncScaleSelect);
  scaleSelect.addEventListener('change', () => pickScale(scaleSelect.value));
}

// The Studio's own scale list (system scales and the player's custom handpans)
function syncScaleSelect() {
  const main = document.getElementById('scaleSelect');
  const select = els.view.querySelector('.cl-scale-select');
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
  if (!els.view.firstElementChild) return;
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
  resetPending();
  if (listening()) await loadCalibrationProfile();
  refreshScaleView();
}

function refreshScaleView() {
  if (!els.view.firstElementChild) return;
  syncScaleSelect();
  applyNoteNames();
  renderCaptured();
  renderLive();
  renderMode();
}

function onEnter() {
  if (!els.view.firstElementChild) {
    build();
    wire();
  }
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
  els.view = document.getElementById('view-listen');
  if (!els.view) return;
  features.push(voiceFeature, teachFeature, soundsFeature, clipsFeature);
  cardActions.play = playChord;
  cardActions.edit = (i) => {
    const r = editChordAt(i);
    reply(r.text, { tone: r.tone });
    els.stage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
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
  onChordShapeLayout(() => { if (els.view.firstElementChild) applyNoteNames(); });
  if (document.body.classList.contains('route-listen')) onEnter();
}
