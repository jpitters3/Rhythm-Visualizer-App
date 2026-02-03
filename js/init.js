// ===== INIT =====
import { gridA, activeGrid } from './grid-context.js';
import { activeSubIndex, cells, renderAllMeasures } from './notegrid.js';
import { ADMIN_EMAILS } from './config.js';
import { TransportRegistry } from './transport-ui.js';
import { stop, setMode } from './noteplayer.js';
import { loadSharedFromURL } from './share-patterns.js';
import { refreshPatternSelect, serializePattern, updatePatternButtons } from './pattern-crud.js';
import { loadPatternByName } from './controls.js';
import { updateComposeUI } from './compose-mode.js';
import { setPresentation } from './presentation-mode.js';
import { currentUser } from './auth.js';
import { STEPS } from './rhythm-core.js';
import { supabase } from './supabase-client.js';

function updateMetroUI() {
  const ctx = window.activeGrid || window.gridA;
  if (TransportRegistry) TransportRegistry.updateAll(ctx);
}
// window.updateMetroUI = updateMetroUI;

export function restorePrefs() {
  if (localStorage.getItem('theme') === 'dark') {
    document.body.classList.add('dark');
  }

  const handOn = localStorage.getItem('handSplit') === 'on';
  document.body.classList.toggle('handSplit', handOn);
  handBtn.classList.toggle('active', handOn);
  handBtn.textContent = handOn ? 'Left/Right: On' : 'Left/Right: Off';

  /* metronomeOn was implicit. We use local var to read check */
  let isMetroOn = (localStorage.getItem('groovepan_metro-A') === 'on');
  if (localStorage.getItem('groovepan_metro-A') === null) {
    isMetroOn = (localStorage.getItem('groovepan_metro') === 'on');
  }
  if (window.gridA) window.gridA.metronomeOn = isMetroOn;

  updateMetroUI();
}

function runSelfTests() {
  // Existing smoke tests (kept)
  console.assert(document.getElementById('grid') && document.getElementById('labels'), 'Grid/labels elements exist');
  console.assert(cells().length === window.STEPS, `Expected ${window.STEPS} cells after renderAllMeasures()`);
  const labelsEl = document.getElementById('labels');
  console.assert(labelsEl && labelsEl.children.length === window.STEPS, `Expected ${window.STEPS} labels after renderAllMeasures()`);

  // Added: each cell should have a hand side class
  cells().forEach((c) => {
    console.assert(c.classList.contains('hand-l') || c.classList.contains('hand-r'), 'Cell has hand-l/hand-r');
  });

  console.assert(document.querySelector('.transport-container'), 'Transport container exists');
  // console.assert(typeof metroClick === 'function', 'metroClick is a function'); // Removed: private internal

  console.assert(!!presentBtn && !!exitPresent, 'Presentation buttons exist');

  // Added: Hand icons should be defined as mask-images in split mode CSS
  console.assert(getComputedStyle(document.documentElement).getPropertyValue('--hand-icon') !== '', 'Hand icon color var exists');

  // Added: Mode toggle should rebuild correct counts
  const before = window.STEPS || STEPS; // fallback if module scoping issue
  const currentMode = (activeGrid || gridA).mode;
  setMode(currentMode === '8' ? '16' : '8');
  console.assert((window.STEPS || STEPS) !== before, 'Mode toggle changes step count');
  console.assert(cells().length === window.STEPS, 'Grid rebuilt to new step count');
  console.assert(document.getElementById('labels').children.length === window.STEPS, 'Labels rebuilt to new step count');
  // revert
  setMode(currentMode);
  console.assert(cells().length === window.STEPS, 'Grid rebuilt back');
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
  const admins = ADMIN_EMAILS;

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
  if (!isAdmin && typeof supabase !== 'undefined') {
    supabase.auth.getUser().then(({ data }) => {
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
  // Suppress "EncodingError" (audio decoding in headless env) and "Failed to fetch" (missing assets)
  const msg = String(e.error || e.message || e);
  if (msg.includes('EncodingError') || msg.includes('Failed to fetch')) {
    console.warn('Suppressed Error:', msg);
    return;
  }
  showFatalError(e.error || e.message || e);
});

window.addEventListener('unhandledrejection', (e) => {
  if (document.getElementById('__fatal_panel__')) return;
  const msg = String(e.reason || e);
  if (msg.includes('EncodingError') || msg.includes('Failed to fetch')) {
    console.warn('Suppressed Error:', msg);
    return;
  }
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

      // Synchronous Pattern Load (Prevents Race Condition)
      let selected = (typeof patternSelect !== 'undefined') ? patternSelect.value : '';

      // If not signed in and there are no saved patterns, do nothing
      if (selected) {
        // Fallback: If dropdown is empty, try to get last used directly
        if (!selected && typeof LAST_USED_KEY !== 'undefined') {
          const last = localStorage.getItem(LAST_USED_KEY);
          if (last) selected = last;
        }

        if (selected && typeof loadPatternByName === 'function') {
          await loadPatternByName(selected);
        }
      }

      await setPresentation(localStorage.getItem(PRESENT_KEY) === 'on');

      // Force Sync of Virtual Handpan Proxy Controls (AFTER Pattern Load)
      if (typeof window.syncVirtualHandpanControls === 'function') {
        window.syncVirtualHandpanControls();
      }

      // Snapshot AFTER loading pattern to avoid 'unsaved changes' alert on clean load
      if (typeof serializePattern === 'function') {
        window.lastSavedState = JSON.stringify(serializePattern());
      }
    })();

    updatePatternButtons();
    updateComposeUI();

    if (DEBUG) runSelfTests();

    // Initial Snapshot handled inside the async block above
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