// Chord listen's state: what it's doing (state, changed only through setInput /
// setMode / setTask), what's been played (session), the player's switches
// (prefs), and the hooks features plug into (features).

// What Listen is doing. Changed only through setInput / setMode / setTask, which
// refuse combinations that make no sense (recording while a clip plays,
// teaching a note mid-live…):
//   input: 'off' | 'mic' | 'clip'          where the sound comes from
//   mode:  'capture' | 'live' | 'record'   what heard notes do (record: mic only)
//   task:  null | { kind: 'teach', label, freqs } | { kind: 'sounds', take }
//          a side job, one at a time, carrying its own data
export const state = { input: 'off', mode: 'capture', task: null };

// What's been played and heard, shared by every part of Listen
export const session = {
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
export const prefs = { voice: false, names: true, multi: false };

function invalid(what) {
  throw new Error(`Chord listen: ${what} (input ${state.input}, mode ${state.mode}, task ${state.task?.kind || 'none'})`);
}

export function setInput(input) {
  state.input = input;
  if (input === 'off' || (input === 'clip' && state.mode === 'record')) state.mode = 'capture';
  if (input === 'off' && state.task?.kind === 'teach') state.task = null;
}

export function setMode(next) {
  if (next !== 'capture' && state.input === 'off') invalid(`${next} needs sound coming in`);
  if (next === 'record' && state.input !== 'mic') invalid('only the mic can be recorded');
  if (next !== 'capture' && state.task) invalid(`${next} with a ${state.task.kind} task open`);
  if ((next === 'record') !== !!session.recording) invalid('record mode and the recording must start and stop together');
  state.mode = next;
}

// task: null, { kind: 'teach', label, freqs } or { kind: 'sounds', take }
export function setTask(task) {
  if (task && state.mode !== 'capture') invalid(`a ${task.kind} task in ${state.mode} mode`);
  if (task?.kind === 'teach' && state.input === 'off') invalid('teaching needs sound coming in');
  state.task = task;
}

export const listening = () => state.input !== 'off';

export const teaching = () => (state.task?.kind === 'teach' ? state.task : null);

export const soundsOpen = () => state.task?.kind === 'sounds';

export const currentTake = () => (state.task?.kind === 'sounds' ? state.task.take : null);

// Features (voice, teaching, note sounds, clips) plug into the core through
// these hooks, so the core never has to know about them:
//   onListen()          sound has started coming in
//   onNote(label)       a note was heard; true means "mine, don't capture it"
//   onSound(sound) / onLevel(rms)
//   beforeStop()        the mic or clip is about to stop
//   beforeLive()        live mode is about to start
//   render()            draw this feature's own controls
export const features = [];

export const each = (hook, ...args) => features.forEach(f => f[hook]?.(...args));
