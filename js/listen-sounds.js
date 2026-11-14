// Chord listen: Note sounds, recording a custom handpan's own note audio.
import { closeClip, stopRecord } from './listen-clips.js';
import { getMicStream } from './listen-engine.js';
import { byPitch, labelName, labelToNote, listText, normLabel, panNotes, pitchName } from './listen-notes.js';
import { startMic, stopLive } from './listen-play.js';
import { currentTake, listening, session, setTask, soundsOpen, state } from './listen-state.js';
import { els, renderMode, reply } from './listen-view.js';
import { setVisible } from './dom.js';
import { getActiveCustomHandpan, updateCustomHandpanNoteMap } from './handpanmap.js';
import { setNoteAudio, trimLeadIn, uploadNoteAudio } from './note-audio.js';
import { getAudioCtx, hasLibrarySample, reloadLabelSample } from './noteplayer.js';
import { currentUser, getScale } from './state.js';
import { parseNoteName } from './voice-commands.js';

const TAKE_MS = 8000; // a note's sound: the strike and its long decay (as in guided calibration)

const TAKE_WAIT_MS = 15000; // give up if no strike comes

const TAKE_ONSET_RMS = 0.04; // "that was a G" refers to a sound this recent

export function ownHandpan() {
  const hp = getActiveCustomHandpan();
  return hp && currentUser && hp.user_id === currentUser.id ? hp : null;
}

const hasNoteAudio = label => !!getScale()?.audioOverrides?.[label];

// Pitched notes only: tak and slap position markers have no pitch to record
const panLabels = () => panNotes().map(n => n.label);

export function setSoundsOn(on) {
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
    el.classList.toggle('cl-no-audio', soundsOpen() && !hasNoteAudio(label) && !hasLibrarySample(label));
    el.classList.toggle('cl-take', take?.label === label);
  });
}

function renderSounds() {
  els.view.toggleAttribute('data-sounds', soundsOpen());
  setVisible(els.soundsBar, soundsOpen());
  els.soundsBtn.hidden = !ownHandpan();
  els.soundsBtn.classList.toggle('on', soundsOpen());
  els.soundsBtn.setAttribute('aria-pressed', String(soundsOpen()));
  markNoteAudio();
  if (!soundsOpen()) return;
  const take = currentTake();
  const labels = panLabels();
  const own = labels.filter(hasNoteAudio).length;
  const library = labels.filter(l => !hasNoteAudio(l) && hasLibrarySample(l)).length;
  const missing = labels.filter(l => !hasNoteAudio(l) && !hasLibrarySample(l));
  const name = take ? labelName(take.label) : '';
  let text;
  let actions = '';
  if (!take) {
    const sources = [own && `${own} your own`, library && `${library} from the sample library`].filter(Boolean).join(', ');
    const have = `${labels.length - missing.length} of ${labels.length} notes have a sound${sources ? ` (${sources})` : ''}`;
    text = missing.length
      ? `${have}. No sound yet for ${listText(byPitch(missing).map(labelName))}: tap a note to record it.`
      : `${have}. Tap a note to record your own.`;
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

export async function startTake(label) {
  cancelTake();
  if (state.input === 'clip') closeClip();
  if (!listening()) await startMic();
  const stream = getMicStream();
  if (!stream || !soundsOpen()) return;
  const mimeType = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
  const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 256000 });
  const take = { label: normLabel(label), phase: 'waiting', recorder, chunks: [], startedAt: performance.now(), onsetAt: 0, timer: null, blob: null, url: null, heard: new Set() };
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
    if (!parsed) throw new Error(`No pitch for ${take.label}`);
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

export const soundsFeature = {
  onNote: (label) => {
    const take = currentTake();
    if (take) take.heard.add(label); // a note's sound being recorded
    return !!take;
  },
  onLevel: (rms) => { if (currentTake()?.phase === 'waiting' && rms > TAKE_ONSET_RMS) startTakeCountdown(); },
  beforeStop: cancelTake,
  beforeLive: cancelTake,
  render: renderSounds,
};

export function onTakeAction(e) {
  const action = e.target.closest('[data-take]')?.dataset.take;
  if (!action) return;
  const take = currentTake();
  if (action === 'done') setSoundsOn(false);
  else if (action === 'cancel') { cancelTake(); renderMode(); }
  else if (action === 'again' && take) startTake(take.label);
  else if (action === 'save') saveTake();
  else if (action === 'play' && take?.url) new Audio(take.url).play();
}
