/**
 * js/ui-sound.js
 * Tiny synthesized UI sound effects (no audio asset files needed) for things
 * like "your background upload finished."
 *
 * Uses an <audio> element playing an in-memory-generated WAV rather than
 * scheduling oscillators directly on an AudioContext — browsers are more
 * consistent about allowing HTMLMediaElement.play() after a page has had
 * any user interaction, whereas AudioContext playback started well outside
 * the original gesture (e.g. after an async upload finishes) is more likely
 * to get silently blocked by autoplay policies (Safari especially).
 */

let chimeUrl = null;
let primedElement = null;

function buildChimeWavUrl() {
  const sampleRate = 44100;
  const duration = 0.42;
  const totalSamples = Math.floor(sampleRate * duration);
  const samples = new Float32Array(totalSamples);

  // Two-note upward chime: A5 then E6, each with a quick attack + decay envelope.
  const tones = [
    { freq: 880, start: 0, dur: 0.2 },
    { freq: 1318.5, start: 0.09, dur: 0.3 },
  ];

  for (const { freq, start, dur } of tones) {
    const startSample = Math.floor(start * sampleRate);
    const numSamples = Math.floor(dur * sampleRate);
    for (let i = 0; i < numSamples; i++) {
      const idx = startSample + i;
      if (idx >= totalSamples) break;
      const t = i / sampleRate;
      const envelope = Math.min(1, t / 0.015) * Math.exp(-t * 7);
      samples[idx] += Math.sin(2 * Math.PI * freq * t) * envelope * 0.5;
    }
  }

  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    pcm[i] = clamped * 0x7fff;
  }

  const buffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buffer);
  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, pcm.length * 2, true);

  let offset = 44;
  for (let i = 0; i < pcm.length; i++, offset += 2) view.setInt16(offset, pcm[i], true);

  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
}

function getChimeUrl() {
  if (!chimeUrl) chimeUrl = buildChimeWavUrl();
  return chimeUrl;
}

/**
 * Call synchronously from within a user gesture (e.g. a click handler) to
 * "prime" playback ahead of time, so a later `playSuccessChime()` call —
 * made asynchronously once a background upload finishes — isn't blocked by
 * autoplay restrictions.
 */
export function warmAudioContext() {
  try {
    const audio = new Audio(getChimeUrl());
    audio.volume = 0;
    const playPromise = audio.play();
    if (playPromise?.then) {
      playPromise.then(() => audio.pause()).catch(() => { /* priming best-effort */ });
    } else {
      audio.pause();
    }
    primedElement = audio;
  } catch (err) {
    console.warn('[ui-sound] Unable to prime audio', err);
  }
}

/** Plays the upload/post-complete chime. */
export function playSuccessChime() {
  try {
    const audio = primedElement || new Audio(getChimeUrl());
    audio.currentTime = 0;
    audio.volume = 0.6;
    audio.play().catch(err => console.warn('[ui-sound] Chime playback blocked', err));
  } catch (err) {
    console.warn('[ui-sound] Unable to play chime', err);
  }
}
