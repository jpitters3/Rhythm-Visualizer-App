import { supabase } from './supabase-client.js';
import { Bus, BUS_EVENT } from './bus.js';
import { currentUser, setCurrentUser, isAdminUser } from './state.js';
import { loadCurrentProfile } from './profile.js';
import { Modal } from './modal.js';
import { open as openAccountSettings } from './account-settings.js';

export async function isAuthed() {
  if (currentUser) return true; // Fast path: trust already-resolved auth state
  if (typeof supabase === 'undefined' || !supabase.auth) return false;
  try {
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
let authModal = null;
let authPanel = null;
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

// Stores the email confirmed at step 1 — not re-read from the DOM to prevent autofill corruption
let confirmedEmail = '';

// Auth modal
export function openAuthModal() {
  if (!authPanel) return;
  authPanel.open();

  if (currentUser) {
    // PRE-FILL if signed in
    if (authEmail) authEmail.value = currentUser.email;
    if (authEmail) authEmail.readOnly = false;
    if (authPass) {
      authPass.value = '';
      authPass.placeholder = 'New Password';
    }
  } else {
    // Reset to email-first step
    if (authEmail) { authEmail.value = ''; authEmail.readOnly = false; }
    if (authPass) { authPass.value = ''; authPass.placeholder = '••••••••'; }
    resetToEmailStep();
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
  authPanel?.close();
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

    // Hide ToS checkbox when logged in
    const tosRow = document.getElementById('authTosRow');
    if (tosRow) tosRow.style.display = 'none';

    // Dropdown Links
    const profileBtn = document.getElementById('openProfileBtn');
    if (profileBtn) profileBtn.style.display = 'block';

    const myScalesBtn = document.getElementById('myScalesBtn');
    if (myScalesBtn) myScalesBtn.style.display = 'block';

    const signOutBtn = document.getElementById('signOutBtn') || document.getElementById('authLogoutDropdown');
    if (signOutBtn) signOutBtn.style.display = 'block';

    const authBtnLink = document.getElementById('authBtn');
    if (authBtnLink) authBtnLink.style.display = 'none';
    const navAccountWrapper = document.getElementById('navAccountWrapper');
    if (navAccountWrapper) navAccountWrapper.style.display = '';

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
    if (authBtnLink) authBtnLink.style.display = 'block';
    const navAccountWrapper = document.getElementById('navAccountWrapper');
    if (navAccountWrapper) navAccountWrapper.style.display = 'none';

    if (authLogout) authLogout.style.display = 'none';
    // Reset auth modal to email step — the step helpers control form rows
    if (authLogin) authLogin.style.display = 'none';
    if (authRegister) authRegister.style.display = 'none';

    const upPass = document.getElementById('authUpdatePassword');
    if (upPass) upPass.style.display = 'none';
    const upEmail = document.getElementById('authUpdateEmail');
    if (upEmail) upEmail.style.display = 'none';

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

  // 1. Fast path: read session from localStorage (no network round-trip).
  //    If the JWT is expired, getSession() uses the refresh token automatically.
  const { data: sessionData } = await supabase.auth.getSession();
  setCurrentUser(sessionData?.session?.user ?? null);
  await loadCurrentProfile();
  updateAccountUI();
  updateAdminUI();

  if (currentUser) {
    Bus.emit(BUS_EVENT.AUTH_LOGIN, { user: currentUser });
  }

  // 2. Background: validate token server-side without blocking init.
  //    onAuthStateChange will fire and correct state if the token is revoked.
  supabase.auth.getUser().then(({ data }) => {
    if (!data?.user && currentUser) {
      setCurrentUser(null);
      updateAccountUI();
      updateAdminUI();
      logout();
    }
  });

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
  authPanel = new Modal(authModal);
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
  const authContinueBtn = document.getElementById('authContinueBtn');
  const authBackBtn = document.getElementById('authBackBtn');

  Bus.on(BUS_EVENT.OPEN_AUTH_MODAL, openAuthModal);

  // Account button behaviour
  accountBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (currentUser) {
      accountDropdownMenu?.classList.toggle('show');
    } else {
      openAuthModal();
    }
  });

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
    if (currentUser) {
      openAccountSettings();
    } else {
      openAuthModal();
    }
  });

  authCancel?.addEventListener('click', closeAuthModal);
  closeAuthBtn?.addEventListener('click', closeAuthModal);

  window.addEventListener('click', (e) => {
    if (accountBtn && accountDropdownMenu && !accountBtn.contains(e.target) && !accountDropdownMenu.contains(e.target)) {
      accountDropdownMenu.classList.remove('show');
    }
  });

  authLogoutDropdown?.addEventListener('click', async () => { logout(); });

  // ── STEP 1: Continue (email check) ──────────────────────────────────────
  authContinueBtn?.addEventListener('click', async () => {
    const email = authEmail.value.trim();
    if (!email || !email.includes('@')) {
      authHint.textContent = 'Please enter a valid email address.';
      authEmail.focus();
      return;
    }

    authHint.textContent = 'Checking…';
    authContinueBtn.disabled = true;

    try {
      const { data, error } = await supabase.functions.invoke('check-email-exists', {
        body: { email }
      });

      if (error) throw error;

      if (data?.exists) {
        confirmedEmail = email;
        showLoginStep(email);
      } else {
        confirmedEmail = email;
        showSignupStep(email);
      }
    } catch (err) {
      console.warn('Email check failed:', err);
      authHint.textContent = 'Unable to verify email. Please try again or check your connection.';
      authHint.style.color = 'var(--error, #ff4444)';
    } finally {
      authContinueBtn.disabled = false;
      authContinueBtn.textContent = 'Continue';
    }
  });

  // Allow pressing Enter on email to continue
  authEmail?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !currentUser) authContinueBtn?.click();
  });

  // ── Back button ──────────────────────────────────────────────────────────
  authBackBtn?.addEventListener('click', () => {
    resetToEmailStep();
  });

  // ── STEP 2a: Login ───────────────────────────────────────────────────────
  authLogin?.addEventListener('click', async () => {
    const email = confirmedEmail || authEmail.value.trim();
    const password = authPass.value;
    authHint.textContent = 'Signing in…';
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

  // Allow Enter on password to log in
  authPass?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') authLogin?.click();
  });

  // ── STEP 2b: Register ────────────────────────────────────────────────────
  authRegister?.addEventListener('click', async () => {
    const tosCheckbox = document.getElementById('authTosCheckbox');
    if (!tosCheckbox?.checked) {
      authHint.textContent = 'Please agree to the Terms of Service and Privacy Policy to create an account.';
      tosCheckbox?.focus();
      return;
    }
    const firstName = document.getElementById('authFirstName')?.value.trim();
    if (!firstName) {
      authHint.textContent = 'Please enter your first name.';
      document.getElementById('authFirstName')?.focus();
      return;
    }
    const lastName = document.getElementById('authLastName')?.value.trim() || null;
    const email = confirmedEmail || authEmail.value.trim();
    const password = authPass.value;
    const confirm = authPassConfirm?.value;
    if (password !== confirm) {
      authHint.textContent = 'Passwords do not match.';
      authPassConfirm?.focus();
      return;
    }
    authHint.textContent = 'Creating account…';
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) { authHint.textContent = error.message; return; }

    // Save name to profile (upsert in case trigger already created the row)
    if (data?.user) {
      await supabase.from('profiles').upsert({
        user_id: data.user.id,
        first_name: firstName,
        last_name: lastName,
      }, { onConflict: 'user_id' });
    }

    authHint.textContent = 'Account created! Please check your email to confirm, then log in.';
    authPass.value = '';
    if (authPassConfirm) authPassConfirm.value = '';
    document.getElementById('authFirstName').value = '';
    if (document.getElementById('authLastName')) document.getElementById('authLastName').value = '';
  });

  // ── Forgot password ──────────────────────────────────────────────────────
  authForgotPassword?.addEventListener('click', async () => {
    const email = confirmedEmail || authEmail.value.trim();
    if (!email) {
      authHint.textContent = 'Please enter your email above first.';
      authEmail.focus();
      return;
    }
    authHint.textContent = 'Sending reset code…';
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) {
      authHint.textContent = `Error: ${error.message}`;
    } else {
      authHint.textContent = 'Reset code sent! Check your email and enter it below.';
      authForgotPassword.style.display = 'none';
      authLogin.style.display = 'none';
      authRegister.style.display = 'none';
      document.getElementById('authPasswordRow').style.display = 'none';
      authOtpRow.style.display = '';
      authVerifyOtp.style.display = '';
      authOtp.focus();
    }
  });

  // ── Verify OTP ───────────────────────────────────────────────────────────
  authVerifyOtp?.addEventListener('click', async () => {
    const email = confirmedEmail || authEmail.value.trim();
    const token = authOtp.value.trim();
    if (!token || token.length < 6 || token.length > 8) {
      authHint.textContent = 'Please enter the verification code correctly.';
      authOtp.focus();
      return;
    }
    authHint.textContent = 'Verifying code…';
    const { error } = await supabase.auth.verifyOtp({ email, token, type: 'recovery' });
    if (error) {
      authHint.textContent = `Error: ${error.message}`;
    } else {
      authHint.textContent = 'Code verified! Please enter your new password.';
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

  // ── Change password (logged-in) ──────────────────────────────────────────
  authTogglePasswordBtn?.addEventListener('click', () => {
    document.getElementById('authUpdatePassword').style.display = '';
    document.getElementById('authPasswordConfirmRow').style.display = '';
    document.getElementById('authPasswordRow').style.display = '';
    authTogglePasswordBtn.style.display = 'none';
    document.getElementById('authCurrentPassRow').style.display = 'none';
    document.getElementById('authUpdateEmail').style.display = 'none';
    authPass.focus();
  });

  authUpdatePasswordBtn?.addEventListener('click', async () => {
    const newPassword = authPass.value;
    const confirm = authPassConfirm.value;
    if (!newPassword) { authHint.textContent = 'Please enter a new password.'; authPass.focus(); return; }
    if (newPassword !== confirm) { authHint.textContent = 'Passwords do not match.'; authPassConfirm.focus(); return; }
    authHint.textContent = 'Updating password…';
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      authHint.textContent = `Error: ${error.message}`;
    } else {
      authHint.textContent = 'Password updated successfully!';
      authPass.value = '';
      authPassConfirm.value = '';
      setTimeout(() => closeAuthModal(), 1500);
    }
  });

  // ── Email change (logged-in) ─────────────────────────────────────────────
  authEmail?.addEventListener('input', () => {
    if (!currentUser) return;
    const val = authEmail.value.trim();
    if (val !== currentUser.email) {
      document.getElementById('authCurrentPassRow').style.display = '';
      document.getElementById('authUpdateEmail').style.display = '';
      document.getElementById('authPasswordRow').style.display = 'none';
      document.getElementById('authPasswordConfirmRow').style.display = 'none';
      document.getElementById('authUpdatePassword').style.display = 'none';
      document.getElementById('authTogglePasswordBtn').style.display = 'none';
    } else {
      document.getElementById('authCurrentPassRow').style.display = 'none';
      document.getElementById('authUpdateEmail').style.display = 'none';
      document.getElementById('authTogglePasswordBtn').style.display = '';
    }
  });

  authUpdateEmailBtn?.addEventListener('click', async () => {
    const newEmail = authEmail.value.trim();
    const password = authCurrentPass.value;
    if (!password) { authHint.textContent = 'Please enter your current password.'; authCurrentPass.focus(); return; }
    authHint.textContent = 'Verifying…';
    const { error: loginErr } = await supabase.auth.signInWithPassword({ email: currentUser.email, password });
    if (loginErr) { authHint.textContent = 'Incorrect password.'; return; }
    authHint.textContent = 'Updating email…';
    const { error } = await supabase.auth.updateUser({ email: newEmail }, { emailRedirectTo: window.location.href });
    if (error) {
      authHint.textContent = `Error: ${error.message}`;
    } else {
      authHint.textContent = 'Please check BOTH your old and new email inboxes to complete the change.';
      authCurrentPass.value = '';
    }
  });

  authLogout?.addEventListener('click', async () => { logout(); });

  await initAuthSession();
}

// ── Email-first step helpers ─────────────────────────────────────────────────

function resetToEmailStep() {
  confirmedEmail = '';
  const authContinueBtn = document.getElementById('authContinueBtn');
  const authBackBtn = document.getElementById('authBackBtn');
  const authForgotPassword = document.getElementById('authForgotPassword');
  const authModalTitle = document.getElementById('authModalTitle');
  const authModalSubtitle = document.getElementById('authModalSubtitle');

  authModalTitle && (authModalTitle.textContent = 'Log in or sign up');
  authModalSubtitle && (authModalSubtitle.textContent = 'Save your grooves to the cloud.');
  authHint.textContent = '';

  // Show email row, hide rest
  const emailEl = document.getElementById('authEmail');
  if (emailEl) { emailEl.readOnly = false; emailEl.style.opacity = ''; }
  document.getElementById('authEmailRow').style.display = '';
  document.getElementById('authPasswordRow').style.display = 'none';
  document.getElementById('authPasswordConfirmRow').style.display = 'none';
  document.getElementById('authFirstNameRow').style.display = 'none';
  document.getElementById('authLastNameRow').style.display = 'none';
  document.getElementById('authTosRow').style.display = 'none';
  if (authForgotPassword) authForgotPassword.style.display = 'none';
  if (authBackBtn) authBackBtn.style.display = 'none';

  // Buttons
  if (authContinueBtn) { authContinueBtn.style.display = ''; authContinueBtn.classList.add('active'); }
  if (authLogin) authLogin.style.display = 'none';
  if (authRegister) authRegister.style.display = 'none';

  authEmail?.focus();
}

function showLoginStep(email) {
  const authContinueBtn = document.getElementById('authContinueBtn');
  const authBackBtn = document.getElementById('authBackBtn');
  const authForgotPassword = document.getElementById('authForgotPassword');
  const authModalTitle = document.getElementById('authModalTitle');
  const authModalSubtitle = document.getElementById('authModalSubtitle');

  authModalTitle && (authModalTitle.textContent = 'Welcome back!');
  authModalSubtitle && (authModalSubtitle.textContent = email);
  authHint.textContent = '';

  // Lock email field
  if (authEmail) authEmail.readOnly = true;

  document.getElementById('authEmailRow').style.display = 'none';
  document.getElementById('authPasswordRow').style.display = '';
  document.getElementById('authPasswordConfirmRow').style.display = 'none';
  document.getElementById('authTosRow').style.display = 'none';
  if (authForgotPassword) authForgotPassword.style.display = '';
  if (authBackBtn) authBackBtn.style.display = '';

  // Buttons
  if (authContinueBtn) authContinueBtn.style.display = 'none';
  if (authLogin) { authLogin.style.display = ''; authLogin.classList.add('active'); }
  if (authRegister) authRegister.style.display = 'none';

  authPass?.focus();
}

function showSignupStep(email) {
  const authContinueBtn = document.getElementById('authContinueBtn');
  const authBackBtn = document.getElementById('authBackBtn');
  const authForgotPassword = document.getElementById('authForgotPassword');
  const authModalTitle = document.getElementById('authModalTitle');
  const authModalSubtitle = document.getElementById('authModalSubtitle');
  const tosRow = document.getElementById('authTosRow');
  const tosCheckbox = document.getElementById('authTosCheckbox');

  authModalTitle && (authModalTitle.textContent = 'Create an account');
  authModalSubtitle && (authModalSubtitle.textContent = email);
  authHint.textContent = '';

  // Lock email field
  if (authEmail) authEmail.readOnly = true;

  document.getElementById('authEmailRow').style.display = 'none';
  document.getElementById('authPasswordRow').style.display = '';
  document.getElementById('authPasswordConfirmRow').style.display = '';
  document.getElementById('authFirstNameRow').style.display = '';
  document.getElementById('authLastNameRow').style.display = '';
  if (tosRow) { tosRow.style.display = 'flex'; }
  if (tosCheckbox) tosCheckbox.checked = false;
  if (authForgotPassword) authForgotPassword.style.display = 'none';
  if (authBackBtn) authBackBtn.style.display = '';

  // Buttons
  if (authContinueBtn) authContinueBtn.style.display = 'none';
  if (authLogin) authLogin.style.display = 'none';
  if (authRegister) { authRegister.style.display = ''; authRegister.classList.add('active'); }

  authPass?.focus();
}

