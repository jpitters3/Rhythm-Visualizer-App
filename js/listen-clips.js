// Chord listen: recording a flow as a Clip, and building notation from a Clip
// played back through the listening engine.
import { getMicStream, startListeningToClip, stopListening } from './listen-engine.js';
import { scaleLabel } from './listen-notes.js';
import { onCue, onLevel, onNote, onSound, startLive, startMic, stopLive, stopMic } from './listen-play.js';
import { listening, session, setInput, setMode, setTask, state } from './listen-state.js';
import { els, formatTime, renderAll, renderCurrent, renderMode, reply } from './listen-view.js';
import { startRawAudioRecording, stopRawAudioRecording } from './audio-recorder.js';
import { openAuthModal } from './auth.js';
import { clipTitle, fetchClipBlob, uploadClip } from './clips.js';
import { setVisible } from './dom.js';
import { openFreeRecordWithAudio } from './free-record.js';
import { unlockAudio } from './noteplayer.js';
import { navigate } from './router.js';
import { currentUser, isAdminUser } from './state.js';
import { loadCalibrationProfile } from './transcription.js';

const RECORD_WARN_SECS = 20 * 60; // about 38 MB at 256 kbps; uploads stop at 50 MB

const RECORD_MAX_SECS = 25 * 60;

let clipAudio = null;

export async function startRecord() {
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

export function stopRecord() {
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

export async function openClip(row, blob = null) {
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

export function closeClip({ quiet = false } = {}) {
  if (!session.clip) return;
  clipAudio?.pause();
  if (state.mode === 'live') stopLive();
  stopListening();
  URL.revokeObjectURL(session.clip.url);
  session.clip = null;
  setInput('off');
  if (!quiet) renderAll();
}

// True if it was playing
export function pauseClip() {
  if (!clipAudio || clipAudio.paused) return false;
  clipAudio.pause();
  return true;
}

export function seekClip(seconds) {
  if (clipAudio) clipAudio.currentTime = seconds;
}

export function toggleClipPlay() {
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

export const clipsFeature = {
  beforeStop: () => {
    stopRecord();
    if (state.input === 'clip') closeClip();
  },
  render: renderClips,
};

function renderClips() {
  els.recordBtn.hidden = state.input === 'clip';
  els.recordBtn.classList.toggle('recording', !!session.recording);
  els.recordLabel.textContent = session.recording ? 'Stop & save' : 'Record a flow';
  setVisible(els.clipBar, state.input === 'clip');
  setVisible(els.savedBar, !!session.savedClip && !session.recording && state.input !== 'clip');
  // Free record (note-by-note transcription) is admin-only for now
  const canTranscribe = isAdminUser(currentUser);
  els.transcribeBtn.hidden = !canTranscribe || state.input !== 'clip';
  els.savedTranscribe.hidden = !canTranscribe;
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
export function transcribeNotes(target = session.clip || session.savedClip) {
  if (!target) return;
  const { blob } = target;
  const name = target.row.title;
  if (session.clip) closeClip();
  navigate('studio');
  setTimeout(() => openFreeRecordWithAudio(blob, name), 60);
}
