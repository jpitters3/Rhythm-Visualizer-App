// ===== INIT =====
import { gridA } from './grid-context.js';
import { currentUser, activeGrid } from './state.js';
import { cells, renderAllMeasures, initNoteGrid } from './notegrid.js';
import { ADMIN_EMAILS, COMPOSE_KEY } from './config.js';
import { TransportRegistry } from './transport-ui.js';
import { stop, setBeats, setSubdivision, initNotePlayer, unlockAudio } from './noteplayer.js';
import { loadSharedFromURL } from './share-patterns.js';
import { loadSharedCompositionFromURL, resumePendingSharedComp } from './song-composer.js';
import { refreshPatternSelect, updatePatternButtons, snapshotCurrentState } from './pattern-crud.js';
import { initCourseCreator } from './course-creator.js';
import { alert } from './alert.js';
import { initControls, loadPatternByName, syncVirtualHandpanControls } from './controls.js';
import { updateComposeUI } from './compose-mode.js';
import { setPresentation, initPresentation } from './presentation-mode.js';
import { initAuth } from './auth.js';
import { initDashboard } from './dashboard.js';
import { STEPS } from './rhythm-core.js';
import { supabase } from './supabase-client.js';
import { initCourses } from './courses.js';
import { initMobileMenu } from './mobile-menu.js';
import { initShortcuts } from './keyboard-shortcuts.js';
import { initMeasureActions } from './measure-actions.js';
import { HistoryManager } from './history.js';
import ChordUI from './chord-ui.js';
import { initPOTW } from './pattern-of-the-week.js';
import { initHandpanMap, initScale } from './handpanmap.js';
import { initTranscription } from './transcription.js';
import { initAiAssistant } from './ai-assistant.js';
import { initCalibration } from './calibration.js';
import { initFeed } from './feed.js';
import { initLibrary } from './library.js';
import { initCourseMarketplace } from './course-marketplace.js';
import { Bus, BUS_EVENT } from './bus.js';
import { initCoachingMode } from './coaching-mode.js';
import { initCalProfiles } from './cal-profiles.js';
import { initGames } from './games.js';
import { initAdmin } from './admin.js';
import { initNotifications } from './notifications.js';
import { initNotificationSettings } from './notification-settings.js';
import { initAccountSettings } from './account-settings.js';
import { initStudentAssignments } from './student-assignments.js';
import { initStudentManagement } from './student-management.js';
import { initRouter } from './router.js';
import { initComposeWizard } from './compose-wizard.js';
import { initGlossary } from './glossary.js';
import { initGridAutoscroll } from './grid-autoscroll.js';
import { initGridZoom } from './grid-zoom.js';
import { initMonetization } from './monetization.js';
import { initScrollIndicators } from './scroll-indicators.js';
import { initMethod, wireMethodEvents } from './method.js';
import { initExercises } from './exercises.js';



/**
 * Main application initializer
 */
async function init() {
  console.log('--- APP INIT START ---');

  try {
    // 1. Auth + Dashboard (shown immediately while the rest of the app loads)
    await initAuth();
    initDashboard();

    // 2. Core UI/Logic
    await initScale();
    initMobileMenu();
    initMeasureActions();
    initPresentation();
    initGridAutoscroll();
    initGridZoom();
    initScrollIndicators();
    initPOTW();
    HistoryManager.init();
    ChordUI.init();
    initHandpanMap();
    initTranscription();
    initCalProfiles();
    initCoachingMode();
    initAiAssistant();
    initCalibration();
    initFeed();
    initLibrary();
    initGames();
    initCourseMarketplace();
    initCourseCreator();
    initCourses();


    // Admin Tools (Async check inside)
    initAdmin();
    initNotificationSettings();
    initNotifications();
    initAccountSettings();
    initStudentAssignments();
    initStudentManagement();

    initControls();
    initShortcuts();
    setupAudioUnlock();
    initNotePlayer();
    initNoteGrid();
    initComposeWizard();
    initGlossary();
    initMonetization();
    initMethod();
    wireMethodEvents();
    initExercises();
    initRouter();

    // 3. Launch safeInit (which handles pattern loading and final renders)
    safeInit();

    console.log('--- APP INIT COMPLETE ---');
  } catch (err) {
    showFatalError(err);
  }
}

function updateMetroUI() {
  const ctx = activeGrid || gridA;
  if (TransportRegistry) TransportRegistry.updateAll(ctx);
}


export function restorePrefs() {
  if (localStorage.getItem('theme') === 'dark') {
    document.body.classList.add('dark');
  }

  const handOn = localStorage.getItem('handSplit') === 'on';
  document.body.classList.toggle('handSplit', handOn);
  const handBtn = document.getElementById('handBtn');
  if (handBtn) {
    handBtn.classList.toggle('active', handOn);
    handBtn.textContent = handOn ? 'Left/Right: On' : 'Left/Right: Off';
  }

  /* metronomeOn was implicit. We use local var to read check */
  let isMetroOn = (localStorage.getItem('groovepan_metro-A') === 'on');
  if (localStorage.getItem('groovepan_metro-A') === null) {
    isMetroOn = (localStorage.getItem('groovepan_metro') === 'on');
  }
  if (gridA) gridA.metronomeOn = isMetroOn;
  if (gridA) gridA.metronomeSubdiv = localStorage.getItem('groovepan_metro_subdiv-A') !== 'off';
  if (gridA) gridA.countdownEnabled = localStorage.getItem('groovepan_countdown-A') === 'on';

  updateMetroUI();
}

function setupAudioUnlock() {
  console.log('[Init] setupAudioUnlock called - attaching listeners');
  const unlock = () => {
    console.log('[Init] Global audio unlock triggered');
    unlockAudio();
    document.removeEventListener('click', unlock);
    document.removeEventListener('keydown', unlock);
    document.removeEventListener('touchstart', unlock);
  };
  document.addEventListener('click', unlock);
  document.addEventListener('keydown', unlock);
  document.addEventListener('touchstart', unlock);
  console.log('[Init] Audio unlock listeners attached');
}

function runSelfTests() {
  // Existing smoke tests (kept)
  console.assert(document.getElementById('grid') && document.getElementById('labels'), 'Grid/labels elements exist');
  console.assert(cells().length === STEPS, `Expected ${STEPS} cells after renderAllMeasures()`);
  const labelsEl = document.getElementById('labels');
  console.assert(labelsEl && labelsEl.children.length === STEPS, `Expected ${STEPS} labels after renderAllMeasures()`);

  // Added: each cell should have a hand side class
  cells().forEach((c) => {
    console.assert(c.classList.contains('hand-l') || c.classList.contains('hand-r'), 'Cell has hand-l/hand-r');
  });

  console.assert(document.querySelector('.transport-container'), 'Transport container exists');
  // console.assert(typeof metroClick === 'function', 'metroClick is a function'); // Removed: private internal

  const presentBtn = document.getElementById('presentBtn');
  const exitPresent = document.getElementById('exitPresent');
  console.assert(!!presentBtn && !!exitPresent, 'Presentation buttons exist');

  // Added: Hand icons should be defined as mask-images in split mode CSS
  console.assert(getComputedStyle(document.documentElement).getPropertyValue('--hand-icon') !== '', 'Hand icon color var exists');

  // Subdivision toggle should rebuild correct step count
  const before = STEPS;
  const ctx = activeGrid || gridA;
  const prevSub = ctx.subdivision;
  const nextSub = prevSub === 2 ? 4 : 2;
  setSubdivision(nextSub);
  const newCount = ctx.stepsPerMeasure;
  console.assert(newCount !== before, 'Subdivision toggle changes step count');
  console.assert(cells().length === newCount, 'Grid rebuilt to new step count');
  // revert
  setSubdivision(prevSub);
  console.assert(cells().length === before, 'Grid rebuilt back');
}

async function showFatalError(err) {
  // Ensure we stop any running timers if an error happens during startup
  try { if (typeof stop === 'function') stop(); } catch { }

  console.error(err);

  const modal = document.getElementById('errorModal');
  const stackPre = document.getElementById('errorStack');
  const continueBtn = document.getElementById('errorContinueBtn');

  if (!modal || !stackPre) {
    // Fallback if DOM not ready or modal deleted
    await alert("App Failed: " + err);
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

// ── Viewport height fix ────────────────────────────────────────────────────────
// dvh tracks the actual visible height (shrinks when browser chrome is visible).
// --app-height is a fallback for browsers that don't support dvh.
const setAppHeight = () =>
  document.documentElement.style.setProperty('--app-height', `${window.innerHeight}px`);
window.addEventListener('resize', setAppHeight);
setAppHeight();

// Global error handlers
window.addEventListener('error', (e) => {
  if (document.getElementById('__fatal_panel__')) return;
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
const DEBUG = new URLSearchParams(location.search).has('debug');

function safeInit() {
  try {
    console.log('SafeInit Started');
    restorePrefs();
    console.log('Restored Prefs');
    renderAllMeasures();
    console.log('Initial Render Complete');

    (async () => {
      const loadedShared = await loadSharedFromURL();
      await loadSharedCompositionFromURL();

      // After login, open any composition the user was trying to view before auth
      Bus.on(BUS_EVENT.PROFILE_LOADED, resumePendingSharedComp);
      // refreshPatternSelect imported from pattern-crud.js
      await refreshPatternSelect();

      // Synchronous Pattern Load — skip if a shared pattern was already loaded
      const patternSelect = document.getElementById('patternSelect');
      let selected = (patternSelect) ? patternSelect.value : '';

      // If not signed in and there are no saved patterns, do nothing
      if (selected && !loadedShared) {
        // Fallback: If dropdown is empty, try to get last used directly
        // We use imported controls logic or pattern-crud Logic
        // But here we rely on refreshPatternSelect having populated it.

        if (selected) {
          await loadPatternByName(selected);
        }
      }

      await setPresentation(localStorage.getItem('groovepan_presentation_mode') === 'on'); // Use implicit key or import PRESENT_KEY? String literal is safe.

      // Force Sync of Virtual Handpan Proxy Controls
      if (typeof syncVirtualHandpanControls === 'function') {
        syncVirtualHandpanControls();
      }

      // Snapshot AFTER loading pattern
      snapshotCurrentState();

    })();

    updatePatternButtons();
    updateComposeUI();

    if (DEBUG) runSelfTests();

  } catch (err) {
    showFatalError(err);
  }
}

// Let the browser paint UI first, then init.
requestAnimationFrame(() => {
  setTimeout(() => {
    init();
  }, 0);
});