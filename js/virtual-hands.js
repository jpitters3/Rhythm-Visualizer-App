// virtual-hands.js
// Visualizes hand movements on the virtual handpan
import { HANDPAN_MAP } from './handpanmap.js';
import { resolveHand, addTickObserver } from './noteplayer.js';
import { checkCellIsMultiMode } from './notegrid.js';

// Simplified back-of-hand silhouette (drawn as a right hand; the left hand
// mirrors it via CSS `transform: scaleX(-1)`). Two small circles sit at the
// index and thumb tips — normally invisible, they flash via the
// `finger-light lit` animation when that specific finger strikes a chord
// slot (see `triggerStrike`).
const HAND_ICON_SVG = `
  <svg class="hand-icon" viewBox="0 0 40 52" aria-hidden="true">
    <path class="hand-palm" d="
      M 10 22
      C 10 10, 12 3, 15 3
      C 18 3, 19 9, 19 16
      L 19 20
      C 19 15, 20 8, 23 8
      C 26 8, 27 14, 27 20
      C 28 15, 29 11, 31 11
      C 33 11, 34 16, 33 22
      L 33 30
      C 33 42, 27 49, 20 49
      C 13 49, 9 43, 8 35
      C 6 32, 3 27, 5 23
      C 6 20, 9 21, 10 24
      Z" />
    <circle class="finger-light finger-light-index" cx="16" cy="7" r="4" />
    <circle class="finger-light finger-light-thumb" cx="6" cy="27" r="4" />
  </svg>
`;

class VirtualHands {
  constructor() {
    // FIX: Append to 'handpanWrap' instead of 'handpanOverlay'
    // because 'handpanOverlay' gets innerHTML='' frequently.
    this.overlay = document.getElementById('handpanWrap');
    this.layer = document.createElement('div');
    this.layer.className = 'v-hand-layer';

    // Create Left and Right hands
    this.leftHand = this.createHand('h-left', 'L');
    this.rightHand = this.createHand('h-right', 'R');

    if (this.overlay) {
      this.overlay.appendChild(this.layer);
    }

    this.restPosition = { x: 50, y: 50 }; // Center
    this.lastL = null;
    this.lastR = null;

    // Persistence
    const saved = localStorage.getItem('vHandsEnabled');
    this.enabled = saved === null ? true : (saved === 'true'); // Default ON

    // UI Toggle
    this.toggleBtn = document.getElementById('vHandsToggle');
    if (this.toggleBtn) {
      this.toggleBtn.checked = this.enabled;
      this.toggleBtn.addEventListener('change', (e) => this.setEnabled(e.target.checked));
    }

    // Style: orb markers (default) or illustrated hands
    this.style = localStorage.getItem('vHandsStyle') === 'hands' ? 'hands' : 'orbs';
    this.styleSelect = document.getElementById('vHandsStyleSelect');
    if (this.styleSelect) {
      this.styleSelect.value = this.style;
      this.styleSelect.addEventListener('change', (e) => this.setStyle(e.target.value));
    }
    this.updateStyle();

    this.updateVisibility();

    // Register with NotePlayer
    addTickObserver((ctx, notes, hands) => this.onTick(ctx, notes, hands));

    // Performance Observer: Hide hands when heavy modals are open
    this.initVisibilityObserver();
  }

  initVisibilityObserver() {
    // We want to hide the layer if #courseModal has class 'open' 
    // OR #lessonPlayer is visible
    const courseModal = document.getElementById('courseModal');
    const lessonPlayer = document.getElementById('lessonPlayer');

    const check = () => {
      if (!this.layer) return;

      const isCourseOpen = courseModal && courseModal.classList.contains('open');
      const isLessonOpen = lessonPlayer && lessonPlayer.style.display !== 'none' && lessonPlayer.style.display !== '';

      if (isCourseOpen || isLessonOpen) {
        if (this.layer.style.display !== 'none') {
          this.layer.style.display = 'none';
        }
      } else {
        // Only restore if globally enabled
        if (this.enabled && this.layer.style.display === 'none') {
          this.layer.style.display = 'block';
        }
      }
    };

    // Observer for Course Modal Class Changes
    if (courseModal) {
      new MutationObserver(check).observe(courseModal, { attributes: true, attributeFilter: ['class'] });
    }

    // Observer for Lesson Player Style Changes
    if (lessonPlayer) {
      new MutationObserver(check).observe(lessonPlayer, { attributes: true, attributeFilter: ['style'] });
    }

    // Also check on interval just in case interaction misses observer
    setInterval(check, 1000);
  }

  setEnabled(val) {
    this.enabled = val;
    localStorage.setItem('vHandsEnabled', val);
    this.updateVisibility();
  }

  updateVisibility() {
    if (!this.layer) return;
    // Respect the manual toggle, but Observer will override if modal is open
    this.layer.style.display = this.enabled ? 'block' : 'none';
  }

  setStyle(val) {
    this.style = val === 'hands' ? 'hands' : 'orbs';
    localStorage.setItem('vHandsStyle', this.style);
    this.updateStyle();
  }

  updateStyle() {
    if (!this.layer) return;
    this.layer.classList.toggle('hand-style-graphic', this.style === 'hands');
  }

  createHand(type, label) {
    const el = document.createElement('div');
    el.className = `v-hand ${type}`;

    const orb = document.createElement('span');
    orb.className = 'v-hand-orb';
    orb.textContent = label;
    el.appendChild(orb);

    el.insertAdjacentHTML('beforeend', HAND_ICON_SVG);

    this.layer.appendChild(el);
    return el;
  }

  onTick(ctx, stepNotes, stepHands) {
    // Only visualize for Grid A
    if (ctx.id !== 'A' || !this.enabled) return;

    // --- LOOKAHEAD LOGIC ---
    let nextL = null;
    let nextR = null;

    // Limit lookahead to ~2 beats (8 sub-steps in 16th mode)
    const maxLookahead = 8;
    const all = ctx.cells;
    const totalSteps = all.length;

    for (let i = 1; i <= maxLookahead; i++) {
      if (nextL && nextR) break;

      const futureStep = (ctx.step + i) % totalSteps;
      const futureData = ctx.innerLabels[futureStep];
      const futureHands = ctx.innerHands[futureStep];

      // Note: We use ctx.step of the current tick, but ctx.step is incremented at end of tick.
      // noteplayer.js tick calls observers BEFORE incrementing step.
      // So ctx.step is the CURRENT playing step.
      // So lookahead starts at step + 1. Correct.

      if (!futureData) continue;

      const labels = Array.isArray(futureData) ? futureData : [futureData];
      const isChord = checkCellIsMultiMode(futureData);

      labels.forEach((lbl, sIdx) => {
        if (!lbl) return;
        const h = resolveHand(futureStep, futureHands, sIdx, isChord, ctx.subdivision);
        if (h === 'L' && !nextL) nextL = lbl;
        if (h === 'R' && !nextR) nextR = lbl;
      });
    }

    // Which finger (thumb/index) struck, if that detail is available.
    // Only chord/multi-note cells track individual finger slots today —
    // lh-index/rh-index are the even slots, lh-thumb/rh-thumb the odd ones
    // (see notegrid.js's sub-dot dataset.idx assignment). A plain single
    // note has no slot at all, so both stay null and the whole hand just
    // pulses instead of a specific fingertip lighting up.
    let fingerL = null;
    let fingerR = null;
    const currentData = ctx.innerLabels[ctx.step];
    if (Array.isArray(currentData)) {
      const currentHandsData = ctx.innerHands[ctx.step];
      currentData.forEach((label, subIdx) => {
        if (!label) return;
        const hand = resolveHand(ctx.step, currentHandsData, subIdx, true, ctx.subdivision);
        const finger = (subIdx % 2 === 0) ? 'index' : 'thumb';
        if (hand === 'L') fingerL = finger; else fingerR = finger;
      });
    }

    this.update(stepNotes, stepHands, nextL, nextR, fingerL, fingerR);
  }

  /**
   * Update hands for the current step.
   * @param {Array} notes - Active notes triggering a strike
   * @param {Array} hands - Hand assignments for active notes
   * @param {string} nextL - Next target note for Left hand (anticipation)
   * @param {string} nextR - Next target note for Right hand (anticipation)
   * @param {string|null} fingerL - 'index' | 'thumb' | null for the Left hand's strike
   * @param {string|null} fingerR - 'index' | 'thumb' | null for the Right hand's strike
   */
  update(notes, hands, nextL, nextR, fingerL = null, fingerR = null) {
    if (!this.overlay || !this.enabled) return;

    // Reset strike states
    this.leftHand.classList.remove('striking');
    this.rightHand.classList.remove('striking');

    // Determine current active notes for each hand
    let activeL = null;
    let activeR = null;

    if (notes && notes.length > 0) {
      notes.forEach((note, idx) => {
        const hand = hands[idx] || 'R';
        if (hand === 'L') activeL = note;
        else activeR = note; // Default 'R'
      });
    }

    // TARGET LOGIC:
    // If active, go to active note. 
    // If idle, go to next note (anticipation).
    // If no next note, stay at last known position (or center?) -> Stay at last active is usually best.

    // LEFT HAND
    if (activeL) {
      this.moveHand(this.leftHand, activeL);
      this.triggerStrike(this.leftHand, fingerL);
      this.lastL = activeL; // Update memory
    } else if (nextL) {
      // Anticipate
      this.moveHand(this.leftHand, nextL);
    }
    // else: stay put

    // RIGHT HAND
    if (activeR) {
      this.moveHand(this.rightHand, activeR);
      this.triggerStrike(this.rightHand, fingerR);
      this.lastR = activeR;
    } else if (nextR) {
      this.moveHand(this.rightHand, nextR);
    }
  }

  moveHand(el, note) {
    // Look up position in the exported HANDPAN_MAP
    const pos = HANDPAN_MAP[note];
    if (pos) {
      el.style.left = `${pos.x}%`;
      el.style.top = `${pos.y}%`;
      el.classList.add('active');
    }
  }

  triggerStrike(el, finger = null) {
    el.animate([
      { transform: 'translate(-50%, -50%) scale(1)',   opacity: 1   },
      { transform: 'translate(-50%, -50%) scale(1.3)', opacity: 0.8 },
      { transform: 'translate(-50%, -50%) scale(1)',   opacity: 1   }
    ], { duration: 150, easing: 'ease-out' });

    if (finger) {
      const light = el.querySelector(`.finger-light-${finger}`);
      if (light) {
        light.classList.remove('lit');
        light.getBoundingClientRect(); // force reflow so the animation restarts on repeats
        light.classList.add('lit');
      }
    }
  }

  reset() {
    this.leftHand.classList.remove('active');
    this.rightHand.classList.remove('active');
    // Maybe move to center?
    this.moveHand(this.leftHand, 'D3'); // Center ding if possible, or just hide
    this.moveHand(this.rightHand, 'D3');
  }
}

// Global instance export
export const virtualHands = new VirtualHands();

