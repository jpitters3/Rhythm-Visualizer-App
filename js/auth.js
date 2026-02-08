import { ADMIN_EMAILS, SCALES } from './config.js';
import { loadScaleRemote, loadScaleLocal, preloadScaleSamples } from './noteplayer.js';
import { setSelectedScaleName } from './state.js';
import { supabase } from './supabase-client.js';
import { closeSidebar } from './courses.js';

export let currentUser = null;

export function getCurrentUser() {
  return currentUser;
}

export async function isAuthed() {
  if (typeof supabase === 'undefined' || !supabase.auth) return false;
  try {
    // Check session validity (token refresh if needed)
    const { data } = await supabase.auth.getUser();
    return !!(data?.user);
  } catch (e) {
    console.warn('Auth check failed:', e);
    return false;
  }
}

// Admin functionality
export function isAdminUser(user) {
  const email = user?.email?.toLowerCase?.() || "";
  const isMetadataAdmin = user?.user_metadata?.is_admin === true;
  return ADMIN_EMAILS.has(email) || email.startsWith('test.user.') || isMetadataAdmin;
}

export function updateAdminUI() {
  const show = isAdminUser(currentUser);

  // Toggle all admin-only elements
  document.querySelectorAll('.admin-only').forEach(el => {
    // Force specific display type for buttons if needed, or just let CSS/default handle it
    el.style.display = show ? "" : "none";
  });

  // if they were calibrating and lost admin (logout), force it off
  if (!show && document.body.classList.contains("calibrating")) {
    document.body.classList.remove("calibrating");
  }
}

// Elements (Globals previously, now local resolution if possible, or assume global ID access)
const authModal = document.getElementById('authModal');
const authEmail = document.getElementById('authEmail');
const authPass = document.getElementById('authPass');
const authHint = document.getElementById('authHint');
const accountStatus = document.getElementById('accountStatus');
const accountBtn = document.getElementById('accountBtn');
const authLogin = document.getElementById('authLogin');
const authRegister = document.getElementById('authRegister');
const authLogout = document.getElementById('authLogout');

// Auth modal
export function openAuthModal() {
  if (!authModal) return;
  authModal.classList.add('open');
  authModal.setAttribute('aria-hidden', 'false');

  if (currentUser) {
    // PRE-FILL if signed in
    if (authEmail) authEmail.value = currentUser.email;
    if (authPass) {
      authPass.value = '';
      authPass.placeholder = 'New Password';
    }
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
    if (!supabase) return;
    const { data } = await supabase.auth.getUser();
    if (data?.user) {
      const oldEmail = currentUser?.email;
      currentUser = data.user;

      if (oldEmail !== currentUser.email) {
        updateAccountUI();
        updateAdminUI();
      }
    }
  })();
}

export function closeAuthModal() {
  if (!authModal) return;
  authModal.classList.remove('open');
  authModal.setAttribute('aria-hidden', 'true');
}

// Dropdown
const accountDropdownMenu = document.getElementById('accountDropdownMenu');
const authLogoutDropdown = document.getElementById('authLogoutDropdown');

export function updateAccountUI() {
  if (!accountStatus) return;
  if (currentUser) {
    if (accountStatus) accountStatus.textContent = ''; // Clear "Not signed in"
    // Set button text to first letter of email
    if (accountBtn) accountBtn.textContent = currentUser.email.charAt(0).toUpperCase();

    // Signed In Mode
    if (authLogout) authLogout.style.display = 'none';

    // Auth Modal buttons
    if (authLogin) authLogin.style.display = 'none';
    if (authRegister) authRegister.style.display = 'none';

    // Dropdown Links
    const profileBtn = document.getElementById('openProfileBtn');
    if (profileBtn) profileBtn.style.display = 'block';

    const myScalesBtn = document.getElementById('myScalesBtn');
    if (myScalesBtn) myScalesBtn.style.display = 'block';

    const signOutBtn = document.getElementById('signOutBtn') || document.getElementById('authLogoutDropdown');
    if (signOutBtn) signOutBtn.style.display = 'block';

    const authBtnLink = document.getElementById('authBtn'); // "Sign In / Register" in dropdown
    if (authBtnLink) authBtnLink.style.display = 'none'; // Hide "Sign In" link

    // Default state: Hidden password update
    const upPass = document.getElementById('authUpdatePassword');
    if (upPass) upPass.style.display = 'none';
    const upEmail = document.getElementById('authUpdateEmail');
    if (upEmail) upEmail.style.display = 'none';
    const forgot = document.getElementById('authForgotPassword');
    if (forgot) forgot.style.display = 'none';

    // Ensure "Account Settings" is visible when logged in
    const accSetBtn = document.getElementById('openAccountAuthBtn');
    if (accSetBtn) accSetBtn.style.display = 'block';


    const pr = document.getElementById('authPasswordRow');
    if (pr) pr.style.display = 'none';
    const pcr = document.getElementById('authPasswordConfirmRow');
    if (pcr) pcr.style.display = 'none';
    const cpr = document.getElementById('authCurrentPassRow');
    if (cpr) cpr.style.display = 'none';
    const tpb = document.getElementById('authTogglePasswordBtn');
    if (tpb) tpb.style.display = '';

    // Update hint only if it's the default or signed-out message
    const hint = document.getElementById('authHint');
    if (hint && (hint.textContent.includes('Tip:') || hint.textContent === 'Signed out.' || hint.textContent === 'Not signed in')) {
      hint.textContent = `Signed in as ${currentUser.email} `;
    }

  } else {
    accountStatus.textContent = '';
    // Reset button text
    if (accountBtn) accountBtn.textContent = 'Sign In / Register';

    // Close dropdown if open
    if (accountDropdownMenu) accountDropdownMenu.classList.remove('show');

    // Signed Out Mode
    const profileBtn = document.getElementById('openProfileBtn');
    if (profileBtn) profileBtn.style.display = 'none';

    const myScalesBtn = document.getElementById('myScalesBtn');
    if (myScalesBtn) myScalesBtn.style.display = 'none';

    const signOutBtn = document.getElementById('signOutBtn') || document.getElementById('authLogoutDropdown');
    if (signOutBtn) signOutBtn.style.display = 'none';

    // Hide Account Settings when logged out (redundant with Sign In)
    const accSetBtn = document.getElementById('openAccountAuthBtn');
    if (accSetBtn) accSetBtn.style.display = 'none';

    // Hide Courses/Practice/etc on mobile potentially? 
    // User requested "should not be showing Edit Profile, Account Settings, Courses, Practice Plans" on mobile.
    // Simplifying logic: we just rely on hiding items.
    const coursesBtn = document.getElementById('toggleSidebarBtn');
    // if (coursesBtn) coursesBtn.style.display = 'none'; // Maybe not hide everywhere if user wants to see free courses? 
    // User said "On mobile... we should not be showing". 
    // Let's assume hiding them when logged out is cleaner for now.

    const authBtnLink = document.getElementById('authBtn');
    if (authBtnLink) {
      authBtnLink.style.display = 'block';
    }

    if (authLogout) authLogout.style.display = 'none';
    if (authLogin) authLogin.style.display = '';
    if (authRegister) authRegister.style.display = '';

    const upPass = document.getElementById('authUpdatePassword');
    if (upPass) upPass.style.display = 'none';
    const upEmail = document.getElementById('authUpdateEmail');
    if (upEmail) upEmail.style.display = 'none';
    const forgot = document.getElementById('authForgotPassword');
    if (forgot) forgot.style.display = '';

    const pr = document.getElementById('authPasswordRow');
    if (pr) pr.style.display = '';
    const cpr = document.getElementById('authCurrentPassRow');
    if (cpr) cpr.style.display = 'none';
    const pcr = document.getElementById('authPasswordConfirmRow');
    if (pcr) pcr.style.display = 'none';
    const tpb = document.getElementById('authTogglePasswordBtn');
    if (tpb) tpb.style.display = 'none';

    // Reset inputs
    if (authPass) authPass.placeholder = '••••••••';

    // Reset hint to default
    const hint = document.getElementById('authHint');
    if (hint) hint.textContent = 'Tip: Use Register once, then Sign in.';
  }
}

// ... (SKIP TO LISTENERS) ... until initScale() call
// We need to add listener for authBtn
setTimeout(() => {
  document.getElementById('authBtn')?.addEventListener('click', () => {
    accountDropdownMenu?.classList.remove('show');
    openAuthModal();
  });
}, 0);

let authInitDone = false;

export async function initAuthSession() {
  if (authInitDone) return;
  authInitDone = true;

  if (!supabase) return;

  // Subscribe ONCE
  supabase.auth.onAuthStateChange(async (event, session) => {
    // Ensure accurate global state
    currentUser = session?.user ?? null;

    updateAccountUI();
    updateAdminUI();

    // IMPORTANT: never await Supabase calls inside this callback directly to avoid blocking.
    setTimeout(async () => {
      try {
        // Dynamic imports to break circular dependencies
        const { refreshPatternSelect } = await import('./pattern-crud.js');
        const { loadCurrentProfile } = await import('./profile.js');
        const { loadAllUserHandpans } = await import('./handpanmap.js');

        await refreshPatternSelect();
        await loadCurrentProfile();
        await loadAllUserHandpans();

        window.dispatchEvent(new Event('handpan-loaded'));
      } catch (e) {
        console.warn('Post-auth refresh failed:', e);
      }
    }, 500);
  });
}

// Auto-run if imported
initAuthSession();

async function initScale() {
  let name = null;

  if (currentUser) name = await loadScaleRemote();
  if (!name) name = loadScaleLocal();
  if (!name || !SCALES[name]) name = Object.keys(SCALES)[0];

  setSelectedScaleName(name); // Use exported setter
  const scaleSelect = document.getElementById('scaleSelect');
  const scaleStatus = document.getElementById('scaleStatus');
  if (scaleSelect) scaleSelect.value = name;
  if (scaleStatus) scaleStatus.textContent = `Scale: ${name} `;

  await preloadScaleSamples();
}

initScale();

// === EVENT LISTENERS ===
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
  }
  else {
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
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
      if (modal.style.display === 'block' || modal.style.display === 'flex') {
        modal.style.display = 'none';
      }
    }
  });
}

authLogoutDropdown?.addEventListener('click', async () => {
  await supabase.auth.signOut();
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
  const { error } = await supabase.auth.updateUser({ password: newPassword });

  if (error) {
    authHint.textContent = `Error: ${error.message} `;
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
  const { data, error } = await supabase.auth.signUp({ email, password });
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
  // Use simple sign in - legacy code used 'supabase.auth.signInWithPassword'
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) { authHint.textContent = error.message; return; }
  currentUser = data.user;
  authHint.textContent = 'Signed in!';
  updateAccountUI();
  updateAdminUI();
  closeAuthModal();
  const { refreshPatternSelect } = await import('./pattern-crud.js');
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
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin, // Sends them back here
  });

  if (error) {
    authHint.textContent = `Error: ${error.message} `;
  } else {
    authHint.textContent = 'Reset link sent! Check your email.';
  }
});

// Toggle Password Update UI
document.getElementById('authTogglePasswordBtn')?.addEventListener('click', () => {
  const upPass = document.getElementById('authUpdatePassword');
  if (upPass) upPass.style.display = '';
  const pcr = document.getElementById('authPasswordConfirmRow');
  if (pcr) pcr.style.display = '';
  const pr = document.getElementById('authPasswordRow');
  if (pr) pr.style.display = '';

  document.getElementById('authTogglePasswordBtn').style.display = 'none';
  // Hide Email update UI
  const cpr = document.getElementById('authCurrentPassRow');
  if (cpr) cpr.style.display = 'none';
  const upEmail = document.getElementById('authUpdateEmail');
  if (upEmail) upEmail.style.display = 'none';
  authPass.focus();
});

// Detect Email Change
authEmail?.addEventListener('input', () => {
  if (!currentUser) return;
  const current = currentUser.email;
  const val = authEmail.value.trim();

  if (val !== current) {
    // Show Email Update UI
    const cpr = document.getElementById('authCurrentPassRow');
    if (cpr) cpr.style.display = '';
    const upEmail = document.getElementById('authUpdateEmail');
    if (upEmail) upEmail.style.display = '';

    // Hide Password Update UI
    const pr = document.getElementById('authPasswordRow');
    if (pr) pr.style.display = 'none';
    const pcr = document.getElementById('authPasswordConfirmRow');
    if (pcr) pcr.style.display = 'none';
    const upPass = document.getElementById('authUpdatePassword');
    if (upPass) upPass.style.display = 'none';
    const tpb = document.getElementById('authTogglePasswordBtn');
    if (tpb) tpb.style.display = 'none';
  } else {
    // Revert
    const cpr = document.getElementById('authCurrentPassRow');
    if (cpr) cpr.style.display = 'none';
    const upEmail = document.getElementById('authUpdateEmail');
    if (upEmail) upEmail.style.display = 'none';
    // Show password toggle again
    const tpb = document.getElementById('authTogglePasswordBtn');
    if (tpb) tpb.style.display = '';
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
  const { error: loginErr } = await supabase.auth.signInWithPassword({
    email: currentUser.email,
    password: password
  });

  if (loginErr) {
    authHint.textContent = 'Incorrect password.';
    return;
  }

  authHint.textContent = 'Updating email...';
  const { error } = await supabase.auth.updateUser(
    { email: newEmail },
    { emailRedirectTo: window.location.href }
  );

  if (error) {
    authHint.textContent = `Error: ${error.message} `;
  } else {
    authHint.textContent = 'Please check BOTH your old and new email inboxes. You must click both verification links to complete the change.';
    authCurrentPass.value = '';
  }
});

// Keep existing logout for safety if it exists elsewhere
authLogout?.addEventListener('click', async () => {
  await supabase.auth.signOut();
  window.location.reload();
});
