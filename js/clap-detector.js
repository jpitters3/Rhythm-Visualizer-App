// Self-contained clap/onset listener for the Rhythm game. Deliberately does
// NOT reuse js/transcription.js's turnOnMic()/turnOffMic() — those also kick
// off transcription.js's own requestAnimationFrame pitch-detection loop
// (tied to the shared `isListening` flag), which would run in parallel and
// fight over the same grid. This keeps its own mic stream/analyser so the
// two systems never interact.
import { getAudioCtx } from './noteplayer.js';

const BUFSIZE = 2048;
const buf = new Float32Array(BUFSIZE);
const FLUX_THRESHOLD = 1.3;
const DEFAULT_MIN_HIT_RMS = 0.08; // floor used when no click level was ever measured (fallback; metronome off/muted)
// A clap must be at least this many times louder than the metronome click
// actually measured through the mic (acoustic bleed — echoCancellation is
// off, same as js/transcription.js) during the count-in, see CLICK_LEVEL
// calibration below. A soft shaker click and a real hand clap aren't close
// in level, so this has a lot of headroom without risking real claps.
const CLAP_OVER_CLICK_MULTIPLIER = 0.5;
const REFRACTORY_MS = 150; // ignore further hits for this long after one lands, so a single clap's decay tail doesn't double-trigger

let micStream = null;
let analyser = null;
let rafId = null;
let prevRMS = 0;
let lastHitAt = 0;
let onHit = null;
let calibrating = false;
let calibrationCutoffAudioTime = 0; // audioCtx.currentTime (seconds) calibration ends at — the audio clock, not wall-clock
let clickLevel = 0; // loudest RMS observed during calibration — our estimate of "how loud the click sounds through this mic"

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

  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  const rms = Math.sqrt(sum / buf.length);
  const flux = prevRMS > 0 ? rms / prevRMS : 0;
  prevRMS = rms;

  const nowMs = performance.now();

  if (calibrating) {
    // The count-in plays nothing but metronome clicks — whatever's loudest
    // here IS the click, heard through this mic at this volume/distance.
    if (rms > clickLevel) clickLevel = rms;
    // Compared against the audio clock, not performance.now() — see the
    // comment on calibrateUntilAudioTime's assignment in
    // startClapListening for why.
    if (audioCtx.currentTime >= calibrationCutoffAudioTime) calibrating = false;
    rafId = requestAnimationFrame(loop);
    return;
  }

  const minHitRms = Math.max(DEFAULT_MIN_HIT_RMS, clickLevel * CLAP_OVER_CLICK_MULTIPLIER);
  const isHit = rms > minHitRms && flux > FLUX_THRESHOLD && (nowMs - lastHitAt) > REFRACTORY_MS;
  if (isHit) {
    lastHitAt = nowMs;
    onHit?.(audioCtx.currentTime * 1000);
  }

  rafId = requestAnimationFrame(loop);
}

// onClap(timestampMs) is called with the AudioContext-clock timestamp
// (audioCtx.currentTime * 1000) of each detected hit — the same clock
// js/noteplayer.js schedules the metronome against, so callers can snap it
// to a step without any unit conversion.
//
// calibrateUntilAudioTime, when given (audioCtx.currentTime seconds), opens
// the mic immediately but spends everything up to that audio-clock moment
// only measuring the metronome click's own level (no onClap calls) instead
// of detecting hits — meant to be called at the start of the count-in
// (which plays nothing else), with the count-in's own end time (the real
// listening measure's start), so whatever's loudest there really is the
// click. Deliberately an audio-clock cutoff, not a wall-clock duration —
// see the comment where it's compared in loop() for why. Real detection
// begins automatically once calibration ends.
export async function startClapListening(onClap, { calibrateUntilAudioTime = 0 } = {}) {
  const audioCtx = getAudioCtx();
  if (!audioCtx) return false;
  if (audioCtx.state === 'suspended') await audioCtx.resume();

  try {
    micStream = await openMic(audioCtx);
  } catch (err) {
    console.error('[ClapDetector] Microphone error:', err);
    return false;
  }

  const source = audioCtx.createMediaStreamSource(micStream);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = BUFSIZE;
  source.connect(analyser);

  prevRMS = 0;
  lastHitAt = 0;
  clickLevel = 0;
  calibrating = calibrateUntilAudioTime > audioCtx.currentTime;
  calibrationCutoffAudioTime = calibrateUntilAudioTime;
  onHit = onClap;
  rafId = requestAnimationFrame(loop);
  return true;
}

export function stopClapListening() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  onHit = null;
  calibrating = false;
  clickLevel = 0;
  calibrationCutoffAudioTime = 0;
  if (micStream) micStream.getTracks().forEach(t => t.stop());
  micStream = null;
  analyser = null;
}
