// Clips (Library → Clips): audio recordings in the user-clips bucket, one row
// each in the clips table. Shared by the Library and Chord listen's Record.
import { supabase } from './supabase-client.js';
import { currentUser } from './state.js';

const BUCKET = 'user-clips';

// Safari records mp4/aac, Chrome and Firefox webm/ogg: keep the real type
function extensionFor(type) {
  if (/mp4|aac|m4a/.test(type)) return 'm4a';
  if (/ogg/.test(type)) return 'ogg';
  if (/wav/.test(type)) return 'wav';
  return 'webm';
}

export function clipTitle(prefix = 'Recording') {
  const now = new Date();
  const day = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${prefix} – ${day} ${time}`;
}

export function uploadErrMsg(err, bytes) {
  const status = String(err?.statusCode ?? err?.status ?? '');
  const msg = (err?.message ?? '').toLowerCase();
  const isTooLarge = status === '413' || msg.includes('too large') || msg.includes('payload') || msg.includes('exceeded');
  if (isTooLarge) {
    const mb = (bytes / 1024 / 1024).toFixed(1);
    return `Recording is too large to upload (${mb} MB). The limit is 50 MB — try a shorter clip.`;
  }
  return 'Upload failed — check your connection and try again.';
}

// Uploads and records a clip. Resolves { clip } or { error } (a message to show).
export async function uploadClip(blob, { title, durationSecs }) {
  if (!currentUser) return { error: 'Sign in to save clips.' };
  const id = crypto.randomUUID();
  const type = (blob.type || 'audio/webm').split(';')[0];
  const path = `${currentUser.id}/${id}.${extensionFor(type)}`;

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: type });
  if (uploadError) return { error: uploadErrMsg(uploadError, blob.size) };

  const row = { id, user_id: currentUser.id, title, audio_url: path, duration_secs: durationSecs };
  const { error } = await supabase.from('clips').insert(row);
  if (error) {
    await supabase.storage.from(BUCKET).remove([path]); // no orphaned audio
    return { error: `Could not save clip: ${error.message}` };
  }
  return { clip: { ...row, created_at: new Date().toISOString() } };
}

export async function clipSignedUrl(clip, seconds = 3600) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(clip.audio_url, seconds);
  return error ? null : data?.signedUrl || null;
}

// The clip's audio as a Blob (a same-origin copy the analyser can read)
export async function fetchClipBlob(clip) {
  const url = await clipSignedUrl(clip, 600);
  if (!url) return null;
  const res = await fetch(url);
  return res.ok ? res.blob() : null;
}
