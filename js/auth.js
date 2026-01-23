// Admin functionality
function isAdminUser(user) {
  const email = user?.email?.toLowerCase?.() || "";
  return ADMIN_EMAILS.has(email);
}

function updateAdminUI() {
  const show = isAdminUser(currentUser);

  // Toggle all admin-only elements
  document.querySelectorAll('.admin-only').forEach(el => {
    // Force specific display type for buttons if needed, or just let CSS/default handle it
    // Some buttons need 'block', others 'inline'. "" lets CSS take over.
    el.style.display = show ? "" : "none";
  });

  // if they were calibrating and lost admin (logout), force it off
  if (!show && document.body.classList.contains("calibrating")) {
    document.body.classList.remove("calibrating");
  }
}

// Auth modal
function openAuthModal() {
  authModal.classList.add('open');
  authModal.setAttribute('aria-hidden', 'false');

  if (currentUser) {
    // PRE-FILL if signed in
    if (authEmail) authEmail.value = currentUser.email;
    if (authPass) {
      authPass.value = '';
      authPass.placeholder = 'New Password';
    }
    // Do NOT focus
  } else {
    // Clear if signed out
    if (authEmail) authEmail.value = '';
    if (authPass) {
      authPass.value = '';
      authPass.placeholder = '••••••••';
    }
    setTimeout(() => authEmail?.focus(), 0);
  }

  // Refresh user state in background to catch email updates/verifications
  (async () => {
    const { data } = await supabase1.auth.getUser();
    if (data?.user) {
      // Create a new reference to trigger updates if needed, though mutation is simpler here
      // Checking for differences could be done, but blind update is safe/fast enough
      const oldEmail = currentUser?.email;
      currentUser = data.user;

      if (oldEmail !== currentUser.email) {
        updateAccountUI();
        updateAdminUI();
      }
    }
  })();
}
function closeAuthModal() {
  authModal.classList.remove('open');
  authModal.setAttribute('aria-hidden', 'true');
}

// Dropdown
const accountDropdownMenu = document.getElementById('accountDropdownMenu');
const authLogoutDropdown = document.getElementById('authLogoutDropdown');

function updateAccountUI() {
  if (!accountStatus) return;
  if (currentUser) {
    if (accountStatus) accountStatus.textContent = ''; // Clear "Not signed in"
    // Set button text to first letter of email
    if (accountBtn) accountBtn.textContent = currentUser.email.charAt(0).toUpperCase();

    // Signed In Mode
    if (authLogout) authLogout.style.display = 'none'; // OLD logic? Wait, index.html has authLogoutDropdown button
    // Let's rely on IDs found in index.html (authBtn, profileBtn, myScalesBtn, signOutBtn)

    // Auth Modal buttons
    if (authLogin) authLogin.style.display = 'none';
    if (authRegister) authRegister.style.display = 'none';

    // Dropdown Links
    const profileBtn = document.getElementById('profileBtn');
    if (profileBtn) profileBtn.style.display = 'block';

    const myScalesBtn = document.getElementById('myScalesBtn');
    if (myScalesBtn) myScalesBtn.style.display = 'block';

    const signOutBtn = document.getElementById('signOutBtn') || document.getElementById('authLogoutDropdown');
    if (signOutBtn) signOutBtn.style.display = 'block';

    const authBtnLink = document.getElementById('authBtn'); // "Sign In / Register" in dropdown
    if (authBtnLink) authBtnLink.style.display = 'none'; // Hide "Sign In" link

    // Default state: Hidden password update
    document.getElementById('authUpdatePassword').style.display = 'none';
    document.getElementById('authUpdateEmail').style.display = 'none'; // Hidden default
    document.getElementById('authForgotPassword').style.display = 'none';

    document.getElementById('authPasswordRow').style.display = 'none'; // Lock row initially
    document.getElementById('authPasswordConfirmRow').style.display = 'none';
    document.getElementById('authCurrentPassRow').style.display = 'none'; // Hidden default
    document.getElementById('authTogglePasswordBtn').style.display = ''; // Show "Change Password" link

    // Update hint only if it's the default or signed-out message
    const hint = document.getElementById('authHint');
    if (hint && (hint.textContent.includes('Tip:') || hint.textContent === 'Signed out.' || hint.textContent === 'Not signed in')) {
      hint.textContent = `Signed in as ${currentUser.email}`;
    }

  } else {
    accountStatus.textContent = '';
    // Reset button text
    if (accountBtn) accountBtn.textContent = 'Sign In / Register';

    // Close dropdown if open
    if (accountDropdownMenu) accountDropdownMenu.classList.remove('show');

    // Signed Out Mode
    // Dropdown Links
    const profileBtn = document.getElementById('profileBtn');
    if (profileBtn) profileBtn.style.display = 'none';

    const myScalesBtn = document.getElementById('myScalesBtn');
    if (myScalesBtn) myScalesBtn.style.display = 'none';

    const signOutBtn = document.getElementById('signOutBtn') || document.getElementById('authLogoutDropdown');
    if (signOutBtn) signOutBtn.style.display = 'none';

    const authBtnLink = document.getElementById('authBtn');
    if (authBtnLink) authBtnLink.style.display = 'block';

    if (authLogout) authLogout.style.display = 'none';
    if (authLogin) authLogin.style.display = '';
    if (authRegister) authRegister.style.display = '';

    document.getElementById('authUpdatePassword').style.display = 'none';
    document.getElementById('authUpdateEmail').style.display = 'none';
    document.getElementById('authForgotPassword').style.display = '';

    document.getElementById('authPasswordRow').style.display = ''; // Show row
    document.getElementById('authCurrentPassRow').style.display = 'none';
    document.getElementById('authPasswordConfirmRow').style.display = 'none'; // Hide confirm on login
    document.getElementById('authTogglePasswordBtn').style.display = 'none'; // Hide link

    // Reset inputs
    if (authPass) authPass.placeholder = '••••••••';

    // Reset hint to default
    const hint = document.getElementById('authHint');
    if (hint) hint.textContent = 'Tip: Use Register once, then Sign in.';
  }
}

let authInitDone = false;

async function initAuthSession() {
  if (authInitDone) return;
  authInitDone = true;

  // Subscribe ONCE
  // Subscribe ONCE
  supabase1.auth.onAuthStateChange(async (event, session) => {
    // Ensure accurate global state
    currentUser = session?.user ?? null;
    window.currentUser = currentUser; // Explicit global

    updateAccountUI();
    updateAdminUI();

    // IMPORTANT: never await Supabase calls inside this callback directly to avoid blocking
    // We utilize a small timeout to allow internal Supabase client headers to update
    setTimeout(async () => {
      try {
        // safe to do async work here
        if (typeof refreshPatternSelect === 'function') await refreshPatternSelect();
        if (typeof loadCurrentProfile === 'function') await loadCurrentProfile();
        if (typeof loadAllUserHandpans === 'function') await loadAllUserHandpans();

        window.dispatchEvent(new Event('handpan-loaded'));
      } catch (e) {
        console.warn('Post-auth refresh failed:', e);
      }
    }, 500); // 500ms delay to ensure token propagation
  });
}

initAuthSession();

async function initScale() {
  let name = null;

  if (currentUser) name = await loadScaleRemote();
  if (!name) name = loadScaleLocal();
  if (!name || !SCALES[name]) name = Object.keys(SCALES)[0];

  selectedScaleName = name;
  scaleSelect.value = name;
  scaleStatus.textContent = `Scale: ${name}`;

  await preloadScaleSamples();
}

initScale();

// Auth modal
// accountBtn?.addEventListener('click', openAuthModal); // REMOVED standard listener

const authCancel = document.getElementById('authCancel');

// New Logic: Click Account -> If Signed In (Toggle Dropdown) ELSE (Open Modal)
accountBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  if (currentUser) {
    // Toggle Dropdown
    accountDropdownMenu?.classList.toggle('show');
  } else {
    // Open Modal
    openAuthModal();
  }
});

// Auto-close Account Dropdown on Item Click
accountDropdownMenu?.addEventListener('click', (e) => {
  if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
    accountDropdownMenu.classList.remove('show');
  }
});

// "Account Settings" from dropdown
document.getElementById('openAccountAuthBtn')?.addEventListener('click', () => {
  accountDropdownMenu?.classList.remove('show');
  openAuthModal();
});

authCancel?.addEventListener('click', closeAuthModal);
document.getElementById('closeAuthBtn')?.addEventListener('click', closeAuthModal);

// Close dropdown when clicking outside
window.addEventListener('click', (e) => {
  if (accountBtn && accountDropdownMenu && !accountBtn.contains(e.target) && !accountDropdownMenu.contains(e.target)) {
    accountDropdownMenu.classList.remove('show');
  }
});

// Close Auth Modal when clicking outside (overlay)
authModal?.addEventListener('click', (e) => {
  if (e.target === authModal) {
    closeAuthModal();
  }
});

// Logout Cleanup
function performLogoutCleanup() {
  // 1. Close Sidebar
  if (typeof closeSidebar === 'function') {
    closeSidebar();
  } else {
    // Fallback if function not global
    const sb = document.getElementById('courseSidebar');
    if (sb) {
      sb.classList.remove('open');
      sb.setAttribute('aria-hidden', 'true');
    }
  }

  // 2. Close all other modals (except Auth)
  const modals = document.querySelectorAll('.modal-overlay');
  modals.forEach(modal => {
    if (modal.id !== 'authModal') {
      // Handle various hiding mechanisms used in the app
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
      if (modal.style.display === 'block' || modal.style.display === 'flex') {
        modal.style.display = 'none';
      }
    }
  });

  // Specific check for any other floating panels if needed
}

authLogoutDropdown?.addEventListener('click', async () => {
  await supabase1.auth.signOut();
  window.location.reload();
});


// Modal Action Buttons (Actual Submit)
const authUpdatePassword = document.getElementById('authUpdatePassword');
const authPassConfirm = document.getElementById('authPassConfirm');

authUpdatePassword?.addEventListener('click', async () => {
  const newPassword = authPass.value;
  const confirm = authPassConfirm.value;

  if (!newPassword) {
    authHint.textContent = 'Please enter a new password.';
    authPass.focus();
    return;
  }

  if (newPassword !== confirm) {
    authHint.textContent = 'Passwords do not match.';
    authPassConfirm.focus();
    return;
  }

  authHint.textContent = 'Updating password...';
  const { error } = await supabase1.auth.updateUser({ password: newPassword });

  if (error) {
    authHint.textContent = `Error: ${error.message}`;
  } else {
    authHint.textContent = 'Password updated successfully!';
    authPass.value = '';
    authPassConfirm.value = '';
    setTimeout(() => closeAuthModal(), 1500);
  }
});

authRegister?.addEventListener('click', async () => {
  const email = authEmail.value.trim();
  const password = authPass.value;
  authHint.textContent = 'Registering...';
  const { data, error } = await supabase1.auth.signUp({ email, password });
  if (error) { authHint.textContent = error.message; return; }
  authHint.textContent = 'Registered! Please check your email for confirmation, then sign in.';
  authEmail.value = '';
  authPass.value = '';
  authPassConfirm.value = '';
});

authLogin?.addEventListener('click', async () => {
  const email = authEmail.value.trim();
  const password = authPass.value;
  authHint.textContent = 'Signing in...';
  const { data, error } = await supabase1.auth.signInWithPassword({ email, password });
  if (error) { authHint.textContent = error.message; return; }
  currentUser = data.user;
  authHint.textContent = 'Signed in!';
  updateAccountUI();
  updateAdminUI();
  closeAuthModal();
  await refreshPatternSelect();
  initScale();
});

// Forgot Password
document.getElementById('authForgotPassword')?.addEventListener('click', async () => {
  const email = authEmail.value.trim();
  if (!email) {
    authHint.textContent = 'Please enter your email above first.';
    authEmail.focus();
    return;
  }

  authHint.textContent = 'Sending reset link...';
  const { error } = await supabase1.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin, // Sends them back here
  });

  if (error) {
    authHint.textContent = `Error: ${error.message}`;
  } else {
    authHint.textContent = 'Reset link sent! Check your email.';
  }
});

// Toggle Password Update UI
document.getElementById('authTogglePasswordBtn')?.addEventListener('click', () => {
  document.getElementById('authPasswordRow').style.display = '';
  document.getElementById('authPasswordConfirmRow').style.display = ''; // Show confirm
  document.getElementById('authUpdatePassword').style.display = '';
  document.getElementById('authTogglePasswordBtn').style.display = 'none';
  // Hide Email update UI to avoid confusion
  document.getElementById('authCurrentPassRow').style.display = 'none';
  document.getElementById('authUpdateEmail').style.display = 'none';
  authPass.focus();
});

// Detect Email Change
authEmail?.addEventListener('input', () => {
  if (!currentUser) return;
  const current = currentUser.email;
  const val = authEmail.value.trim();

  if (val !== current) {
    // Show Email Update UI
    document.getElementById('authCurrentPassRow').style.display = '';
    document.getElementById('authUpdateEmail').style.display = '';

    // Hide Password Update UI to avoid confusion
    document.getElementById('authPasswordRow').style.display = 'none';
    document.getElementById('authPasswordConfirmRow').style.display = 'none';
    document.getElementById('authUpdatePassword').style.display = 'none';
    document.getElementById('authTogglePasswordBtn').style.display = 'none'; // Hide toggle
  } else {
    // Revert
    document.getElementById('authCurrentPassRow').style.display = 'none';
    document.getElementById('authUpdateEmail').style.display = 'none';
    // Show password toggle again
    document.getElementById('authTogglePasswordBtn').style.display = '';
  }
});

// Update Email Action
const authUpdateEmail = document.getElementById('authUpdateEmail');
const authCurrentPass = document.getElementById('authCurrentPass');

authUpdateEmail?.addEventListener('click', async () => {
  const newEmail = authEmail.value.trim();
  const password = authCurrentPass.value;

  if (!password) {
    authHint.textContent = 'Please enter your current password.';
    authCurrentPass.focus();
    return;
  }

  authHint.textContent = 'Verifying...';

  // Re-auth
  const { error: loginErr } = await supabase1.auth.signInWithPassword({
    email: currentUser.email,
    password: password
  });

  if (loginErr) {
    authHint.textContent = 'Incorrect password.';
    return;
  }

  authHint.textContent = 'Updating email...';
  // "emailRedirectTo" ensures the user lands back here after clicking the link
  const { error } = await supabase1.auth.updateUser(
    { email: newEmail },
    { emailRedirectTo: window.location.href }
  );

  if (error) {
    authHint.textContent = `Error: ${error.message}`;
  } else {
    // Crucial: Warn user about double verification if applicable
    authHint.textContent = 'Please check BOTH your old and new email inboxes. You must click both verification links to complete the change.';
    authCurrentPass.value = '';
    // Do not close modal automatically
  }
});

// Keep existing logout for safety if it exists elsewhere
authLogout?.addEventListener('click', async () => {
  await supabase1.auth.signOut();
  window.location.reload();
});