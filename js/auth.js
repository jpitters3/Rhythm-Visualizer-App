// Admin functionality
function isAdminUser(user) {
  const email = user?.email?.toLowerCase?.() || "";
  return ADMIN_EMAILS.has(email);
}

function updateAdminUI() {
  const show = isAdminUser(currentUser);
  const btn = document.getElementById("calBtn");
  if (btn) btn.style.display = show ? "" : "none";

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

function updateAccountUI() {
  if (!accountStatus) return;
  if (currentUser) {
    accountStatus.textContent = `Signed in: ${currentUser.email}`;
    authLogout.style.display = '';
    authLogin.style.display = 'none';
    authRegister.style.display = 'none';
  } else {
    accountStatus.textContent = 'Not signed in';
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

async function initScale(){
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
accountBtn?.addEventListener('click', openAuthModal);
authCancel?.addEventListener('click', closeAuthModal);

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

authLogout?.addEventListener('click', async () => {
  await supabase1.auth.signOut();
  currentUser = null;
  updateAccountUI();
  updateAdminUI();
  initScale();
  authHint.textContent = 'Signed out.';
});