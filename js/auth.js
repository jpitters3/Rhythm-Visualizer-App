import { ADMIN_EMAILS, SCALE_KEY_LOCAL, SCALES } from './config.js';
import { preloadScaleSamples } from './noteplayer.js';
import { supabase } from './supabase-client.js';
import { Bus, BUS_EVENT } from './bus.js';
import { currentUser, setCurrentUser, setSelectedScaleName, isAdminUser } from './state.js';
import { loadScaleRemote, loadScaleLocal } from './handpanmap.js';

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
// Elements (Globals previously, now local resolution if possible, or assume global ID access)
let authModal = null;
let authEmail = null;
let authPass = null;
let authHint = null;
let accountStatus = null;
let accountBtn = null;
let authLogin = null;
let authRegister = null;
let authLogout = null;
let authOtp = null;
let authOtpRow = null;

let accountDropdownMenu = null;
let authLogoutDropdown = null;
let authVerifyOtp = null;

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
      setCurrentUser(data.user);

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
// Dropdown

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

    if (authOtpRow) authOtpRow.style.display = 'none';
    if (authVerifyOtp) authVerifyOtp.style.display = 'none';

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

    if (authOtpRow) authOtpRow.style.display = 'none';
    if (authVerifyOtp) authVerifyOtp.style.display = 'none';

    // Reset inputs
    if (authPass) authPass.placeholder = '••••••••';

    // Reset hint to default
    const hint = document.getElementById('authHint');
    if (hint) hint.textContent = 'Tip: Use Register once, then Sign in.';
  }
}

async function logout() {
  await supabase.auth.signOut();
  Bus.emit(BUS_EVENT.AUTH_LOGOUT);
  window.location.reload();
}

let authInitDone = false;

export async function initAuthSession() {
  if (authInitDone) return;
  authInitDone = true;

  if (!supabase) return;

  // 1. Initial Synchronous Check (to block init)
  const { data } = await supabase.auth.getUser();
  setCurrentUser(data?.user ?? null);
  updateAccountUI();
  updateAdminUI();

  if (currentUser) {
    Bus.emit(BUS_EVENT.AUTH_LOGIN, { user: currentUser });
  }

  // 2. Subscribe for future changes
  supabase.auth.onAuthStateChange(async (event, session) => {
    // Ensure accurate global state
    const prevUser = currentUser;
    setCurrentUser(session?.user ?? null);

    updateAccountUI();
    updateAdminUI();

    if (currentUser && !prevUser) {
      Bus.emit(BUS_EVENT.AUTH_LOGIN, { user: currentUser });
    } else if (!currentUser && prevUser) {
      logout();
    }

    // IMPORTANT: never await Supabase calls inside this callback directly to avoid blocking.
    setTimeout(async () => {
      try {
        // Emit events instead of dynamic imports
        Bus.emit(BUS_EVENT.PATTERN_REFRESH_NEEDED);
        Bus.emit(BUS_EVENT.PROFILE_LOAD_NEEDED);
      } catch (e) {
        console.warn('Post-auth refresh failed:', e);
      }
    }, 500);
  });
}

export async function initAuth() {
  // Elements
  authModal = document.getElementById('authModal');
  authEmail = document.getElementById('authEmail');
  authPass = document.getElementById('authPass');
  authHint = document.getElementById('authHint');
  accountStatus = document.getElementById('accountStatus');
  accountBtn = document.getElementById('accountBtn');
  authLogin = document.getElementById('authLogin');
  authRegister = document.getElementById('authRegister');
  authLogout = document.getElementById('authLogout');
  authOtp = document.getElementById('authOtp');

  accountDropdownMenu = document.getElementById('accountDropdownMenu');
  authLogoutDropdown = document.getElementById('authLogoutDropdown');

  const authCancel = document.getElementById('authCancel');
  const closeAuthBtn = document.getElementById('closeAuthBtn');
  const authUpdatePasswordBtn = document.getElementById('authUpdatePassword');
  const authPassConfirm = document.getElementById('authPassConfirm');
  const openAccountAuthBtn = document.getElementById('openAccountAuthBtn');
  const authForgotPassword = document.getElementById('authForgotPassword');
  const authTogglePasswordBtn = document.getElementById('authTogglePasswordBtn');
  const authUpdateEmailBtn = document.getElementById('authUpdateEmail');
  const authCurrentPass = document.getElementById('authCurrentPass');
  authOtpRow = document.getElementById('authOtpRow');
  authVerifyOtp = document.getElementById('authVerifyOtp');

  // New Logic: Click Account -> If Signed In (Toggle Dropdown) ELSE (Open Modal)
  accountBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (currentUser) {
      accountDropdownMenu?.classList.toggle('show');
    } else {
      openAuthModal();
    }
  });

  // Auto-close Account Dropdown on Item Click
  document.getElementById('authBtn')?.addEventListener('click', () => {
    accountDropdownMenu?.classList.remove('show');
    openAuthModal();
  });

  accountDropdownMenu?.addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
      accountDropdownMenu.classList.remove('show');
    }
  });

  openAccountAuthBtn?.addEventListener('click', () => {
    accountDropdownMenu?.classList.remove('show');
    openAuthModal();
  });

  authCancel?.addEventListener('click', closeAuthModal);
  closeAuthBtn?.addEventListener('click', closeAuthModal);

  window.addEventListener('click', (e) => {
    if (accountBtn && accountDropdownMenu && !accountBtn.contains(e.target) && !accountDropdownMenu.contains(e.target)) {
      accountDropdownMenu.classList.remove('show');
    }
  });

  authModal?.addEventListener('click', (e) => {
    if (e.target === authModal) {
      closeAuthModal();
    }
  });

  authLogoutDropdown?.addEventListener('click', async () => {
    logout();
  });

  authUpdatePasswordBtn?.addEventListener('click', async () => {
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
    if (authPassConfirm) authPassConfirm.value = '';
  });

  authLogin?.addEventListener('click', async () => {
    const email = authEmail.value.trim();
    const password = authPass.value;
    authHint.textContent = 'Signing in...';
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { authHint.textContent = error.message; return; }
    setCurrentUser(data.user);
    authHint.textContent = 'Signed in!';
    updateAccountUI();
    updateAdminUI();
    closeAuthModal();

    Bus.emit(BUS_EVENT.AUTH_LOGIN, { user: currentUser });
    Bus.emit(BUS_EVENT.PATTERN_REFRESH_NEEDED);
  });

  authForgotPassword?.addEventListener('click', async () => {
    const email = authEmail.value.trim();
    if (!email) {
      authHint.textContent = 'Please enter your email above first.';
      authEmail.focus();
      return;
    }

    authHint.textContent = 'Sending reset code...';
    // By omitting redirectTo, Supabase should send a 6-digit OTP instead (if configured inside their email template)
    const { error } = await supabase.auth.resetPasswordForEmail(email);

    if (error) {
      authHint.textContent = `Error: ${error.message} `;
    } else {
      authHint.textContent = 'Reset code sent! Check your email and enter it below.';

      // Update UI to OTP mode
      authForgotPassword.style.display = 'none';
      authLogin.style.display = 'none';
      authRegister.style.display = 'none';
      document.getElementById('authPasswordRow').style.display = 'none';

      authOtpRow.style.display = '';
      authVerifyOtp.style.display = '';
      authOtp.focus();
    }
  });

  authVerifyOtp?.addEventListener('click', async () => {
    const email = authEmail.value.trim();
    const token = authOtp.value.trim();

    if (!token || token.length < 6 || token.length > 8) {
      authHint.textContent = 'Please enter the verification code correctly.';
      authOtp.focus();
      return;
    }

    authHint.textContent = 'Verifying code...';
    const { error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'recovery'
    });

    if (error) {
      authHint.textContent = `Error: ${error.message}`;
    } else {
      authHint.textContent = 'Code verified! Please enter your new password.';

      // Switch UI to password update mode
      authOtpRow.style.display = 'none';
      authVerifyOtp.style.display = 'none';

      document.getElementById('authPasswordRow').style.display = '';
      document.getElementById('authPasswordConfirmRow').style.display = '';
      document.getElementById('authUpdatePassword').style.display = '';
      authPass.value = '';
      authPassConfirm.value = '';
      authPass.focus();
    }
  });

  authTogglePasswordBtn?.addEventListener('click', () => {
    const upPass = document.getElementById('authUpdatePassword');
    if (upPass) upPass.style.display = '';
    const pcr = document.getElementById('authPasswordConfirmRow');
    if (pcr) pcr.style.display = '';
    const pr = document.getElementById('authPasswordRow');
    if (pr) pr.style.display = '';

    authTogglePasswordBtn.style.display = 'none';
    const cpr = document.getElementById('authCurrentPassRow');
    if (cpr) cpr.style.display = 'none';
    const upEmail = document.getElementById('authUpdateEmail');
    if (upEmail) upEmail.style.display = 'none';
    authPass.focus();
  });

  authEmail?.addEventListener('input', () => {
    if (!currentUser) return;
    const current = currentUser.email;
    const val = authEmail.value.trim();

    if (val !== current) {
      const cpr = document.getElementById('authCurrentPassRow');
      if (cpr) cpr.style.display = '';
      const upEmail = document.getElementById('authUpdateEmail');
      if (upEmail) upEmail.style.display = '';
      const pr = document.getElementById('authPasswordRow');
      if (pr) pr.style.display = 'none';
      const pcr = document.getElementById('authPasswordConfirmRow');
      if (pcr) pcr.style.display = 'none';
      const upPass = document.getElementById('authUpdatePassword');
      if (upPass) upPass.style.display = 'none';
      const tpb = document.getElementById('authTogglePasswordBtn');
      if (tpb) tpb.style.display = 'none';
    } else {
      const cpr = document.getElementById('authCurrentPassRow');
      if (cpr) cpr.style.display = 'none';
      const upEmail = document.getElementById('authUpdateEmail');
      if (upEmail) upEmail.style.display = 'none';
      const tpb = document.getElementById('authTogglePasswordBtn');
      if (tpb) tpb.style.display = '';
    }
  });

  authUpdateEmailBtn?.addEventListener('click', async () => {
    const newEmail = authEmail.value.trim();
    const password = authCurrentPass.value;

    if (!password) {
      authHint.textContent = 'Please enter your current password.';
      authCurrentPass.focus();
      return;
    }

    authHint.textContent = 'Verifying...';
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

  authLogout?.addEventListener('click', async () => {
    logout();
  });

  // Initialization calls
  await initAuthSession();

}
