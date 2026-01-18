// ===== INIT =====
function updateMetroUI() {
  if (!metroBtn) return;
  metroBtn.classList.toggle('active', metronomeOn);
}

function restorePrefs() {
  if (localStorage.getItem('theme') === 'dark') {
    document.body.classList.add('dark');
  }

  const handOn = localStorage.getItem('handSplit') === 'on';
  document.body.classList.toggle('handSplit', handOn);
  handBtn.classList.toggle('active', handOn);
  handBtn.textContent = handOn ? 'Left/Right: On' : 'Left/Right: Off';

  metronomeOn = (localStorage.getItem(METRO_KEY) === 'on');
  updateMetroUI();

  bpmVal.textContent = bpmInput.value;

  if (localStorage.getItem(PRESENT_KEY) === 'on') {
    document.body.classList.add('present');
    presentBtn.classList.add('active');
    presentBtn.textContent = 'Exit Presentation';
    exitPresent.style.display = 'inline-flex';
  } else {
    exitPresent.style.display = 'none';
  }
}

function runSelfTests() {
  // Existing smoke tests (kept)
  console.assert(document.getElementById('grid') && document.getElementById('labels'), 'Grid/labels elements exist');
  console.assert(cells().length === STEPS, `Expected ${STEPS} cells after renderAllMeasures()`);
  console.assert(labels.children.length === STEPS, `Expected ${STEPS} labels after renderAllMeasures()`);

  // Added: each cell should have a hand side class
  cells().forEach((c) => {
    console.assert(c.classList.contains('hand-l') || c.classList.contains('hand-r'), 'Cell has hand-l/hand-r');
  });

  console.assert(!!metroBtn, 'Metronome button exists');
  console.assert(typeof metroClick === 'function', 'metroClick is a function');

  console.assert(!!presentBtn && !!exitPresent, 'Presentation buttons exist');

  // Added: Hand icons should be defined as mask-images in split mode CSS
  console.assert(getComputedStyle(document.documentElement).getPropertyValue('--hand-icon') !== '', 'Hand icon color var exists');

  // Added: Mode toggle should rebuild correct counts
  const before = STEPS;
  setMode(mode === '8' ? '16' : '8');
  console.assert(STEPS !== before, 'Mode toggle changes step count');
  console.assert(cells().length === STEPS, 'Grid rebuilt to new step count');
  console.assert(labels.children.length === STEPS, 'Labels rebuilt to new step count');
  // revert
  setMode(mode === '8' ? '16' : '8');
  console.assert(cells().length === STEPS, 'Grid rebuilt back');
}

function showFatalError(err) {
  // Ensure we stop any running timers if an error happens during startup
  try { if (typeof stop === 'function') stop(); } catch { }

  console.error(err);

  const modal = document.getElementById('errorModal');
  const stackPre = document.getElementById('errorStack');
  const continueBtn = document.getElementById('errorContinueBtn');

  if (!modal || !stackPre) {
    // Fallback if DOM not ready or modal deleted
    alert("App Failed: " + err);
    return;
  }

  // Initial Render (Optimistic / Pessimistic)
  const renderStack = (isAdm) => {
    console.log('Rendering Error. Admin:', isAdm, 'Error:', err);
    if (isAdm) {
      // If stack is missing, dump the whole object header or string
      const stackText = err?.stack || String(err);
      stackPre.textContent = stackText;
      document.querySelector('.error-details').open = true;
    } else {
      stackPre.textContent = String(err?.message || err);
      document.querySelector('.error-details').open = false;
    }
  };

  // Check Sync
  let isAdmin = false;
  const admins = (typeof ADMIN_EMAILS !== 'undefined' ? ADMIN_EMAILS : window.ADMIN_EMAILS);

  try {
    const email = currentUser?.email?.toLowerCase();
    if (email && admins && admins.has(email)) {
      isAdmin = true;
    }
  } catch (e) { }

  renderStack(isAdmin);

  modal.classList.add('show');
  modal.style.display = 'flex';

  // Check Async (if not already admin, maybe auth is still loading)
  if (!isAdmin && typeof supabase1 !== 'undefined') {
    supabase1.auth.getUser().then(({ data }) => {
      const email = data?.user?.email?.toLowerCase();
      if (email && admins && admins.has(email)) {
        console.log('Async Admin Check Passed');
        renderStack(true);
      }
    }).catch(() => { });
  }

  continueBtn.onclick = () => {
    modal.classList.remove('show');
    modal.style.display = 'none';
  };
}

// Global error handlers (helps when a bad edit slips in)
window.addEventListener('error', (e) => {
  // Avoid duplicate panels
  if (document.getElementById('__fatal_panel__')) return;
  showFatalError(e.error || e.message || e);
});

window.addEventListener('unhandledrejection', (e) => {
  if (document.getElementById('__fatal_panel__')) return;
  showFatalError(e.reason || e);
});

// ===== INIT (non-blocking) =====
// Why: if there’s a runtime error or accidental heavy work, Chrome can show “Page Unresponsive” on reload.
// Strategy: render once, then initialize on the next frame, and run self-tests only in debug mode.

const DEBUG = new URLSearchParams(location.search).has('debug');

function safeInit() {
  try {
    restorePrefs();
    renderAllMeasures();

    (async () => {
      await loadSharedFromURL();
      await refreshPatternSelect();
    })();

    updatePatternButtons();
    updateComposeUI();

    if (DEBUG) runSelfTests();

    // Initial Snapshot
    if (typeof serializePattern === 'function') {
      window.lastSavedState = JSON.stringify(serializePattern());
    }
  } catch (err) {
    showFatalError(err);
  }
}

// Let the browser paint UI first, then init.
requestAnimationFrame(() => {
  setTimeout(() => {
    // fire-and-forget but safeInit itself is async
    safeInit();
  }, 0);
});