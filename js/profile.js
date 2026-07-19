import { currentUser } from './state.js';
import { Modal } from './modal.js';
import { supabase } from './supabase-client.js';
import { renderAllMeasures } from './notegrid.js';
import { Bus, BUS_EVENT } from './bus.js';
import { setAccentPreset } from './brand.js';

// ===== USER PROFILES =====
// Handles fetching, updating, and caching user profiles

export let currentProfile = null;

// Fetch attributes for the *current* user
export async function loadCurrentProfile() {
  if (!currentUser) {
    currentProfile = null;
    return;
  }

  if (currentProfile !== null) {
    return;
  }

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

        // Try to update UI if it exists
        const sel = document.getElementById('numberPitchSelect');
        if (sel) {
          sel.value = currentProfile.label_preference;
          // Trigger update logic - Assumption: This function triggers internal update
          const event = new Event('change');
          sel.dispatchEvent(event);
        }
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
      applyAccentColor(currentProfile.accent_color || 'blue');
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
function applyAccentColor(color) {
  localStorage.setItem('accentColor', color);
  document.body.classList.toggle('accent-purple', color === 'purple');
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
  await loadCurrentProfile();
});

// ===== SUBSCRIPTION EXPIRY BANNER =====

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

  // Check if user dismissed this specific expiry period
  if (isExpired) {
    const dismissedUntil = localStorage.getItem('subscription_banner_dismissed');
    if (dismissedUntil && new Date(dismissedUntil) >= new Date(expiresAt)) {
      banner.style.display = 'none';
      return;
    }
  }

  if (isExpired) {
    banner.classList.add('subscription-banner--expired');
    title.textContent = 'Your Panafide access has expired';
    sub.textContent   = 'Renew to keep your compositions and full course access.';
    btn.textContent   = 'Renew Now';
    if (dismissLabel) dismissLabel.style.display = '';
    if (dismissCheck) dismissCheck.checked = false;
  } else {
    banner.classList.remove('subscription-banner--expired');
    title.textContent = `Your access expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
    sub.textContent   = 'Renew before it expires to keep your full access.';
    btn.textContent   = 'Renew Access';
    if (dismissLabel) dismissLabel.style.display = 'none';
  }

  banner.style.display = '';
  btn.addEventListener('click', () => {
    Bus.emit(BUS_EVENT.SHOW_UPGRADE_MODAL, { feature: 'renewal' });
  }, { once: true });
  closeBtn?.addEventListener('click', () => {
    if (isExpired && dismissCheck?.checked) {
      localStorage.setItem('subscription_banner_dismissed', expiresAt);
    }
    banner.style.display = 'none';
  }, { once: true });
}
