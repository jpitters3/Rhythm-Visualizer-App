const shareBtn = document.getElementById('shareBtn');

function genShareId(len = 10) {
  // short URL-safe id
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

  // pick a friendly name
  const fallback = getSelectedPatternName?.() || `Shared ${new Date().toLocaleString()}`;
  const name = prompt('Share pattern name:', fallback);
  if (!name) return null;

  const row = {
    owner_id: currentUser.id,
    name: name.trim(),
    pattern_json: serializePattern(),
    is_public: true,
  };

  // Try update existing share for same owner+name (via unique index)
  // If it doesn't exist, create a new one with a new share_id.
  // We do this in two steps so share_id stays stable once created.
  const { data: existing, error: exErr } = await supabase1
    .from('shared_patterns')
    .select('share_id')
    .eq('owner_id', currentUser.id)
    .eq('name', row.name)
    .maybeSingle();

  if (exErr) {
    console.warn('Share lookup error:', exErr);
  }

  let share_id = existing?.share_id || genShareId();

  const { error } = await supabase1
    .from('shared_patterns')
    .upsert({ ...row, share_id }, { onConflict: 'owner_id,name' });

  if (error) {
    console.error('Share upsert error:', error);
    alert(`Share failed: ${error.message}`);
    return null;
  }

  return share_id;
}

shareBtn?.addEventListener('click', async () => {
  try {
    const share_id = await upsertSharedPattern();
    if (!share_id) return;

    const url = `${location.origin}${location.pathname}?share=${encodeURIComponent(share_id)}`;
    await copyText(url);
    alert('Share link copied!');
  } catch (e) {
    console.error(e);
    alert('Share failed (see console).');
  }
});

async function loadSharedFromURL() {
  const sp = new URLSearchParams(location.search);
  const share = sp.get('share');

  if (!share) {
    viewingShared = false;
    sharedMeta = { shareId: null, name: null };
    updateSharedUI();
    return false;
  }

  // Public read: works even when logged out (because of SELECT policy)
  const { data, error } = await supabase1
    .from('shared_patterns')
    .select('pattern_json,name')
    .eq('share_id', share)
    .eq('is_public', true)
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

  // Show banner
  viewingShared = true;
  sharedMeta = { shareId: share, name: data?.name || null };
  updateSharedUI();

  clearSelection?.();

  // Optional: reflect the shared name in UI
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

function updateSharedUI(){
  if (!sharedBanner) return;

  sharedBanner.style.display = viewingShared ? 'flex' : 'none';

  if (viewingShared) {
    const nm = sharedMeta?.name ? `"${sharedMeta.name}"` : 'this pattern';
    sharedBannerSub.textContent = `You can play and edit locally. Use “Save a copy” to keep it. (${nm})`;

    // Make shared view “read-only” in terms of destructive pattern management
    // (still allows Export/Import and other app features)
    renameBtn.disabled = true;
    deleteBtn.disabled = true;

    // You can decide whether Load should be enabled or not — I recommend leaving it enabled.
    // loadBtn.disabled = false;

  } else {
    // restore normal behavior
    updatePatternButtons(); // your existing logic
  }
}

// Banner buttons //
sharedSaveCopyBtn?.addEventListener('click', async () => {
  const base = sharedMeta?.name || 'Shared Pattern';
  const suggested = `${base} (copy)`;
  const name = prompt('Save a copy as:', suggested);
  if (!name) return;

  const ok = saveCurrentPatternAs(name);
  if (!ok) return;

  alert('Saved! You can now find it in your patterns list.');
});

sharedExitBtn?.addEventListener('click', () => {
  // Remove ?share=... from the URL without reloading
  const url = new URL(location.href);
  url.searchParams.delete('share');
  history.replaceState({}, '', url.toString());

  viewingShared = false;
  sharedMeta = { shareId: null, name: null };
  updateSharedUI();
});
