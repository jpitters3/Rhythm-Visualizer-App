import { supabase } from './supabase-client.js';
import { currentUser } from './state.js';
import { getProfileById } from './profile.js';
import { saveCurrentPatternAs } from './controls.js';
import { serializePattern, applyPattern, updatePatternButtons, getSelectedPatternName } from './pattern-crud.js';
import { clearSelection } from './notegrid.js';

const shareBtn = document.getElementById('shareBtn');
const renameBtn = document.getElementById('renameBtn');
const deleteBtn = document.getElementById('deleteBtn');

function genShareId(len = 10) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    prompt('Copy this link:', text);
    return false;
  }
}

async function upsertSharedPattern() {
  if (!currentUser) {
    alert('Please sign in to share a pattern.');
    return null;
  }

  const fallback = getSelectedPatternName() || `Shared ${new Date().toLocaleString()}`;
  const name = prompt('Share pattern name:', fallback);
  if (!name) return null;

  const row = {
    user_id: currentUser.id,
    profile_id: currentUser.id,
    name: name.trim(),
    pattern_json: serializePattern(),
  };

  const { data: existing, error: exErr } = await supabase
    .from('shared_patterns')
    .select('share_id, is_public')
    .eq('user_id', currentUser.id)
    .eq('name', row.name)
    .maybeSingle();

  if (exErr) {
    console.warn('Share lookup error:', exErr);
  }

  let share_id = existing?.share_id || genShareId();
  const is_public_val = existing?.is_public ?? false;

  const { error } = await supabase
    .from('shared_patterns')
    .upsert({ ...row, share_id, is_public: is_public_val }, { onConflict: 'user_id,name' });

  if (error) {
    console.error('Share upsert error:', error);
    alert(`Share failed: ${error.message}`);
    return null;
  }

  return { share_id, is_public: is_public_val };
}

shareBtn?.addEventListener('click', async () => {
  try {
    const result = await upsertSharedPattern();
    if (!result) return;
    const { share_id, is_public } = result;

    const url = `${location.origin}${location.pathname}?share=${encodeURIComponent(share_id)}`;
    await copyText(url);

    if (is_public) {
      alert('Link copied! (This pattern is Public)');
      return;
    }

    if (confirm('Link copied! Would you also like to publish this pattern to the Community Feed?')) {
      const { error } = await supabase
        .from('shared_patterns')
        .update({ is_public: true })
        .eq('share_id', share_id);

      if (error) {
        console.error('Failed to publish', error);
        alert('Link worked, but failed to publish to community feed.');
      } else {
        alert('Published to Community Feed!');
      }
    } else {
      alert('Link copied! Pattern is private (only people with the link can see it).');
    }
  } catch (e) {
    console.error(e);
    alert('Share failed (see console).');
  }
});

export async function loadSharedFromURL() {
  const sp = new URLSearchParams(location.search);
  const share = sp.get('share');

  if (!share) {
    viewingShared = false;
    sharedMeta = { shareId: null, name: null };
    updateSharedUI();
    return false;
  }

  const { data, error } = await supabase
    .from('shared_patterns')
    .select('pattern_json, name, user_id')
    .eq('share_id', share)
    .maybeSingle();

  if (error) {
    console.warn('share load error:', error);
    alert(`Could not load shared pattern: ${error.message}`);
    return false;
  }
  if (!data?.pattern_json) {
    alert('That share link is invalid or no longer public.');
    return false;
  }

  applyPattern(data.pattern_json);

  let creatorName = "Unknown";
  if (data.user_id) {
    const p = await getProfileById(data.user_id);
    if (p?.username) creatorName = p.username;
  }

  viewingShared = true;
  sharedMeta = { shareId: share, name: data?.name || null, creator: creatorName };
  updateSharedUI();

  if (clearSelection) clearSelection();

  if (data.name) document.title = `GroovePan — ${data.name}`;

  return true;
}


// Banner //

let viewingShared = false;
let sharedMeta = { shareId: null, name: null };

const sharedBanner = document.getElementById('sharedBanner');
const sharedBannerSub = document.getElementById('sharedBannerSub');
const sharedSaveCopyBtn = document.getElementById('sharedSaveCopyBtn');
const sharedExitBtn = document.getElementById('sharedExitBtn');

function updateSharedUI() {
  if (!sharedBanner) return;

  sharedBanner.style.display = viewingShared ? 'flex' : 'none';

  if (viewingShared) {
    const nm = sharedMeta?.name ? `"${sharedMeta.name}"` : 'this pattern';
    const by = sharedMeta?.creator && sharedMeta.creator !== 'Unknown' ? ` by ${sharedMeta.creator}` : '';
    sharedBannerSub.textContent = `You can play and edit locally. Use “Save a copy” to keep it. (${nm}${by})`;

    if (renameBtn) renameBtn.disabled = true;
    if (deleteBtn) deleteBtn.disabled = true;

  } else {
    updatePatternButtons();
  }
}

sharedSaveCopyBtn?.addEventListener('click', async () => {
  const base = sharedMeta?.name || 'Shared Pattern';
  const suggested = `${base} (copy)`;
  const name = prompt('Save a copy as:', suggested);
  if (!name) return;

  // We need to await saveCurrentPatternAs if we want to confirm, IF it returns a value.
  // controls.js export is async.
  await saveCurrentPatternAs(name);
  // It alerts on failure.
});

sharedExitBtn?.addEventListener('click', () => {
  const url = new URL(location.href);
  url.searchParams.delete('share');
  history.replaceState({}, '', url.toString());

  viewingShared = false;
  sharedMeta = { shareId: null, name: null };
  updateSharedUI();
});
