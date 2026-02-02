// ===== USER PROFILES =====
// Handles fetching, updating, and caching user profiles

let currentProfile = null;

// Fetch attributes for the *current* user
async function loadCurrentProfile() {
  if (!currentUser) {
    currentProfile = null;
    return;
  }

  try {
    const { data, error } = await supabase1
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
          // Trigger update logic
          if (typeof window.checkNumberPitchSelection === 'function') window.checkNumberPitchSelection();
          if (typeof window.buildHandpanOverlay === 'function') window.buildHandpanOverlay();
          if (typeof window.renderAllMeasures === 'function') window.renderAllMeasures();
        }
      }

      // Sync Grid Label Notation Preference
      if (currentProfile.grid_label_notation) {
        window.labelNotation = currentProfile.grid_label_notation;
        localStorage.setItem('labelNotation', window.labelNotation);

        // Trigger UI update if functions are available
        if (typeof window.updateNotationUI === 'function') window.updateNotationUI();
        if (typeof window.renderAllMeasures === 'function') window.renderAllMeasures();
      }
    } else {
      // Profile doesn't exist yet (maybe trigger failed or old user)
      // We can try to create one lazily
      console.log('No profile found, creating default...');
      await createDefaultProfile();
    }

    updateProfileUI(); // Update any UI components depending on profile
  } catch (err) {
    console.error('Profile load exception:', err);
  }
}

// Save preference to DB
async function updateUserLabelPreference(newPref) {
  if (!currentUser) return;
  // fast local update
  if (currentProfile) currentProfile.label_preference = newPref;

  try {
    await supabase1
      .from('profiles')
      .update({ label_preference: newPref, updated_at: new Date() })
      .eq('user_id', currentUser.id);
  } catch (e) {
    console.warn('Failed to save label preference:', e);
  }
}

// Save Grid Label Notation preference to DB
async function updateUserGridLabelNotation(newNotation) {
  if (!currentUser) return;
  // fast local update
  if (currentProfile) currentProfile.grid_label_notation = newNotation;

  try {
    await supabase1
      .from('profiles')
      .update({ grid_label_notation: newNotation, updated_at: new Date() })
      .eq('user_id', currentUser.id);
  } catch (e) {
    console.warn('Failed to save grid label notation preference:', e);
  }
}

async function createDefaultProfile() {
  if (!currentUser) return;

  const defaultUser = {
    user_id: currentUser.id,
    username: currentUser.email.split('@')[0], // heuristic
    bio: '',
    updated_at: new Date(),
  };

  const { data, error } = await supabase1
    .from('profiles')
    .insert([defaultUser])
    .select()
    .single();

  if (!error && data) {
    currentProfile = data;
  } else {
    console.warn('Failed to create default profile:', error);
  }
}



// Fetch ANY user's profile by ID (public)
async function getProfileById(userId) {
  const { data, error } = await supabase1
    .from('profiles')
    .select('username, bio, avatar_url')
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data) return null;
  return data;
}

// UI HANDLERS

const profileModal = document.getElementById('profileModal');
const profileUsernameInput = document.getElementById('profileUsername');
const profileFirstNameInput = document.getElementById('profileFirstName');
const profileLastNameInput = document.getElementById('profileLastName');
const profileBioInput = document.getElementById('profileBio');
const profileError = document.getElementById('profileError');
const openProfileBtn = document.getElementById('openProfileBtn');
const closeProfileBtn = document.getElementById('closeProfileBtn');
const saveProfileBtn = document.getElementById('saveProfileBtn');

function showError(msg) {
  if (profileError) {
    profileError.textContent = msg;
    profileError.style.display = 'flex';
  } else {
    alert(msg);
  }
}

function clearError() {
  if (profileError) {
    profileError.style.display = 'none';
    profileError.textContent = '';
  }
}

function openProfileEditor() {
  if (!currentProfile) return;

  clearError();
  // Populate fields
  profileUsernameInput.value = currentProfile.username || '';
  if (profileFirstNameInput) profileFirstNameInput.value = currentProfile.first_name || '';
  if (profileLastNameInput) profileLastNameInput.value = currentProfile.last_name || '';
  profileBioInput.value = currentProfile.bio || '';

  profileModal.classList.add('open');
  profileModal.setAttribute('aria-hidden', 'false');
  document.getElementById('accountDropdownMenu')?.classList.remove('show');
}

function closeProfileEditor() {
  profileModal.classList.remove('open');
  profileModal.setAttribute('aria-hidden', 'true');
}

window.closeProfileEditor = closeProfileEditor;
window.openProfileEditor = openProfileEditor;

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

  // Update "Signed in as..." text in dropdown if possible
  const statusEl = document.getElementById('authHint');
  // Removing this overwriting logic so distinct auth messages (errors/success) persist
  // if (statusEl) {
  //   if (currentProfile?.username) {
  //     statusEl.textContent = `Hi, ${currentProfile.username}!`;
  //   } else {
  //     statusEl.textContent = 'Signed in';
  //   }
  // }
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
  const { error } = await supabase1
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

  alert(`Profile updated!`);
  closeProfileEditor();
});

window.loadCurrentProfile = loadCurrentProfile;
window.getProfileById = getProfileById;

