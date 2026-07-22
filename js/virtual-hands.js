// virtual-hands.js
// Visualizes hand movements on the virtual handpan
import { getDisplayPosition, resolveTakSlapNote } from './handpanmap.js';
import { resolveHand, addTickObserver } from './noteplayer.js';
import { checkCellIsMultiMode } from './notegrid.js';

const HAND_ICON_ART = {
  'h-left':  { src: './public/assets/images/hand-left.webp',  index: { x: 81, y: 8 },  thumb: { x: 94, y: 54 } },
  'h-right': { src: './public/assets/images/hand-right.webp', index: { x: 21, y: 8 },  thumb: { x: 8,  y: 58 } },
};

// Parking spots used to get a hand out of the other's way during a
// crossing (see anticipate()) — each hand's own side's edge.
const EDGE_X_LEFT = 8;
const EDGE_X_RIGHT = 92;

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

    // Style: illustrated hands (default) or orb markers. Anyone who never
    // touched this setting gets 'hands'; an explicit past choice of 'orbs'
    // is still respected.
    this.style = localStorage.getItem('vHandsStyle') === 'orbs' ? 'orbs' : 'hands';
    this.styleSelect = document.getElementById('vHandsStyleSelect');
    if (this.styleSelect) {
      this.styleSelect.value = this.style;
      this.styleSelect.addEventListener('change', (e) => this.setStyle(e.target.value));
    }
    this.updateStyle();

    this.updateVisibility();

    // Register with NotePlayer
    addTickObserver((ctx) => this.onTick(ctx));

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

  onTick(ctx) {
    // Only visualize for Grid A
    if (ctx.id !== 'A' || !this.enabled) return;

    // --- LOOKAHEAD LOGIC ---
    // Each is a list of the upcoming note(s) for that hand — usually just
    // one, but two when the next hit is a same-hand chord (index + thumb
    // together). Capturing both (not just the first slot found) means the
    // anticipation position below can already park the hand at the correct
    // *merged* spot ahead of time, instead of committing to one note and
    // then visibly jumping to the merged spot the instant the chord plays.
    let nextL = null;
    let nextR = null;

    // True only when nextL and nextR both turned out to be the SAME future
    // step — i.e. the two hands' next notes are genuinely a shared/joint
    // event (a chord split across both hands), not just two independent
    // notes that happen to fall at different, unrelated times. This is what
    // anticipate() uses to decide whether hand-crossing avoidance even
    // applies — see update() and the comment on anticipate() for why plain
    // back-and-forth alternation must NOT go through that logic.
    let sharedNext = false;

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

      // Group hits within THIS step only — two notes only count as a pair
      // to anticipate together if they're actually simultaneous (same
      // future step), never notes from two different upcoming steps. Same
      // {note, finger} shape as the current-step hits below, so both can
      // go through the same resolveTargetPosition() math.
      const stepHitsL = [];
      const stepHitsR = [];
      labels.forEach((lbl, sIdx) => {
        if (!lbl) return;
        const h = resolveHand(futureStep, futureHands, sIdx, isChord, ctx.subdivision);
        const finger = isChord ? (sIdx % 2 === 0 ? 'index' : 'thumb') : null;
        (h === 'L' ? stepHitsL : stepHitsR).push({ note: resolveTakSlapNote(lbl, h), finger });
      });

      if (!nextL && !nextR && stepHitsL.length && stepHitsR.length) {
        // Neither hand has found anything closer yet, and this step has
        // both — a genuine joint event.
        nextL = stepHitsL;
        nextR = stepHitsR;
        sharedNext = true;
      } else {
        if (!nextL && stepHitsL.length) nextL = stepHitsL;
        if (!nextR && stepHitsR.length) nextR = stepHitsR;
      }
    }

    // Which note(s) + finger(s) struck this step, per hand. Only chord/
    // multi-note cells track individual finger slots — lh-index/rh-index
    // are the even slots, lh-thumb/rh-thumb the odd ones (see notegrid.js's
    // sub-dot dataset.idx assignment) — so a hand can have up to 2 entries
    // here (index + thumb fired together, e.g. two adjacent notes played as
    // one chord) or a single entry with finger:null for a plain note.
    const hitsL = [];
    const hitsR = [];
    const currentData = ctx.innerLabels[ctx.step];
    const currentHandsData = ctx.innerHands[ctx.step];

    if (Array.isArray(currentData)) {
      currentData.forEach((label, subIdx) => {
        if (!label) return;
        const hand = resolveHand(ctx.step, currentHandsData, subIdx, true, ctx.subdivision);
        const finger = (subIdx % 2 === 0) ? 'index' : 'thumb';
        (hand === 'L' ? hitsL : hitsR).push({ note: resolveTakSlapNote(label, hand), finger });
      });
    } else if (currentData) {
      const hand = resolveHand(ctx.step, currentHandsData, 0, false, ctx.subdivision);
      (hand === 'L' ? hitsL : hitsR).push({ note: resolveTakSlapNote(currentData, hand), finger: null });
    }

    this.update(hitsL, hitsR, nextL, nextR, sharedNext);
  }

  /**
   * Update hands for the current step.
   * @param {Array<{note:string, finger:string|null}>} hitsL - Left hand's active note(s) this step
   * @param {Array<{note:string, finger:string|null}>} hitsR - Right hand's active note(s) this step
   * @param {Array<{note:string, finger:string|null}>|null} nextL - Left hand's upcoming note(s) (anticipation)
   * @param {Array<{note:string, finger:string|null}>|null} nextR - Right hand's upcoming note(s) (anticipation)
   * @param {boolean} sharedNext - true when nextL/nextR are the SAME upcoming step (a joint chord)
   */
  update(hitsL, hitsR, nextL, nextR, sharedNext) {
    if (!this.overlay || !this.enabled) return;

    // Reset strike states
    this.leftHand.classList.remove('striking');
    this.rightHand.classList.remove('striking');

    // TARGET LOGIC:
    // If active, go to active note(s).
    // If idle, go to next note (anticipation) — already at the correct
    // *merged* spot ahead of time when that's a same-hand chord, so there's
    // no extra jump when it actually strikes.
    // If no next note, stay at last known position (or center?) -> Stay at last active is usually best.
    //
    // Crossing avoidance (anticipate()) only ever applies when sharedNext
    // is true — i.e. both hands' next notes are the SAME upcoming chord.
    // Plain back-and-forth alternation (R, L, R, L, ...) has each hand on
    // its own independent schedule; there's nothing to synchronize with,
    // so a hand must never wait on the other there — it just moves.

    // LEFT HAND
    if (hitsL.length > 0) {
      this.strikeHand(this.leftHand, hitsL);
      this.lastL = hitsL[hitsL.length - 1].note; // Update memory
    } else if (nextL && sharedNext) {
      this.anticipate(this.leftHand, nextL, this.rightHand, nextR, hitsR.length > 0, 'L');
    } else if (nextL) {
      this.positionHand(this.leftHand, this.resolveTargetPosition(this.leftHand, nextL));
    }
    // else: stay put

    // RIGHT HAND
    if (hitsR.length > 0) {
      this.strikeHand(this.rightHand, hitsR);
      this.lastR = hitsR[hitsR.length - 1].note;
    } else if (nextR && sharedNext) {
      this.anticipate(this.rightHand, nextR, this.leftHand, nextL, hitsL.length > 0, 'R');
    } else if (nextR) {
      this.positionHand(this.rightHand, this.resolveTargetPosition(this.rightHand, nextR));
    }
  }

  /**
   * Moves a hand toward its upcoming note(s) during anticipation, but never
   * lets it slide past the OTHER hand's current position — a real player's
   * arms can't cross. Only called when sharedNext is true (see update()) —
   * i.e. this hand's next note and the other hand's next note are the same
   * joint chord, so synchronizing them actually makes sense. If the target
   * would put this hand on the wrong side (left ending up right of right,
   * or right ending up left of left):
   *
   * - If the other hand is CURRENTLY striking a real note this exact tick,
   *   it can't be preemptively yanked off it — that note needs to visually
   *   be played where it actually is. So we just wait: neither hand moves
   *   yet. Once that strike finishes and the other hand is idle too, this
   *   gets re-evaluated next tick and they proceed together (below).
   * - Otherwise (other hand is idle), if we already know its own next
   *   target (otherNextHits — e.g. it's part of the very same upcoming
   *   chord), send it straight there instead of a placeholder.
   * - Only fall back to the edge when the other hand has nothing of its
   *   own coming up at all.
   */
  anticipate(el, hits, otherEl, otherNextHits, otherIsStriking, side) {
    const target = this.resolveTargetPosition(el, hits);
    if (!target) return;

    const otherX = this.getCurrentX(otherEl);
    const crosses = side === 'L' ? target.x > otherX : target.x < otherX;

    if (crosses) {
      if (otherIsStriking) return; // let its real note finish first

      const otherTarget = otherNextHits ? this.resolveTargetPosition(otherEl, otherNextHits) : null;
      if (otherTarget) {
        this.positionHand(otherEl, otherTarget);
      } else {
        const edgeX = side === 'L' ? EDGE_X_RIGHT : EDGE_X_LEFT;
        this.positionHand(otherEl, { x: edgeX, y: this.getCurrentY(otherEl) });
      }
    }

    this.positionHand(el, target);
  }

  getCurrentX(el) {
    const x = parseFloat(el.style.left);
    return Number.isFinite(x) ? x : 50;
  }

  getCurrentY(el) {
    const y = parseFloat(el.style.top);
    return Number.isFinite(y) ? y : 50;
  }

  moveHand(el, note) {
    this.positionHand(el, getDisplayPosition(note));
  }

  positionHand(el, pos) {
    if (!pos) return;
    el.style.left = `${pos.x}%`;
    el.style.top = `${pos.y}%`;
    el.classList.add('active');
  }

  /**
   * Computes the hand-anchor position for 1 or 2 simultaneous note hits.
   * One hit: exactly that note's own position.
   * Two hits (index + thumb of the same hand fired together — e.g. two
   * adjacent notes played as one chord): the hand should look like it's
   * playing both AT ONCE, not sliding between them. So instead of jumping
   * to either note, we solve for the one hand position that puts each
   * fingertip light as close as possible to its own note simultaneously
   * (a least-squares midpoint — see getFingertipOffsetPct for why). Used
   * for both the actual strike and its anticipation, so the hand is
   * already sitting in the right spot before the chord even plays.
   */
  resolveTargetPosition(el, hits) {
    if (hits.length === 1) {
      return getDisplayPosition(hits[0].note) || null;
    }

    const byFinger = {};
    hits.forEach(h => { byFinger[h.finger] = h.note; });
    const posIndex = byFinger.index ? getDisplayPosition(byFinger.index) : null;
    const posThumb = byFinger.thumb ? getDisplayPosition(byFinger.thumb) : null;

    // The fingertip-offset math below measures the (hidden, zero-sized)
    // finger-light elements, which only make sense in 'hands' style — in
    // 'orbs' style there's no per-finger geometry to split the difference
    // between, so just land on one of the two notes.
    if (posIndex && posThumb && this.style === 'hands') {
      const offIndex = this.getFingertipOffsetPct(el, 'index');
      const offThumb = this.getFingertipOffsetPct(el, 'thumb');
      // For each fingertip, "hand position that would land it exactly on
      // its note" is (note - that finger's fixed offset from the hand's
      // own anchor point). With two notes pulling toward two different
      // ideal hand positions, split the difference.
      return {
        x: ((posIndex.x - offIndex.x) + (posThumb.x - offThumb.x)) / 2,
        y: ((posIndex.y - offIndex.y) + (posThumb.y - offThumb.y)) / 2,
      };
    }

    // No per-finger geometry to split between — land on whichever note we
    // do have (shouldn't happen for a real chord, but don't do nothing).
    return getDisplayPosition(hits[hits.length - 1].note) || null;
  }

  /** Positions + pulses a hand for the note(s) it struck this step. */
  strikeHand(el, hits) {
    this.positionHand(el, this.resolveTargetPosition(el, hits));
    this.pulseHand(el);
    hits.forEach(h => { if (h.finger) this.lightFinger(el, h.finger); });
  }

  /**
   * Measures a fingertip light's current position relative to its hand
   * element's own center-anchor, in %-of-layer — the same unit HANDPAN_MAP
   * positions use. Measuring live (rather than recomputing from the CSS
   * that places it) means this stays correct no matter how the hand's own
   * size/margins get tuned in hand-cursors.css.
   */
  getFingertipOffsetPct(el, finger) {
    const light = el.querySelector(`.finger-light-${finger}`);
    if (!light || !this.layer) return { x: 0, y: 0 };

    const layerRect = this.layer.getBoundingClientRect();
    const handRect = el.getBoundingClientRect();
    const lightRect = light.getBoundingClientRect();

    const handCenterX = handRect.left + handRect.width / 2;
    const handCenterY = handRect.top + handRect.height / 2;
    const lightCenterX = lightRect.left + lightRect.width / 2;
    const lightCenterY = lightRect.top + lightRect.height / 2;

    return {
      x: ((lightCenterX - handCenterX) / layerRect.width) * 100,
      y: ((lightCenterY - handCenterY) / layerRect.height) * 100,
    };
  }

  pulseHand(el) {
    el.animate([
      { transform: 'translate(-50%, -50%) scale(1)',   opacity: 1   },
      { transform: 'translate(-50%, -50%) scale(1.3)', opacity: 0.8 },
      { transform: 'translate(-50%, -50%) scale(1)',   opacity: 1   }
    ], { duration: 150, easing: 'ease-out' });
  }

  lightFinger(el, finger) {
    const light = el.querySelector(`.finger-light-${finger}`);
    if (!light) return;
    light.classList.remove('lit');
    light.getBoundingClientRect(); // force reflow so the animation restarts on repeats
    light.classList.add('lit');
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

