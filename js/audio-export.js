import { activeGrid } from './state.js';
import { intervalMs, noteForLabel, samples, getVolume } from './noteplayer.js';

// Convert AudioBuffer to WAV blob
function audioBufferToWav(buffer, opt) {
  opt = opt || {};
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = opt.float32 ? 3 : 1;
  const bitDepth = format === 3 ? 32 : 16;

  const result = (numChannels === 2) ? interleave(buffer.getChannelData(0), buffer.getChannelData(1)) : buffer.getChannelData(0);

  return encodeWAV(result, format, sampleRate, numChannels, bitDepth);
}

function interleave(inputL, inputR) {
  const length = inputL.length + inputR.length;
  const result = new Float32Array(length);
  let index = 0, inputIndex = 0;
  while (index < length) {
    result[index++] = inputL[inputIndex];
    result[index++] = inputR[inputIndex];
    inputIndex++;
  }
  return result;
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

function encodeWAV(audioSamples, format, sampleRate, numChannels, bitDepth) {
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + audioSamples.length * bytesPerSample);
  const view = new DataView(buffer);

  // RIFF chunk descriptor
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + audioSamples.length * bytesPerSample, true);
  writeString(view, 8, 'WAVE');
  // FMT sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  // data sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, audioSamples.length * bytesPerSample, true);

  if (format === 1) {
    // 16-bit PCM
    let offset = 44;
    for (let i = 0; i < audioSamples.length; i++, offset += 2) {
      let s = Math.max(-1, Math.min(1, audioSamples[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
  } else {
    // 32-bit float
    let offset = 44;
    for (let i = 0; i < audioSamples.length; i++, offset += 4) {
      view.setFloat32(offset, audioSamples[i], true);
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

export async function exportAudioWav() {
  const c = activeGrid;
  if (!c || !c.innerLabels || c.innerLabels.length === 0) return null;

  // 1 loop length in seconds
  const beatMs = intervalMs(c);
  // We need to fetch instrument volume (default to 1.0)
  const volObj = getVolume();
  const volInstrument = volObj !== undefined ? volObj : 1.0;

  // Total pattern duration + reverb tail (e.g. 2 more seconds so samples won't abruptly cut off)
  const patternDuration = (c.innerLabels.length * beatMs) / 1000;
  const totalDuration = patternDuration + 2.0;

  const sampleRate = 44100;
  const offlineCtx = new OfflineAudioContext(2, Math.ceil(sampleRate * totalDuration), sampleRate);

  // Add notes to the offline context
  c.innerLabels.forEach((cellData, step) => {
    if (!cellData) return;
    const time = (step * beatMs) / 1000;

    const labels = Array.isArray(cellData) ? cellData : [cellData];
    labels.forEach(label => {
      if (!label) return;
      const note = noteForLabel(label);
      if (!note || !samples[note]) return;

      const buffer = samples[note];
      const src = offlineCtx.createBufferSource();
      src.buffer = buffer;

      const gain = offlineCtx.createGain();
      gain.gain.setValueAtTime(volInstrument, time);

      src.connect(gain);
      gain.connect(offlineCtx.destination);
      src.start(time);
    });
  });

  const renderedBuffer = await offlineCtx.startRendering();
  return audioBufferToWav(renderedBuffer);
}
