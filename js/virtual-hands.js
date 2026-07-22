// virtual-hands.js
// Visualizes hand movements on the virtual handpan
import { HANDPAN_MAP } from './handpanmap.js';
import { resolveHand, addTickObserver } from './noteplayer.js';
import { checkCellIsMultiMode } from './notegrid.js';

// Real illustrated hand art (the same back-of-hand images already used for
// Split Mode's per-cell icons — see css/hand-icons.css) instead of a
// hand-authored SVG silhouette. The index/thumb fingertip coordinates below
// were measured directly off each 200x200 image (as % of width/height) so
// the finger-light overlay lands precisely on the right digit; the two
// images aren't a perfect mirror of each other, so each gets its own pair.
const HAND_ICON_ART = {
  'h-left':  { src: './public/assets/images/hand-left.webp',  index: { x: 81, y: 8 },  thumb: { x: 94, y: 54 } },
  'h-right': { src: './public/assets/images/hand-right.webp', index: { x: 21, y: 8 },  thumb: { x: 8,  y: 58 } },
};

function handIconHtml(type) {
  const art = HAND_ICON_ART[type];
  return `
    <div class="hand-icon">
      <img class="hand-icon-img" src="${art.src}" alt="" draggable="false" />
      <span class="finger-light finger-light-index" style="left:${art.index.x}%; top:${art.index.y}%;"></span>
      <span class="finger-light finger-light-thumb" style="left:${art.thumb.x}%; top:${art.thumb.y}%;"></span>
    </div>
  `;
}

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

    el.insertAdjacentHTML('beforeend', handIconHtml(type));

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

