import { alert, confirm, prompt } from './alert.js';
import { supabase } from './supabase-client.js';
import { currentUser } from './state.js';
import { getProfileById } from './profile.js';
import { saveCurrentPatternAs } from './controls.js';
import { serializePattern, applyPattern, updatePatternButtons, getSelectedPatternName, setPhraseNameOverride } from './pattern-crud.js';
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

export function showShareLinkModal(url, { isPublic, onPublish } = {}) {
  return new Promise(resolve => {
    const modal     = document.getElementById('shareLinkModal');
    const input     = document.getElementById('shareLinkInput');
    const copyBtn   = document.getElementById('shareLinkCopyBtn');
    const closeBtn  = document.getElementById('shareLinkCloseBtn');
    const publishBtn = document.getElementById('shareLinkPublishBtn');
    const subtitle  = document.getElementById('shareLinkSubtitle');
    if (!modal) { resolve(); return; }

    input.value = url;
    publishBtn.style.display = (!isPublic && onPublish) ? '' : 'none';

    // Auto-copy
    navigator.clipboard.writeText(url).then(() => {
      subtitle.textContent = 'Link copied to clipboard.';
    }).catch(() => {
      subtitle.textContent = 'Copy the link below:';
    });

    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');

    // Select all text on focus for easy manual copy
    input.addEventListener('focus', () => input.select(), { once: false });
    input.select();

    const copyIcon = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    const checkIcon = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

    const handleCopy = () => {
      navigator.clipboard.writeText(url).catch(() => {});
      copyBtn.innerHTML = checkIcon;
      copyBtn.classList.add('copied');
      setTimeout(() => { copyBtn.innerHTML = copyIcon; copyBtn.classList.remove('copied'); }, 2000);
    };

    const close = () => {
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
      copyBtn.removeEventListener('click', handleCopy);
      closeBtn.removeEventListener('click', close);
      publishBtn.removeEventListener('click', handlePublish);
      resolve();
    };

    const handlePublish = async () => {
      close();
      await onPublish?.();
    };

    copyBtn.innerHTML = copyIcon;
    copyBtn.classList.remove('copied');
    copyBtn.addEventListener('click', handleCopy);
    closeBtn.addEventListener('click', close);
    publishBtn.addEventListener('click', handlePublish);
    modal.addEventListener('click', e => { if (e.target === modal) close(); }, { once: true });
  });
}

async function upsertSharedPattern() {
  if (!currentUser) {
    await alert('Please sign in to share a pattern.');
    return null;
  }

  const fallback = getSelectedPatternName() || `Shared ${new Date().toLocaleString()}`;
  const name = await prompt('Share pattern name:', fallback);
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
    await alert(`Share failed: ${error.message}`);
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

    await showShareLinkModal(url, {
      isPublic: is_public,
      onPublish: async () => {
        const { error } = await supabase
          .from('shared_patterns')
          .update({ is_public: true })
          .eq('share_id', share_id);
        if (error) {
          await alert('Link worked, but failed to publish to community feed.');
        } else {
          await alert('Published to Community Feed!');
        }
      },
    });
  } catch (e) {
    console.error(e);
    await alert('Share failed (see console).');
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
    await alert(`Could not load shared pattern: ${error.message}`);
    return false;
  }
  if (!data?.pattern_json) {
    await alert('That share link is invalid or no longer public.');
    return false;
  }

  let patternData = data.pattern_json;
  if (typeof patternData === 'string') {
    try { patternData = JSON.parse(patternData); } catch {
      await alert('That share link is invalid or no longer public.');
      return false;
    }
  }

  if (data.name) setPhraseNameOverride(data.name);

  await applyPattern(patternData);

  let creatorName = "Unknown";
  if (data.user_id) {
    const p = await getProfileById(data.user_id);
    if (p?.username) creatorName = p.username;
  }

  viewingShared = true;
  sharedMeta = { shareId: share, name: data?.name || null, creator: creatorName };
  updateSharedUI();

  if (clearSelection) clearSelection();

  if (data.name) document.title = `Panafide — ${data.name}`;

  return data.name || true;
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
  const name = await prompt('Save a copy as:', suggested);
  if (!name) return;

  // We need to await saveCurrentPatternAs if we want to confirm, IF it returns a value.
  // controls.js export is async.
  setPhraseNameOverride(null);
  await saveCurrentPatternAs(name, 'shared');
});

sharedExitBtn?.addEventListener('click', () => {
  const url = new URL(location.href);
  url.searchParams.delete('share');
  history.replaceState({}, '', url.toString());

  viewingShared = false;
  sharedMeta = { shareId: null, name: null };
  setPhraseNameOverride(null);
  updateSharedUI();
});
