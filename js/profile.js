import { currentUser } from './state.js';
import { Modal } from './modal.js';
import { supabase } from './supabase-client.js';
import { renderAllMeasures } from './notegrid.js';
import { Bus, BUS_EVENT } from './bus.js';
import { setAccentPreset } from './brand.js';

// ===== USER PROFILES =====
// Handles fetching, updating, and caching user profiles

export let currentProfile = null;

// Several modules react to sign-in at once and each awaits this; they share
// one in-flight request instead of each fetching the row.
let profileLoad = null;

// Fetch attributes for the *current* user. Other modules read fields from the
// resulting currentProfile rather than querying `profiles` themselves.
// refresh: refetch even if loaded, e.g. after a subscription change.
export async function loadCurrentProfile({ refresh = false } = {}) {
  if (!currentUser) {
    currentProfile = null;
    return;
  }

  // Cached only if it's this user's: after a sign-out and a different sign-in
  // (no reload), the previous user's profile would otherwise be reused.
  if (!refresh && currentProfile?.user_id === currentUser.id) return;
  if (profileLoad?.userId === currentUser.id) return profileLoad.promise;

  const promise = fetchCurrentProfile();
  profileLoad = { userId: currentUser.id, promise };
  try {
    await promise;
  } finally {
    if (profileLoad?.promise === promise) profileLoad = null;
  }
}

async function fetchCurrentProfile() {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', currentUser.id)
      .maybeSingle();

    if (error) {
      console.error('Error loading profile:', error);
      return;
    }

    if (data) {
      currentProfile = data;
      // Sync Preference to LocalStorage & UI immediately if set
      if (currentProfile.label_preference) {
        localStorage.setItem('handpanLabelPref', currentProfile.label_preference);

        // Apply it (js/handpanmap.js); not saved back, it came from the profile
        Bus.emit(BUS_EVENT.SET_LABEL_PREF, { value: currentProfile.label_preference });
      }

      // Sync Grid Label Notation Preference
      if (currentProfile.grid_label_notation) {
        // Dispatch event to update controls.js
        window.dispatchEvent(new CustomEvent('labelNotationChanged', { detail: currentProfile.grid_label_notation }));
        localStorage.setItem('labelNotation', currentProfile.grid_label_notation);

        // Trigger UI update if functions are available
        // Assumption: controls.js handles logic based on global/localstorage.
        // We can just re-render.
        const labelBtn = document.getElementById('labelNotationBtn');
        if (labelBtn) {
          // Simulate click or just update UI?
          // Since updateNotationUI is internal to controls.js, we rely on state + render.
          // We can trigger a click on the button if really needed, but that toggles it.
          // Best to just force UI text update if we could access it.
          // For now, renderAllMeasures refreshes grid labels.
        }
        renderAllMeasures();
      }

      // Sync Accent Colour Preference
      if (!ACCENT_PRESETS.includes(currentProfile.accent_color)) currentProfile.accent_color = 'blue';
      applyAccentColor(currentProfile.accent_color);
    } else {
      console.log('No profile found, creating default...');
      await createDefaultProfile();
    }

    updateProfileUI(); // Update any UI components depending on profile
    Bus.emit(BUS_EVENT.PROFILE_LOADED, { profile: currentProfile });
    initSubscriptionBanner(currentProfile);
  } catch (err) {
    console.error('Profile load exception:', err);
  }
}

// Save preference to DB
export async function updateUserLabelPreference(newPref) {
  if (!currentUser) return;
  // fast local update
  if (currentProfile) currentProfile.label_preference = newPref;

  try {
    await supabase
      .from('profiles')
      .update({ label_preference: newPref, updated_at: new Date() })
      .eq('user_id', currentUser.id);
  } catch (e) {
    console.warn('Failed to save label preference:', e);
  }
}

// Save Grid Label Notation preference to DB
export async function updateUserGridLabelNotation(newNotation) {
  if (!currentUser) return;
  // fast local update
  if (currentProfile) currentProfile.grid_label_notation = newNotation;

  try {
    await supabase
      .from('profiles')
      .update({ grid_label_notation: newNotation, updated_at: new Date() })
      .eq('user_id', currentUser.id);
  } catch (e) {
    console.warn('Failed to save grid label notation preference:', e);
  }
}

// Apply an accent colour preset to the document + canvas/print contexts,
// and remember it locally so it survives reload without a flash of blue.
// Known presets; anything else (e.g. the retired purple) is the default blue
const ACCENT_PRESETS = ['blue', 'zen'];

function applyAccentColor(color) {
  if (!ACCENT_PRESETS.includes(color)) color = 'blue';
  localStorage.setItem('accentColor', color);
  document.body.classList.forEach(c => { if (c.startsWith('accent-')) document.body.classList.remove(c); });
  if (color && color !== 'blue') document.body.classList.add(`accent-${color}`);
  setAccentPreset(color);
}

// Save accent colour preference to DB
export async function updateUserAccentColor(newColor) {
  applyAccentColor(newColor);
  if (!currentUser) return;
  if (currentProfile) currentProfile.accent_color = newColor;

  try {
    await supabase
      .from('profiles')
      .update({ accent_color: newColor, updated_at: new Date() })
      .eq('user_id', currentUser.id);
  } catch (e) {
    console.warn('Failed to save accent colour preference:', e);
  }
}

export async function updateAutoSavePref(on) {
  if (!currentUser) return;
  if (currentProfile) currentProfile.autosave = on;
  try {
    await supabase
      .from('profiles')
      .update({ autosave: on, updated_at: new Date() })
      .eq('user_id', currentUser.id);
  } catch (e) {
    console.warn('Failed to save auto-save preference:', e);
  }
}

export async function updateDashboardMute(muted) {
  if (!currentUser) return;
  if (currentProfile) currentProfile.dashboard_mute = muted;
  try {
    await supabase
      .from('profiles')
      .update({ dashboard_mute: muted, updated_at: new Date() })
      .eq('user_id', currentUser.id);
  } catch (e) {
    console.warn('Failed to save dashboard mute preference:', e);
  }
}

async function createDefaultProfile() {
  if (!currentUser) return;

  const defaultUser = {
    user_id: currentUser.id,
    username: currentUser.email.split('@')[0], // heuristic
    first_name: currentUser.user_metadata?.first_name || null,
    last_name: currentUser.user_metadata?.last_name || null,
    bio: '',
    role: currentUser.user_metadata?.is_admin ? 'admin' : 'student',
    updated_at: new Date(),
  };

  const { data, error } = await supabase
    .from('profiles')
    .upsert([defaultUser], { onConflict: 'user_id' })
    .select()
    .single();

  if (!error && data) {
    currentProfile = data;
  } else {
    console.warn('Failed to create default profile:', error);
  }
}



// Fetch ANY user's profile by ID (public)
export async function getProfileById(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('username, bio, avatar_url')
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data) return null;
  return data;
}

// UI HANDLERS

const profileModal = document.getElementById('profileModal');
const profilePanel = new Modal(profileModal);
const profileUsernameInput = document.getElementById('profileUsername');
const profileFirstNameInput = document.getElementById('profileFirstName');
const profileLastNameInput = document.getElementById('profileLastName');
const profileBioInput = document.getElementById('profileBio');
const profileError = document.getElementById('profileError');
const openProfileBtn = document.getElementById('openProfileBtn');
const closeProfileBtn = document.getElementById('closeProfileBtn');
const saveProfileBtn = document.getElementById('saveProfileBtn');

async function showError(msg) {
  if (profileError) {
    profileError.textContent = msg;
    profileError.style.display = 'flex';
  } else {
    await alert(msg);
  }
}

function clearError() {
  if (profileError) {
    profileError.style.display = 'none';
    profileError.textContent = '';
  }
}

export function openProfileEditor() {
  if (!currentProfile) return;

  clearError();
  // Populate fields
  profileUsernameInput.value = currentProfile.username || '';
  if (profileFirstNameInput) profileFirstNameInput.value = currentProfile.first_name || '';
  if (profileLastNameInput) profileLastNameInput.value = currentProfile.last_name || '';
  profileBioInput.value = currentProfile.bio || '';

  profilePanel.open();
  document.getElementById('accountDropdownMenu')?.classList.remove('show');
}

export function closeProfileEditor() {
  profilePanel.close();
}

function updateProfileUI() {
  // Update the 'Account' button text to be the username if we have it, else email char
  const btn = document.getElementById('accountBtn');
  if (btn && currentUser) {
    if (currentProfile?.username) {
      // Use first char of username
      btn.textContent = currentProfile.username.substring(0, 1).toUpperCase();
    } else {
      btn.textContent = currentUser.email.charAt(0).toUpperCase();
    }
  }
}

// Listeners

openProfileBtn?.addEventListener('click', openProfileEditor);
closeProfileBtn?.addEventListener('click', closeProfileEditor);

saveProfileBtn?.addEventListener('click', async () => {
  const newUsername = profileUsernameInput.value.trim();
  const newFirstName = profileFirstNameInput ? profileFirstNameInput.value.trim() : '';
  const newLastName = profileLastNameInput ? profileLastNameInput.value.trim() : '';
  const newBio = profileBioInput.value.trim();

  clearError();

  if (newUsername.length < 3) {
    showError("Username must be at least 3 characters.");
    return;
  }

  saveProfileBtn.disabled = true;
  saveProfileBtn.textContent = "Saving...";

  if (!currentUser) return;

  // Handle Profile Data Update
  const { error } = await supabase
    .from('profiles')
    .update({
      username: newUsername,
      first_name: newFirstName,
      last_name: newLastName,
      bio: newBio,
      updated_at: new Date(),
    })
    .eq('user_id', currentUser.id);

  saveProfileBtn.disabled = false;
  saveProfileBtn.textContent = "Save Profile";

  if (error) {
    console.error("Profile update error:", error);
    if (error.code === '23505') { // Postgres Unique Violation
      showError("Username is already taken. Please enter another username.");
    } else {
      showError(`Update failed: ${error.message}`);
    }
    return;
  }

  // Success
  currentProfile = {
    ...currentProfile,
    username: newUsername,
    first_name: newFirstName,
    last_name: newLastName,
    bio: newBio
  };
  updateProfileUI();

  await alert(`Profile updated!`);
  closeProfileEditor();
});

// Event Bus Listener: Profile Load
Bus.on(BUS_EVENT.PROFILE_LOAD_NEEDED, async () => {
  await loadCurrentProfile({ refresh: true });
});

// ===== SUBSCRIPTION EXPIRY BANNER =====

let bannerState = {};
let bannerWired = false;

export function initSubscriptionBanner(profile) {
  const banner       = document.getElementById('subscriptionBanner');
  const title        = document.getElementById('subscriptionBannerTitle');
  const sub          = document.getElementById('subscriptionBannerSub');
  const btn          = document.getElementById('subscriptionBannerBtn');
  const closeBtn     = document.getElementById('subscriptionBannerCloseBtn');
  const dismissLabel = document.getElementById('subscriptionBannerDismissLabel');
  const dismissCheck = document.getElementById('subscriptionBannerDismiss');
  if (!banner || !title || !sub || !btn) return;

  const tier      = profile?.subscription_tier;
  const expiresAt = profile?.subscription_expires_at;
  if (!expiresAt || (tier !== 'player_plus' && tier !== 'pro')) {
    banner.style.display = 'none';
    return;
  }

  const msLeft   = new Date(expiresAt) - new Date();
  const daysLeft = Math.ceil(msLeft / 86400000);

  if (daysLeft > 14) {
    banner.style.display = 'none';
    return;
  }

  const isExpired = daysLeft <= 0;
  const status = profile.subscription_status;
  const viaStripe = profile.subscription_source === 'stripe';

  // Stripe renews by itself; only flag a cancel, a pause or a missed payment.
  if (viaStripe && status === 'active' && !isExpired) {
    banner.style.display = 'none';
    return;
  }

  // Check if user dismissed this specific expiry period
  if (isExpired) {
    const dismissedUntil = localStorage.getItem('subscription_banner_dismissed');
    if (dismissedUntil && new Date(dismissedUntil) >= new Date(expiresAt)) {
      banner.style.display = 'none';
      return;
    }
  }

  // Plus granted by a group or private program (Tekmatix client tags).
  const viaProgram = profile.subscription_source === 'tekmatix';
  const tierName = tier === 'pro' ? 'Panafide Pro' : 'Panafide+';

  let manage = false;
  const endDate = new Date(expiresAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric' });

  if (viaStripe && ['canceling', 'paused', 'active'].includes(status)) {
    manage = true;
    banner.classList.toggle('subscription-banner--expired', isExpired);
    if (status === 'canceling') {
      title.textContent = 'Your subscription has been cancelled';
      sub.textContent   = `Your Panafide+ benefits end on ${endDate}.`;
      btn.textContent   = 'Keep Panafide+';
    } else if (status === 'paused') {
      title.textContent = 'Panafide+ is paused';
      sub.textContent   = isExpired
        ? 'Everything you made is still saved. Resume any time.'
        : `You keep your benefits until ${endDate}.`;
      btn.textContent   = isExpired ? 'Resume' : 'Manage';
    } else {
      title.textContent = 'Your last payment didn\'t go through';
      sub.textContent   = 'Update your card to keep Panafide+.';
      btn.textContent   = 'Update Card';
    }
    if (dismissLabel) dismissLabel.style.display = isExpired ? '' : 'none';
    if (dismissCheck) dismissCheck.checked = false;
  } else if (isExpired) {
    banner.classList.add('subscription-banner--expired');
    title.textContent = viaProgram ? `${tierName} from your program has ended` : 'Your Panafide access has expired';
    sub.textContent   = viaProgram
      ? 'Become a member to keep it, and save on every future program.'
      : 'Renew to keep your compositions and full course access.';
    btn.textContent   = viaProgram ? 'Become a Member' : 'Renew Now';
    if (dismissLabel) dismissLabel.style.display = '';
    if (dismissCheck) dismissCheck.checked = false;
  } else if (viaProgram) {
    banner.classList.remove('subscription-banner--expired');
    title.textContent = `${tierName} from your program ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
    sub.textContent   = 'Joining the next group or booking more lessons? It continues automatically. Otherwise, become a member and save on every future program.';
    btn.textContent   = 'Become a Member';
    if (dismissLabel) dismissLabel.style.display = 'none';
  } else {
    banner.classList.remove('subscription-banner--expired');
    title.textContent = `Your access expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
    sub.textContent   = 'Renew before it expires to keep your full access.';
    btn.textContent   = 'Renew Access';
    if (dismissLabel) dismissLabel.style.display = 'none';
  }

  banner.style.display = '';
  bannerState = { manage, isExpired, expiresAt };
  if (bannerWired) return;
  bannerWired = true;

  // Wired once and read bannerState on click, so every click works and re-renders don't stack listeners.
  btn.addEventListener('click', () => {
    if (bannerState.manage) Bus.emit(BUS_EVENT.SHOW_MANAGE_SUBSCRIPTION);
    else Bus.emit(BUS_EVENT.SHOW_UPGRADE_MODAL, { feature: 'renewal' });
  });
  closeBtn?.addEventListener('click', () => {
    if (bannerState.isExpired && dismissCheck?.checked) {
      localStorage.setItem('subscription_banner_dismissed', bannerState.expiresAt);
    }
    banner.style.display = 'none';
  });
}
