/**
 * js/onboarding-tour.js
 * First-login guided tour + logged-out feature promotion.
 *
 * All tour steps live in STEPS below — add/remove/reorder freely.
 * Steps whose target element is absent are skipped automatically.
 */


export const TOUR_KEY = 'panafide_tour_seen';

// ── Step definitions ──────────────────────────────────────────────────────────
// position: 'center' | 'top' | 'bottom' | 'left' | 'right'
// target: CSS selector, or null for a centered card with no spotlight

const STEPS = [
  {
    target: null,
    title: 'Welcome to Panafide!',
    body: "Your teacher set up this app to guide your handpan journey. Let's take 30 seconds to show you around.",
    position: 'center',
  },
  {
    target: '#dashAssignmentCard',
    title: 'Your current assignment',
    body: "Your teacher assigns exercises here. Tap the card to open your practice session and submit your work when you're ready.",
    position: 'bottom',
  },
  {
    target: '#dashGoalsContent',
    title: 'Your goals',
    body: 'Set your dream goal and a short-term focus. Your teacher can see these — it helps them tailor your lessons to where you want to go.',
    position: 'bottom',
  },
  {
    target: '#dashCoursesContent',
    title: 'Your courses',
    body: 'Your enrolled courses live here. Each one guides you through a structured path of lessons at your own pace.',
    position: 'bottom',
  },
  {
    target: null,
    title: "You're all set!",
    body: 'Your teacher will guide you from here. Tap your assignment card any time to start playing.',
    position: 'center',
  },
];

// ── State ─────────────────────────────────────────────────────────────────────

let activeSteps = [];   // filtered copy of STEPS (only those whose targets exist)
let currentStep = 0;
let overlayEl = null;
let ringEl = null;
let tooltipEl = null;
let active = false;
let pendingRaf = null;

// ── Init ──────────────────────────────────────────────────────────────────────

export function initTour() {
  // Tour is triggered by dashboard.js after AUTH_LOGIN + loadDashboard() complete.
}

// ── Public API ────────────────────────────────────────────────────────────────

export function startTour() {
  if (active) return;
  active = true;
  currentStep = 0;
  // Filter once at start — steps whose target isn't in the DOM are omitted.
  // Back/Next navigate a flat valid list with no runtime skipping.
  activeSteps = STEPS.filter(s => !s.target || document.querySelector(s.target));
  buildDOM();
  showStep(0);
}

export function resetTour() {
  localStorage.removeItem(TOUR_KEY);
}

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

  const targetEl = step.target ? document.querySelector(step.target) : null;

  // Spotlight ring — ring shadow dims outside the target; overlay dims for center steps
  if (targetEl) {
    overlayEl.classList.remove('tour-overlay--dim');
    ringEl.hidden = false;
    positionRing(targetEl);
  } else {
    overlayEl.classList.add('tour-overlay--dim');
    ringEl.hidden = true;
  }

  // Tooltip content
  tooltipEl.innerHTML = `
    <div class="tour-step-count">${index + 1} / ${total}</div>
    <h3 class="tour-title">${step.title}</h3>
    <p class="tour-body">${step.body}</p>
    <div class="tour-actions">
      ${!isFirst
        ? '<button class="tour-btn-back" id="tourPrevBtn">← Back</button>'
        : '<div></div>'}
      <div class="tour-actions-right">
        <button class="tour-btn-skip" id="tourSkipBtn">Skip</button>
        <button class="tour-btn-next" id="tourNextBtn">${isLast ? 'Get started' : 'Next →'}</button>
      </div>
    </div>
  `;

  positionTooltip(targetEl, step.position);

  document.getElementById('tourNextBtn')?.addEventListener('click', () => {
    isLast ? completeTour() : showStep(index + 1);
  });
  document.getElementById('tourPrevBtn')?.addEventListener('click', () => {
    if (index > 0) showStep(index - 1);
  });
  document.getElementById('tourSkipBtn')?.addEventListener('click', completeTour);
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

function completeTour() {
  localStorage.setItem(TOUR_KEY, '1');
  active = false;
  if (pendingRaf) { cancelAnimationFrame(pendingRaf); pendingRaf = null; }
  overlayEl?.remove();
  ringEl?.remove();
  tooltipEl?.remove();
  overlayEl = ringEl = tooltipEl = null;
  activeSteps = [];
}
