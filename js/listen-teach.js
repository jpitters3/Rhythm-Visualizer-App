// Chord listen: teaching the app what a note sounds like on this pan
// ("that was a G", Teach a note, "forget the G").
import { getLastSound } from './listen-engine.js';
import { labelName, normLabel, noteName, panMatches, pickBy, say } from './listen-notes.js';
import { change } from './listen-play.js';
import { currentTake, listening, session, setTask, state, teaching } from './listen-state.js';
import { els, renderMode, reply } from './listen-view.js';
import { setVisible } from './dom.js';
import { getAudioCtx } from './noteplayer.js';
import { getSelectedScaleName } from './state.js';
import { forgetTaughtSounds, taughtSoundCount, teachSound } from './transcription.js';

export const TEACH_STRIKES = 3;

const TEACH_MAX_SPREAD = 1.04; // strikes further apart than this weren't the same sound

const CORRECT_WITHIN_MS = 20000;

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

export function doCorrect(action) {
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

export function startTeach(note = null) {
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

function renderTeach() {
  const task = teaching();
  els.view.toggleAttribute('data-teach', !!task);
  setVisible(els.teachBar, !!task);
  if (task) {
    els.teachText.textContent = task.label
      ? `Teaching ${labelName(task.label)}: strike it ${TEACH_STRIKES} times (${task.freqs.length}/${TEACH_STRIKES})`
      : 'Tap the note you want to teach';
  }
  els.teachBtn.disabled = !listening() || state.mode === 'live';
}

export function stopTeach() {
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

export const teachFeature = {
  onNote: () => !!teaching(), // the strikes being taught aren't chord notes
  onSound: sound => { if (teaching() && !currentTake()) onTeachSound(sound); },
  render: renderTeach,
};

export function doForget(action) {
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
