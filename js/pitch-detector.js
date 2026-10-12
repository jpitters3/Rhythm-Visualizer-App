// Self-contained pitch listener for Chord Play Along. Deliberately does NOT
// reuse js/transcription.js's turnOnMic()/turnOffMic() — those also kick
// off transcription.js's own requestAnimationFrame loop (tied to the shared
// `isListening` flag), which would run in parallel and fight over state.
// This keeps its own mic stream/analyser, same shape as js/clap-detector.js,
// but imports the actual pitch-detection algorithms rather than
// reimplementing them — autoCorrelate (Hz) and findClosestScaleNote (Hz ->
// the current scale's note label) are the exact functions transcription.js
// itself uses.
import { getAudioCtx } from './noteplayer.js';
import { autoCorrelate, findClosestScaleNote } from './transcription.js';

const BUFSIZE = 2048;
const buf = new Float32Array(BUFSIZE);
// autoCorrelate's own confidence score (0-1). Coaching Mode's equivalent
// slider ranges 0.3-0.7 with 0.4 as a typical default — matching that
// range here rather than guessing a stricter value.
const MIN_CLARITY = 0.5;
// The "sustain fix" from js/transcription.js's own coaching loop: a
// handpan note rings well past a single frame, so re-detecting the SAME
// note a moment later doesn't mean it was struck again — it's just still
// decaying. Only a genuine new attack (a sharp frame-to-frame RMS rise)
// re-confirms the same note; a genuinely DIFFERENT note is always accepted
// immediately, since there's no sustain ambiguity about which note it is.
// Gated against EVERY label confirmed so far this round (confirmedLabels,
// a Set), not just the single most recent one — on a handpan, several
// tone fields ring at once, so the FIRST note of an arpeggio can still be
// resonating by the time the THIRD note's window arrives. Checking only
// "was this the last one" let that older note's sustain slip back in
// scot-free the moment a different note was heard in between, since it
// was no longer "the last" label.
const SUSTAIN_FLUX_THRESHOLD = 1.35;
// Autocorrelation isn't instantaneous — it needs a few wave cycles of
// settled signal after the real strike before it can confidently report a
// pitch, so every detection timestamp is systematically LATE relative to
// when the note was actually played. js/coaching-mode.js's own pitch loop
// has this same lag and compensates by subtracting a fixed offset when
// recording a hit's time ("Compensation for the 2-frame confidence
// threshold (~16ms * 2 = 32ms)", js/transcription.js). Reusing that same
// value here — it's for the same underlying autoCorrelate() algorithm,
// not a fresh guess — though this detector's own confidence logic differs
// slightly (single qualifying frame vs. coaching mode's 2-frame tally), so
// treat this as a starting point to tune further against real playing.
const DETECTION_LATENCY_MS = 32;

let micStream = null;
let analyser = null;
let rafId = null;
let onNote = null;
let confirmedLabels = new Set();
let prevRMS = 0;

async function openMic(audioCtx) {
  const constraints = {
    audio: {
      sampleRate: audioCtx.sampleRate,
      echoCancellation: false,
      autoGainControl: false,
      noiseSuppression: false,
    },
  };
  try {
    return await navigator.mediaDevices.getUserMedia(constraints);
  } catch {
    return await navigator.mediaDevices.getUserMedia({ audio: true });
  }
}

function loop() {
  if (!analyser) return;
  const audioCtx = getAudioCtx();
  analyser.getFloatTimeDomainData(buf);

  const pitch = autoCorrelate(buf, audioCtx.sampleRate);
  if (pitch && pitch !== -1 && pitch.clarity >= MIN_CLARITY) {
    const label = findClosestScaleNote(pitch.freq);
    const flux = prevRMS > 0 ? pitch.rms / prevRMS : 0;

    if (label) {
      const isGenuineHit = !confirmedLabels.has(label) || flux >= SUSTAIN_FLUX_THRESHOLD;
      if (isGenuineHit) {
        confirmedLabels.add(label);
        onNote?.(label, audioCtx.currentTime * 1000 - DETECTION_LATENCY_MS);
      }
    }
  }
  prevRMS = (pitch && pitch !== -1) ? pitch.rms : prevRMS;

  rafId = requestAnimationFrame(loop);
}

// onDetect(label, timestampMs) is called for each new note onset detected —
// timestampMs is the AudioContext-clock timestamp (audioCtx.currentTime *
// 1000), the same clock js/noteplayer.js schedules playback against.
export async function startPitchListening(onDetect) {
  const audioCtx = getAudioCtx();
  if (!audioCtx) return false;
  if (audioCtx.state === 'suspended') await audioCtx.resume();

  try {
    micStream = await openMic(audioCtx);
  } catch (err) {
    console.error('[PitchDetector] Microphone error:', err);
    return false;
  }

  const source = audioCtx.createMediaStreamSource(micStream);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = BUFSIZE;
  source.connect(analyser);

  confirmedLabels = new Set();
  prevRMS = 0;
  onNote = onDetect;
  rafId = requestAnimationFrame(loop);
  return true;
}

export function stopPitchListening() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  onNote = null;
  if (micStream) micStream.getTracks().forEach(t => t.stop());
  micStream = null;
  analyser = null;
}

// Call at the start of each new chord round — a note from the PREVIOUS
// chord has no bearing on whether this round's notes are genuine new
// strikes, so don't carry its sustain-gate state forward indefinitely.
export function resetPitchHistory() {
  confirmedLabels = new Set();
}
