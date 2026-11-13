// A custom handpan's own recorded note sounds: trimmed to WAV, uploaded to the
// private handpan-audio bucket, linked on the note's note_map entry (audio_url),
// which noteplayer.js then plays instead of the built-in sample. Shared by the
// guided calibration tool and Chord listen's Note sounds.
import { supabase } from './supabase-client.js';

const BUCKET = 'handpan-audio';

function slugify(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Only trims the LEAD-IN (dead air before the note is struck) — the trailing
// end is left untouched. A real handpan's decay tail runs quiet enough, long
// enough, that any trailing-silence threshold cut captures down to the first
// second or so, discarding the long decay the recording exists to capture.
export async function trimLeadIn(blob, audioCtx) {
  const arrayBuffer = await blob.arrayBuffer();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;

  const AMPLITUDE_THRESHOLD = 0.02;
  const WINDOW = Math.max(1, Math.round(sampleRate * 0.02)); // 20ms RMS window

  function rmsAt(i) {
    let sum = 0;
    const end = Math.min(channelData.length, i + WINDOW);
    for (let j = i; j < end; j++) sum += channelData[j] * channelData[j];
    return Math.sqrt(sum / (end - i));
  }

  let startIdx = 0;
  for (let i = 0; i < channelData.length; i += WINDOW) {
    if (rmsAt(i) > AMPLITUDE_THRESHOLD) { startIdx = Math.max(0, i - WINDOW); break; }
  }

  const trimmed = channelData.subarray(startIdx);
  const trimmedBuffer = audioCtx.createBuffer(1, trimmed.length, sampleRate);
  trimmedBuffer.copyToChannel(trimmed, 0);
  return audioBufferToWav(trimmedBuffer);
}

function audioBufferToWav(buffer) {
  const numChannels = 1;
  const sampleRate = buffer.sampleRate;
  const samples = buffer.getChannelData(0);
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = samples.length * bytesPerSample;

  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);

  function writeString(offset, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

// [pitch]_[scale_slug]_[handpan]_[00001].wav — see supabase/migrations/*_handpan_audio_bucket.sql's
// next_handpan_audio_seq() for the race-safe per (pitch, scale) counter. Lets an
// admin later browse the bucket and, for any tuning that's been shared, promote
// a recording into the app's own built-in sample library.
// note: { note: 'C', octave: 3 }. Returns the storage path.
export async function uploadNoteAudio(handpan, note, wavBlob) {
  const pitch = `${note.note}${note.octave}`.replace('#', 's');
  const scaleSlug = slugify(handpan.scale_name || handpan.name) || 'handpan';
  const handpanIdShort = String(handpan.id).replace(/-/g, '').slice(0, 8);
  const seqKey = `${pitch}_${scaleSlug}_${handpanIdShort}`;

  const { data: seq, error: seqError } = await supabase.rpc('next_handpan_audio_seq', { p_seq_key: seqKey });
  if (seqError) throw seqError;

  const fileName = `${pitch}_${scaleSlug}_${handpanIdShort}_${String(seq).padStart(5, '0')}.wav`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(fileName, wavBlob, { contentType: 'audio/wav' });
  if (uploadError) throw uploadError;

  // handpan-audio is private: link the file to this handpan so storage RLS knows
  // who may read it (owner always; others only if is_audio_shared). The path,
  // not a URL, is what's stored — noteplayer.js downloads it authenticated.
  const { error: linkError } = await supabase
    .from('handpan_audio_recordings')
    .insert({ user_handpan_id: handpan.id, storage_path: fileName });
  if (linkError) throw linkError;

  return fileName;
}

// Whether a note_map entry is the note the pan calls `label` (js/handpanmap.js
// applyCustomHandpan: the assigned number, 'Ding'/'D', or else its pitch)
export function noteMapEntryIs(tf, label) {
  if (label === 'Ding' || label === 'D') return tf.assignedNumber === 'Ding' || tf.assignedNumber === 'D';
  return tf.assignedNumber ? tf.assignedNumber === label : `${tf.note}${tf.octave}` === label;
}

// Links a recording to one note of the handpan. Reads the saved note_map first
// so nothing else edited elsewhere is overwritten. Returns the new note_map.
export async function setNoteAudio(handpanId, label, storagePath) {
  const { data, error } = await supabase.from('user_handpans').select('note_map').eq('id', handpanId).single();
  if (error) throw error;
  const noteMap = (data.note_map || []).map(tf => (noteMapEntryIs(tf, label) ? { ...tf, audio_url: storagePath } : tf));
  if (!noteMap.some(tf => noteMapEntryIs(tf, label))) throw new Error(`No note ${label} on this handpan`);
  const { error: saveError } = await supabase.from('user_handpans').update({ note_map: noteMap }).eq('id', handpanId);
  if (saveError) throw saveError;
  return noteMap;
}
