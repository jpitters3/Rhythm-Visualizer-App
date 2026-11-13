// Chord listen: what spoken commands do (js/voice-commands.js parses them).
import { closeTranscribe, stopTranscribing, transcribing } from './listen-transcribe.js';
import { pauseClip, startRecord, stopRecord } from './listen-clips.js';
import { byPitch, chordMatches, describeChord, labelName, labelToNote, listText, midiOf, noteName, panMatches, pickBy, say, scalePrefersFlats } from './listen-notes.js';
import { change, clearAll, editChordAt, lockChord, playChord, restore, startLive, stopLive, stopMic, undo } from './listen-play.js';
import { listening, prefs, session, state, teaching } from './listen-state.js';
import { doCorrect, doForget, startTeach, stopTeach } from './listen-teach.js';
import { els, flashCue, renderMode, reply } from './listen-view.js';
import { getSelectedScaleName } from './state.js';
import { parseNoteName, parseVoiceCommand, pcName } from './voice-commands.js';
import { startVoice, stopVoice, voiceSupported } from './voice-listener.js';

const SPEECH_LOOKBACK_MS = 1200; // notes/claps heard this long before speech was recognised were the voice

const SPEECH_SETTLE_MS = 400;

const SPEECH_STALL_MS = 1500; // no new words for this long: give the mic back to the pan

export const VOICE_KEY = 'gp_listenVoice';

let voiceSettleTimer = null;

let pending = null; // a question waiting for its answer, e.g. which D

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

// A question left open (e.g. "which D?") no longer applies
export function resetPending() {
  pending = null;
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
      if (transcribing()) { stopTranscribing(); return { text: 'Stopped. Here’s the transcription.' }; }
      if (session.recording) return stopRecord();
      if (state.input === 'clip' && pauseClip()) return { text: 'Paused.' };
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
      closeTranscribe();
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

export const voiceFeature = {
  onListen: () => { if (prefs.voice) beginVoice(); },
  beforeStop: () => {
    stopVoice();
    session.voiceBusy = false;
    pending = null;
  },
  render: renderVoice,
};

function renderVoice() {
  els.voiceBtn.hidden = !voiceSupported();
  els.voiceBtn.classList.toggle('on', prefs.voice);
  els.voiceBtn.setAttribute('aria-pressed', String(prefs.voice));
  els.voiceBtn.querySelector('.cl-voice-state').textContent = prefs.voice ? 'on' : 'off';
}

export function setVoiceOn(on) {
  prefs.voice = on;
  try { localStorage.setItem(VOICE_KEY, on ? '1' : '0'); } catch { /* private mode */ }
  if (on && listening()) beginVoice();
  if (!on) { stopVoice(); session.voiceBusy = false; }
  renderMode();
  reply(on ? HELP : 'Voice commands off.');
}
