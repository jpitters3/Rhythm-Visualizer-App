import { supabase, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-client.js';

/**
 * Uploads a file to a Supabase Storage bucket with upload-progress callbacks.
 * supabase-js's own `.storage.from().upload()` uses fetch under the hood,
 * which has no upload-progress event — so for anything that wants a visible
 * progress bar (e.g. large video posts) we hit the Storage REST endpoint
 * directly via XHR instead, which does expose `upload.onprogress`.
 *
 * @param {string} bucket
 * @param {string} path
 * @param {File} file
 * @param {(fraction: number) => void} [onProgress] fraction is 0..1
 * @returns {Promise<void>}
 */
export async function uploadFileWithProgress(bucket, path, file, onProgress) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token || SUPABASE_PUBLISHABLE_KEY;
  const url = `${SUPABASE_URL}/storage/v1/object/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`;

  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('apikey', SUPABASE_PUBLISHABLE_KEY);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('x-upsert', 'false');

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        let message = `Upload failed (${xhr.status})`;
        try {
          const body = JSON.parse(xhr.responseText);
          if (body?.message) message = body.message;
        } catch { /* ignore unparsable error body */ }
        reject(new Error(message));
      }
    };
    xhr.onerror = () => reject(new Error('Network error during upload'));

    xhr.send(file);
  });
}
