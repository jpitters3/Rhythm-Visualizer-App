// Admin functionality
function isAdminUser(user) {
  const email = user?.email?.toLowerCase?.() || "";
  return ADMIN_EMAILS.has(email);
}

function updateAdminUI() {
  const show = isAdminUser(currentUser);

  const calBbtn = document.getElementById("calBtn");
  if (calBtn) calBtn.style.display = show ? "" : "none";

  const courseBtn = document.getElementById("openCourseModalBtn");
  if (courseBtn) courseBtn.style.display = show ? "" : "none";

  // if they were calibrating and lost admin (logout), force it off
  if (!show && document.body.classList.contains("calibrating")) {
    document.body.classList.remove("calibrating");
  }
}

// Auth modal
function openAuthModal() {
  authModal.classList.add('open');
  authModal.setAttribute('aria-hidden', 'false');
  setTimeout(() => authEmail?.focus(), 0);
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
    // accountStatus.textContent = `${currentUser.email}`;
    // Set button text to first letter of email
    if (accountBtn) accountBtn.textContent = currentUser.email.charAt(0).toUpperCase();

    // Hide old auth buttons in modal if you want, but mainly we rely on dropdown now for logout
    authLogout.style.display = '';
    authLogin.style.display = 'none';
    authRegister.style.display = 'none';
  } else {
    accountStatus.textContent = 'Not signed in';
    // Reset button text
    if (accountBtn) accountBtn.textContent = 'Account';

    // Close dropdown if open
    if (accountDropdownMenu) accountDropdownMenu.classList.remove('show');

    authLogout.style.display = 'none';
    authLogin.style.display = '';
    authRegister.style.display = '';
  }
}

let authInitDone = false;

async function initAuthSession() {
  if (authInitDone) return;
  authInitDone = true;

  // Subscribe ONCE
  supabase1.auth.onAuthStateChange(async (_event, session) => {
    currentUser = session?.user ?? null;
    updateAccountUI();
    updateAdminUI();

    // IMPORTANT: never await Supabase calls inside this callback
    queueMicrotask(async () => {
      try {
        // safe to do async work here
        await refreshPatternSelect?.();
      } catch (e) {
        console.warn('Post-auth refresh failed:', e);
      }
    });
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

authCancel?.addEventListener('click', closeAuthModal);

// Close dropdown when clicking outside
window.addEventListener('click', (e) => {
  if (accountBtn && accountDropdownMenu && !accountBtn.contains(e.target) && !accountDropdownMenu.contains(e.target)) {
    accountDropdownMenu.classList.remove('show');
  }
});

authLogoutDropdown?.addEventListener('click', async () => {
  await supabase1.auth.signOut();
  currentUser = null;
  updateAccountUI();
  updateAdminUI();
  initScale();
  authHint.textContent = 'Signed out.';
  accountDropdownMenu?.classList.remove('show');
});


// Modal Action Buttons (Actual Submit)
authRegister?.addEventListener('click', async () => {
  const email = authEmail.value.trim();
  const password = authPass.value;
  authHint.textContent = 'Registering...';
  const { data, error } = await supabase1.auth.signUp({ email, password });
  if (error) { authHint.textContent = error.message; return; }
  authHint.textContent = data?.user
    ? 'Registered! Now click Sign in.'
    : 'Registered! Check your email for confirmation (if enabled), then Sign in.';
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

// Keep existing logout for safety if it exists elsewhere
authLogout?.addEventListener('click', async () => {
  await supabase1.auth.signOut();
  currentUser = null;
  updateAccountUI();
  updateAdminUI();
  initScale();
  authHint.textContent = 'Signed out.';
});