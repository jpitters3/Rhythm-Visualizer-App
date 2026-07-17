/**
 * js/onboarding-tour.js
 *
 * Per-section guided tour. Each feature area has its own step list and
 * localStorage flag. Tours are triggered by their respective route modules
 * on first visit.
 *
 * Step fields:
 *   target       CSS selector | null (null = centered card, no spotlight)
 *   title        Tooltip heading
 *   body         Tooltip body text
 *   position     'bottom' | 'top' | 'left' | 'right' | 'center'
 *   clickToAdvance  (optional) — spotlight the target, make overlay passthrough,
 *                    complete this tour when the user clicks the target
 *   tryme        (optional) — center card with a single "Got it" button;
 *                    used for Courses interactive prompts
 *
 * TBD selectors: '#__TBD__' won't match the DOM, so that step is silently
 * skipped until you replace it with the real selector.
 */

// ── Tour keys ─────────────────────────────────────────────────────────────────

export const TOUR_KEYS = {
  dashboard: 'panafide_tour_dashboard',
  studio:    'panafide_tour_studio',
  library:   'panafide_tour_library',
  composer:  'panafide_tour_composer',
  practice:  'panafide_tour_practice',
  courses:   'panafide_tour_courses',
  community: 'panafide_tour_community',
};

// Backward-compat alias used by dashboard.js
export const TOUR_KEY = TOUR_KEYS.dashboard;

// ── Step definitions ──────────────────────────────────────────────────────────
// Each tour has:
//   cta   { label }  — replaces the Skip button on the last card of the tour
//   steps [ ...step objects ]

const TOURS = {

  // ── Dashboard ──────────────────────────────────────────────────────────────
  dashboard: {
    cta: { label: 'Explore the Studio ☝️' },
    steps: [
      {
        target: null,
        title: 'Welcome to Panafide!',
        body: "Your teacher set up this app to guide your handpan journey. Let's take 30 seconds to show you around.",
        position: 'center',
      },
      {
        target: null,
        title: 'Your current assignment',
        body: "This is the main thing you're working on to improve your handpan game. Assignments can come from your current course or directly from your teacher.",
        position: 'bottom',
      },
      {
        target: '#dashGoalsContent',
        title: 'Your goals',
        body: 'Set your dream goal and a short-term focus. Your teacher can see these — it helps them tailor your lessons to where you want to go.',
        position: 'bottom',
      },
      {
        target: '#dashPracticeContent',
        title: 'Your practice plan',
        body: "The exercises you're currently working on every day.",
        position: 'bottom',
      },
      {
        target: '#dashCoursesContent',
        title: 'Active courses',
        body: "The courses you're currently working through.",
        position: 'bottom',
      },
      {
        target: 'a[data-route="studio"]',
        title: 'Next: the Studio',
        body: "This is where you'll play and compose. Click Studio in the nav to explore it.",
        position: 'bottom',
        clickToAdvance: true,
      },
    ],
  },

  // ── Studio ─────────────────────────────────────────────────────────────────
  studio: {
    cta: { label: 'Check out the Library ☝️' },
    steps: [
      {
        target: '#handpanWrap',
        title: 'Play the virtual handpan',
        body: 'Click or tap the notes on the handpan to play it. Give it a try!',
        position: 'bottom',
      },
      {
        target: '.handpan-tabs',
        title: 'Scale options',
        body: 'Change your handpan scale, add a custom tuning, and explore the chords available on your instrument.',
        position: 'bottom',
      },
      {
        target: '#measures',
        title: 'Compose a phrase',
        body: 'Select a cell, then play the handpan to record notes into it.',
        position: 'left',
      },
      {
        target: '#primaryControlsWrapper',
        title: 'Studio settings',
        body: 'Clear the grid, enable compose mode, change time signature, and more.',
        position: 'bottom',
      },
      {
        target: '#mainTransport-A',
        title: 'Playback controls',
        body: 'Adjust metronome sound, tempo, countdown, and other playback settings here.',
        position: 'top',
      },
      {
        target: 'a[data-route="library"]',
        title: 'Next: your Library',
        body: 'Phrases you save in the Studio live here. Click Library to explore it.',
        position: 'bottom',
        clickToAdvance: true,
      },
    ],
  },

  // ── Library ────────────────────────────────────────────────────────────────
  library: {
    cta: { label: 'Open the Composer ☝️' },
    steps: [
      {
        target: null,
        title: 'Your phrase library',
        body: 'Every phrase you create in the Studio is saved here. Organize, rename, and reload them any time.',
        position: 'center',
      },
      {
        target: '#toggleComposerBtn',
        title: 'Next: the Composer',
        body: 'Stack multiple phrases into a full song. Click Composer to check it out.',
        position: 'bottom',
        clickToAdvance: true,
      },
    ],
  },

  // ── Composer ───────────────────────────────────────────────────────────────
  composer: {
    cta: { label: 'Open the Practice panel ☝️' },
    steps: [
      {
        target: '#newCompositionBtn',
        title: 'Create a new composition',
        body: 'Build a composition by adding multiple phrases and arrange them into a full song. Composer is a premium feature. Upgrade to unlock.',
        position: 'bottom',
      },
      {
        target: '#toggleExercisesBtn',
        title: 'Next: Practice',
        body: 'Your daily exercises live in Practice. Click it to take a look.',
        position: 'bottom',
        clickToAdvance: true,
      },
    ],
  },

  // ── Practice ───────────────────────────────────────────────────────────────
  practice: {
    cta: { label: 'Open the Courses panel ☝️' },
    steps: [
      {
        target: '#practiceSidebar',
        title: '👈 Your practice plan',
        body: "These are the exercises you're working on every day. Tap one to load it into the Studio.",
        position: 'center',
      },
      {
        target: '#toggleSidebarBtn',
        title: 'Next: Courses',
        body: 'Structured learning paths to improve your playing. Click Courses to explore them.',
        position: 'bottom',
        clickToAdvance: true,
      },
    ],
  },

  // ── Courses ────────────────────────────────────────────────────────────────
  courses: {
    cta: { label: 'Browse courses →' },
    steps: [
      {
        target: null,
        title: 'Your course library',
        body: 'Courses are structured paths of lessons. Each lesson includes a phrase you can load straight into the Studio.',
        position: 'center',
      },
      {
        target: '.browse-icon-btn', // marketplace / browse area
        title: 'Marketplace',
        body: 'Find a free course and tap Get Course to add it to your dashboard. Give it a try!',
        position: 'bottom',
        tryme: true,
      },
      {
        target: '#__TBD__', // lesson list
        title: 'Open a lesson',
        body: 'Tap any lesson to see its content and load its phrase into the Studio.',
        position: 'bottom',
        tryme: true,
      },
      {
        target: '#__TBD__', // mark-complete button
        title: 'Mark it complete',
        body: "When you're done with a lesson, mark it complete to track your progress.",
        position: 'top',
        tryme: true,
      },
      {
        target: 'a[data-route="community"]',
        title: 'Next: Community',
        body: 'Connect with other handpan players. Click Community to check it out.',
        position: 'bottom',
        clickToAdvance: true,
      },
    ],
  },

  // ── Community ──────────────────────────────────────────────────────────────
  community: {
    cta: { label: 'Go to my Dashboard →' },
    steps: [
      {
        target: '#__TBD__', // community feed / root
        title: 'The Panafide community',
        body: 'Share music, connect with other handpan players, and grow together.',
        position: 'bottom',
      },
      {
        target: null,
        title: "You're all set!",
        body: 'Your teacher will guide you from here. Come back to your Dashboard any time to see your latest assignment.',
        position: 'center',
      },
    ],
  },

};

// ── Public API ────────────────────────────────────────────────────────────────

export function hasSeen(sectionKey) {
  return !!localStorage.getItem(TOUR_KEYS[sectionKey]);
}

export function startTour(sectionKey = 'dashboard') {
  if (active) return;
  const tour = TOURS[sectionKey];
  if (!tour) return;
  activeSectionKey = sectionKey;
  activeCta = tour.cta ?? null;
  active = true;
  currentStep = 0;
  activeSteps = tour.steps.filter(s => !s.target || document.querySelector(s.target));
  if (activeSteps.length === 0) { markSeen(sectionKey); return; }
  buildDOM();
  showStep(0);
}

export function resetTour(sectionKey) {
  if (sectionKey) {
    localStorage.removeItem(TOUR_KEYS[sectionKey]);
  } else {
    Object.values(TOUR_KEYS).forEach(k => localStorage.removeItem(k));
  }
}

// ── State ─────────────────────────────────────────────────────────────────────

let activeSectionKey = null;
let activeCta = null;
let activeSteps = [];
let currentStep = 0;
let overlayEl = null;
let ringEl = null;
let tooltipEl = null;
let active = false;
let pendingRaf = null;
let advanceCleanup = null;

// ── DOM construction ──────────────────────────────────────────────────────────

function buildDOM() {
  overlayEl = document.createElement('div');
  overlayEl.className = 'tour-overlay';
  document.body.appendChild(overlayEl);

  ringEl = document.createElement('div');
  ringEl.className = 'tour-highlight-ring';
  ringEl.hidden = true;
  document.body.appendChild(ringEl);

  tooltipEl = document.createElement('div');
  tooltipEl.className = 'tour-tooltip';
  document.body.appendChild(tooltipEl);
}

// ── Step rendering ────────────────────────────────────────────────────────────

function showStep(index) {
  currentStep = index;
  const step = activeSteps[index];
  const isFirst = index === 0;
  const isLast = index === activeSteps.length - 1;
  const total = activeSteps.length;

  // Clean up any previous clickToAdvance listener
  if (advanceCleanup) { advanceCleanup(); advanceCleanup = null; }

  const targetEl = step.target ? document.querySelector(step.target) : null;

  // Overlay + ring
  if (step.clickToAdvance && targetEl) {
    // Passthrough overlay so the user can actually click the target
    overlayEl.classList.remove('tour-overlay--dim');
    overlayEl.classList.add('tour-overlay--passthrough');
    ringEl.hidden = false;
    positionRing(targetEl);
    // Complete this section's tour when they click the highlighted element
    const handler = () => completeTour();
    targetEl.addEventListener('click', handler, { once: true });
    advanceCleanup = () => targetEl.removeEventListener('click', handler);
  } else if (targetEl) {
    overlayEl.classList.remove('tour-overlay--dim', 'tour-overlay--passthrough');
    ringEl.hidden = false;
    positionRing(targetEl);
  } else {
    overlayEl.classList.add('tour-overlay--dim');
    overlayEl.classList.remove('tour-overlay--passthrough');
    ringEl.hidden = true;
  }

  // On the last card, the CTA replaces the Skip button
  const ctaHtml = (isLast && activeCta)
    ? `<button class="tour-btn-cta" id="tourCtaBtn">${activeCta.label}</button>`
    : `<button class="tour-btn-skip" id="tourSkipBtn">${step.clickToAdvance ? 'Skip tour' : 'Skip'}</button>`;

  // Tooltip content
  if (step.clickToAdvance) {
    tooltipEl.innerHTML = `
      <div class="tour-step-count">${index + 1} / ${total}</div>
      <h3 class="tour-title">${step.title}</h3>
      <p class="tour-body">${step.body}</p>
      <div class="tour-actions">
        ${!isFirst ? '<button class="tour-btn-back" id="tourPrevBtn">← Back</button>' : '<div></div>'}
        <div class="tour-actions-right">${ctaHtml}</div>
      </div>
    `;
  } else if (step.tryme) {
    tooltipEl.innerHTML = `
      <div class="tour-step-count">${index + 1} / ${total}</div>
      <h3 class="tour-title">${step.title}</h3>
      <p class="tour-body">${step.body}</p>
      <div class="tour-actions">
        <div></div>
        <div class="tour-actions-right">
          <button class="tour-btn-next" id="tourNextBtn">Got it →</button>
        </div>
      </div>
    `;
  } else {
    tooltipEl.innerHTML = `
      <div class="tour-step-count">${index + 1} / ${total}</div>
      <h3 class="tour-title">${step.title}</h3>
      <p class="tour-body">${step.body}</p>
      <div class="tour-actions">
        ${!isFirst ? '<button class="tour-btn-back" id="tourPrevBtn">← Back</button>' : '<div></div>'}
        <div class="tour-actions-right">
          ${ctaHtml}
          ${!isLast ? '<button class="tour-btn-next" id="tourNextBtn">Next →</button>' : ''}
        </div>
      </div>
    `;
  }

  positionTooltip(targetEl, step.position);

  document.getElementById('tourNextBtn')?.addEventListener('click', () => {
    isLast ? completeTour() : showStep(index + 1);
  });
  document.getElementById('tourPrevBtn')?.addEventListener('click', () => {
    if (index > 0) showStep(index - 1);
  });
  document.getElementById('tourSkipBtn')?.addEventListener('click', completeTour);
  document.getElementById('tourCtaBtn')?.addEventListener('click', completeTour);
}

// ── Positioning ───────────────────────────────────────────────────────────────

function positionRing(el) {
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  scheduleRaf(() => {
    const rect = el.getBoundingClientRect();
    const pad = 10;
    ringEl.style.top    = `${rect.top    - pad}px`;
    ringEl.style.left   = `${rect.left   - pad}px`;
    ringEl.style.width  = `${rect.width  + pad * 2}px`;
    ringEl.style.height = `${rect.height + pad * 2}px`;
  });
}

function positionTooltip(targetEl, position) {
  const GAP = 18;
  const TW  = 320;

  if (!targetEl || position === 'center') {
    tooltipEl.style.cssText = 'top:50%;left:50%;transform:translate(-50%,-50%)';
    return;
  }

  tooltipEl.style.transform = '';

  scheduleRaf(() => {
    const rect = targetEl.getBoundingClientRect();
    const th   = tooltipEl.offsetHeight;
    const vw   = window.innerWidth;
    const vh   = window.innerHeight;

    let top, left;
    if (position === 'bottom') {
      top  = rect.bottom + GAP;
      left = rect.left + rect.width / 2 - TW / 2;
    } else if (position === 'top') {
      top  = rect.top - th - GAP;
      left = rect.left + rect.width / 2 - TW / 2;
    } else if (position === 'right') {
      top  = rect.top + rect.height / 2 - th / 2;
      left = rect.right + GAP;
    } else {
      top  = rect.top + rect.height / 2 - th / 2;
      left = rect.left - TW - GAP;
    }

    left = Math.max(12, Math.min(left, vw - TW - 12));
    top  = Math.max(12, Math.min(top,  vh - th - 12));

    tooltipEl.style.top  = `${top}px`;
    tooltipEl.style.left = `${left}px`;
  });
}

function scheduleRaf(fn) {
  if (pendingRaf) cancelAnimationFrame(pendingRaf);
  pendingRaf = requestAnimationFrame(() => { pendingRaf = null; fn(); });
}

// ── Completion ────────────────────────────────────────────────────────────────

function markSeen(sectionKey) {
  localStorage.setItem(TOUR_KEYS[sectionKey], '1');
}

function completeTour() {
  markSeen(activeSectionKey);
  active = false;
  activeSectionKey = null;
  activeCta = null;
  if (advanceCleanup) { advanceCleanup(); advanceCleanup = null; }
  if (pendingRaf) { cancelAnimationFrame(pendingRaf); pendingRaf = null; }
  overlayEl?.remove();
  ringEl?.remove();
  tooltipEl?.remove();
  overlayEl = ringEl = tooltipEl = null;
  activeSteps = [];
}

// ── Route → tour key map ──────────────────────────────────────────────────────

const ROUTE_TOUR = {
  studio:    'studio',
  library:   'library',
  compose:   'composer',
  practice:  'practice',
  community: 'community',
  // dashboard is triggered by dashboard.js after loadDashboard() completes
  // courses is triggered separately (sidebar, not a hash route)
};

// ── Init ──────────────────────────────────────────────────────────────────────

export function initTour() {
  // Hash-route sections
  window.addEventListener('routeChanged', e => {
    const sectionKey = ROUTE_TOUR[e.detail.route];
    if (sectionKey && !hasSeen(sectionKey)) startTour(sectionKey);
  });

  // Sidebar-panel sections (no route change — listen for button clicks instead)
  const sidebarTours = [
    { btnId: 'toggleComposerBtn',  sectionKey: 'composer' },
    { btnId: 'toggleExercisesBtn', sectionKey: 'practice' },
    { btnId: 'toggleSidebarBtn',   sectionKey: 'courses'  },
  ];
  sidebarTours.forEach(({ btnId, sectionKey }) => {
    document.getElementById(btnId)?.addEventListener('click', () => {
      if (!hasSeen(sectionKey)) {
        // Small delay so the panel finishes opening before we spotlight elements inside it
        setTimeout(() => startTour(sectionKey), 300);
      }
    });
  });
}
