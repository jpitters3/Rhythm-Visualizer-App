// virtual-hands.js
// Visualizes hand movements on the virtual handpan

class VirtualHands {
  constructor(overlayId) {
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

    this.updateVisibility();
  }

  setEnabled(val) {
    this.enabled = val;
    localStorage.setItem('vHandsEnabled', val);
    this.updateVisibility();
  }

  updateVisibility() {
    this.layer.style.display = this.enabled ? 'block' : 'none';
  }

  createHand(type, label) {
    const el = document.createElement('div');
    el.className = `v-hand ${type}`;
    el.textContent = label;
    this.layer.appendChild(el);
    return el;
  }

  /**
   * Update hands for the current step.
   * @param {Array} notes - Active notes triggering a strike
   * @param {Array} hands - Hand assignments for active notes
   * @param {string} nextL - Next target note for Left hand (anticipation)
   * @param {string} nextR - Next target note for Right hand (anticipation)
   */
  update(notes, hands, nextL, nextR) {
    if (!this.overlay || !this.enabled) return;

    // Reset strike states
    this.leftHand.classList.remove('striking');
    this.rightHand.classList.remove('striking');

    // Determine current actions
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
      this.triggerStrike(this.leftHand);
      this.lastL = activeL; // Update memory
    } else if (nextL) {
      // Anticipate
      this.moveHand(this.leftHand, nextL);
    }
    // else: stay put

    // RIGHT HAND
    if (activeR) {
      this.moveHand(this.rightHand, activeR);
      this.triggerStrike(this.rightHand);
      this.lastR = activeR;
    } else if (nextR) {
      this.moveHand(this.rightHand, nextR);
    }
  }

  moveHand(el, note) {
    const pos = window.HANDPAN_MAP[note];
    if (pos) {
      el.style.left = `${pos.x}%`;
      el.style.top = `${pos.y}%`;
      el.classList.add('active');
    }
  }

  triggerStrike(el) {
    requestAnimationFrame(() => {
      el.classList.add('striking');
      setTimeout(() => el.classList.remove('striking'), 150);
    });
  }

  reset() {
    this.leftHand.classList.remove('active');
    this.rightHand.classList.remove('active');
    // Maybe move to center?
    this.moveHand(this.leftHand, 'D3'); // Center ding if possible, or just hide
    this.moveHand(this.rightHand, 'D3');
  }
}

// Global instance
window.virtualHands = new VirtualHands('handpanOverlay');
