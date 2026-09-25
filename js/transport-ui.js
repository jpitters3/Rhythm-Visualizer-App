// TransportUI manages a set of transport controls
import { start, stop, getMetronomeSound, setMetronomeSound, getAudioCtx, handleBeatsSelectChange, handleSubdivisionSelectChange } from './noteplayer.js';
import { Bus, BUS_EVENT } from './bus.js';

const MOBILE_BREAKPOINT = 768; // matches pattern-crud.js's normalizeMobileSubdivision

function suppressHover(btn) {
  btn.classList.add('no-hover');
  btn.addEventListener('mouseleave', () => btn.classList.remove('no-hover'), { once: true });
}

export class TransportUI {
  constructor(ctx, container) {
    this.ctx = ctx;
    this.container = container;

    // Elements
    this.playBtn = container.querySelector('.t-play-btn');
    this.metroBtn = container.querySelector('.t-metro-btn');
    this.subdivBtn = container.querySelector('.t-subdiv-btn');
    this.bpmInput = container.querySelector('.t-bpm-input');
    this.bpmNum = container.querySelector('.t-bpm-num');
    this.tapBtn = container.querySelector('.t-tap-btn');
    this.countdownBtn = container.querySelector('.t-countdown-btn');
    this.metroSoundSelect = container.querySelector('.t-metro-sound');
    this.muteBtn = container.querySelector('.t-mute-btn');
    this.beatsSelect = container.querySelector('.t-beats-select');
    this.subSelect = container.querySelector('.t-sub-select');
    this.metroDropdown = container.querySelector('.t-metro-dropdown');
    this.metroMenu = container.querySelector('.t-metro-menu');
    this.metroToggleRow = container.querySelector('.t-metro-toggle-row');

    // Tap tempo state
    this.tapTimes = [];

    // One fixed layout per breakpoint, decided once at construction — same
    // convention pattern-crud.js's normalizeMobileSubdivision already uses.
    // Not reactive to resize (nothing else in the app re-layouts transport
    // controls live either).
    this.isMobile = window.innerWidth <= MOBILE_BREAKPOINT;

    // Desktop: .t-subdiv-btn/.t-tap-btn live inline in the bar, exactly as
    // before this feature — the template's default/mobile home for them is
    // inside .t-metro-menu, so move them back out. Mobile leaves them where
    // the template put them (inside the menu), alongside .t-metro-toggle-row.
    if (!this.isMobile) {
      if (this.subdivBtn && this.metroDropdown) this.metroDropdown.after(this.subdivBtn);
      const bpmControl = container.querySelector('.bpm-control');
      if (this.tapBtn && bpmControl) bpmControl.after(this.tapBtn);
      this.metroToggleRow?.remove();
      this.metroToggleRow = null;
    } else if (this.metroMenu) {
      // Move the menu out to <body> rather than leaving it nested inside
      // .t-metro-dropdown. Two reasons: .transport-container clips overflow
      // on mobile (an absolutely-positioned child would be invisible), and
      // .controls-transport (an ancestor, position:fixed) turns out to act
      // as the containing block for nested position:fixed elements too —
      // confirmed empirically, not just the overflow issue — so a fixed
      // child positioned "under the button" would anchor to that ancestor's
      // box instead of the viewport. Living directly under <body> sidesteps
      // both. this.metroMenu / this.metroToggleRow / etc. stay valid
      // references regardless of where the node currently lives.
      document.body.appendChild(this.metroMenu);
    }

    this.init();
  }

  init() {
    if (this.playBtn) {
      this.playBtn.onclick = (e) => {
        e.stopPropagation();
        if (this.ctx.playing) {
          stop(this.ctx);
        } else {
          // Safari requires AudioContext.resume() to be called synchronously
          // within a user gesture. Any await before resume() loses the activation
          // context, leaving the AudioContext suspended and producing no sound.
          getAudioCtx()?.resume().catch(() => {});
          start(this.ctx);
        }
        TransportRegistry.updateAll(this.ctx);
      };
    }

    if (this.metroBtn) {
      if (this.isMobile) {
        // Mobile: tapping the bell opens the submenu instead of toggling
        // directly — the toggle itself is .t-metro-toggle-row, inside it.
        // The menu is positioned fixed + placed here in JS rather than via
        // .t-metro-dropdown's normal position:relative/absolute anchor,
        // because .transport-container clips overflow on mobile (needed to
        // keep the compact button row from spilling out) — an absolutely
        // positioned child would be invisibly clipped by that ancestor.
        this.metroBtn.onclick = (e) => {
          e.stopPropagation();
          if (this.metroMenu?.classList.contains('show')) {
            this.metroMenu.classList.remove('show');
          } else {
            this.positionMobileMetroMenu();
            this.metroMenu?.classList.add('show');
          }
        };
        // pointerdown, capture phase — not 'click', not bubble. Two separate
        // reasons, both needed:
        // 1. Several other transport buttons (play, countdown, subdiv, mute)
        //    call e.stopPropagation() in their own click handlers, which
        //    would stop a bubble-phase document listener from ever seeing
        //    clicks on them. Capture runs before any of that.
        // 2. The handpan itself — the single most likely "tap elsewhere" —
        //    calls preventDefault() on touchstart specifically to suppress
        //    the follow-up synthetic click on real touch devices (see
        //    js/handpanmap.js's "suppress follow-up click so single taps
        //    don't double-fire"). A 'click' listener would simply never fire
        //    for a tap there at all. pointerdown always fires first,
        //    regardless of what anything does with preventDefault() after.
        document.addEventListener('pointerdown', (e) => {
          // .metroMenu now lives under <body>, not inside .metroDropdown
          // (see the constructor) — a click has to miss both to count as
          // "outside."
          if (
            this.metroMenu?.classList.contains('show') &&
            !this.metroDropdown.contains(e.target) &&
            !this.metroMenu.contains(e.target)
          ) {
            this.metroMenu.classList.remove('show');
          }
        }, true);
      } else {
        this.metroBtn.onclick = (e) => this.toggleMetronome(e);
      }
    }

    if (this.metroToggleRow) {
      this.metroToggleRow.onclick = (e) => this.toggleMetronome(e);
    }

    if (this.bpmInput) {
      this.bpmInput.oninput = (e) => {
        const val = parseInt(e.target.value);
        this.applyBpm(val, e.target);
      };
      this.bpmInput.onchange = () => {
        Bus.emit(BUS_EVENT.GRID_CHANGED);
      };
    }

    if (this.bpmNum) {
      const applyNum = () => {
        const raw = parseInt(this.bpmNum.value);
        if (isNaN(raw)) { this.bpmNum.value = this.ctx.bpm; return; }
        const val = Math.min(400, Math.max(40, raw));
        this.applyBpm(val, this.bpmNum);
        Bus.emit(BUS_EVENT.GRID_CHANGED);
      };
      this.bpmNum.addEventListener('focus', () => setTimeout(() => this.bpmNum.select(), 0));
      this.bpmNum.addEventListener('mousedown', () => {
        if (document.activeElement === this.bpmNum) setTimeout(() => this.bpmNum.select(), 0);
      });
      this.bpmNum.addEventListener('blur', applyNum);
      this.bpmNum.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); applyNum(); this.bpmNum.blur(); }
      });
    }

    if (this.tapBtn) {
      this.tapBtn.addEventListener('click', () => this.handleTap());
    }

    if (this.countdownBtn) {
      this.countdownBtn.onclick = (e) => {
        e.stopPropagation();
        this.ctx.countdownEnabled = !this.ctx.countdownEnabled;
        localStorage.setItem('groovepan_countdown-' + this.ctx.id, this.ctx.countdownEnabled ? 'on' : 'off');
        TransportRegistry.updateAll(this.ctx);
        e.currentTarget.blur();
        if (!this.ctx.countdownEnabled) suppressHover(e.currentTarget);
      };
    }

    if (this.subdivBtn) {
      this.subdivBtn.onclick = (e) => {
        e.stopPropagation();
        this.ctx.metronomeSubdiv = !this.ctx.metronomeSubdiv;
        localStorage.setItem('groovepan_metro_subdiv-' + this.ctx.id, this.ctx.metronomeSubdiv ? 'on' : 'off');
        TransportRegistry.updateAll(this.ctx);
        e.currentTarget.blur();
        if (!this.ctx.metronomeSubdiv) suppressHover(e.currentTarget);
      };
    }

    if (this.metroSoundSelect) {
      this.metroSoundSelect.value = getMetronomeSound();
      this.metroSoundSelect.onchange = (e) => {
        setMetronomeSound(e.target.value);
        TransportRegistry.updateAll(this.ctx);
      };
    }

    if (this.muteBtn) {
      this.muteBtn.onclick = (e) => {
        e.stopPropagation();
        this.ctx.isMuted = !this.ctx.isMuted;
        TransportRegistry.updateAll(this.ctx);
      };
    }

    if (this.beatsSelect) {
      this.beatsSelect.onchange = (e) => {
        handleBeatsSelectChange(e.target.value, this.ctx);
      };
    }

    if (this.subSelect) {
      this.subSelect.onchange = (e) => {
        handleSubdivisionSelectChange(e.target.value, this.ctx, e.target);
      };
    }

    // Register instance
    TransportRegistry.register(this);

    // Initial sync
    this.update();
  }

  positionMobileMetroMenu() {
    if (!this.metroMenu || !this.metroBtn) return;
    const rect = this.metroBtn.getBoundingClientRect();
    // Fixed to the viewport, anchored ABOVE the bell button — the mobile
    // transport bar sits flush against the bottom of the screen
    // (.controls-transport { position:fixed; bottom:0 }), so opening
    // downward (like #handpanOptionsMenu, whose trigger sits well above the
    // bottom edge) would push the menu off-screen. Anchoring from `bottom`
    // instead of computing `top: rect.top - menuHeight` means it grows
    // upward correctly regardless of the menu's actual (possibly
    // not-yet-rendered) height.
    // .dropdown-content's base rule (css/layout.css) sets top:100% — an
    // empty string only clears the *inline* style, falling back to that
    // stylesheet value (100% of the fixed containing block's height =
    // viewport height), not to "unset". Need the explicit 'auto' keyword to
    // actually cancel it so `bottom` alone determines the box's position.
    this.metroMenu.style.position = 'fixed';
    this.metroMenu.style.top = 'auto';
    this.metroMenu.style.bottom = `${window.innerHeight - rect.top + 8}px`;
    this.metroMenu.style.left = `${rect.left}px`;
  }

  toggleMetronome(e) {
    e?.stopPropagation();
    const currentSound = getMetronomeSound();
    if (!this.ctx.metronomeOn) {
      this.ctx.metronomeOn = true;
      setMetronomeSound('Click');
    } else if (currentSound === 'Click') {
      setMetronomeSound('Shaker');
    } else {
      this.ctx.metronomeOn = false;
    }
    localStorage.setItem('groovepan_metro' + '-' + this.ctx.id, this.ctx.metronomeOn ? 'on' : 'off');
    TransportRegistry.updateAll(this.ctx);
    if (e?.currentTarget) {
      e.currentTarget.blur();
      if (!this.ctx.metronomeOn) suppressHover(e.currentTarget);
    }
    if (this.isMobile) this.metroMenu?.classList.remove('show');
  }

  applyBpm(val, source) {
    this.ctx.bpm = val;
    // Sync real BPM input if this is a proxy
    const realInput = document.getElementById(`bpmInput-${this.ctx.id}`);
    if (realInput && realInput !== source) realInput.value = val;
    TransportRegistry.updateAll(this.ctx);
  }

  handleTap() {
    const now = Date.now();
    // Reset if last tap was more than 3 seconds ago
    if (this.tapTimes.length > 0 && now - this.tapTimes[this.tapTimes.length - 1] > 3000) {
      this.tapTimes = [];
    }
    this.tapTimes.push(now);

    // Need at least 2 taps to calculate
    if (this.tapTimes.length < 2) return;

    // Keep only the last 8 taps for a rolling average
    if (this.tapTimes.length > 8) this.tapTimes.shift();

    const intervals = [];
    for (let i = 1; i < this.tapTimes.length; i++) {
      intervals.push(this.tapTimes[i] - this.tapTimes[i - 1]);
    }
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const bpm = Math.round(60000 / avg);
    const clamped = Math.min(400, Math.max(40, bpm));

    this.applyBpm(clamped, null);
    Bus.emit(BUS_EVENT.GRID_CHANGED);

    // Flash the tap button to give feedback
    this.tapBtn.classList.add('tapping');
    clearTimeout(this.tapFlashTimer);
    this.tapFlashTimer = setTimeout(() => this.tapBtn.classList.remove('tapping'), 120);
  }

  update() {
    if (this.playBtn) {
      const isPlaying = this.ctx.playing;
      this.playBtn.textContent = isPlaying ? '⏹' : '►';
      this.playBtn.classList.toggle('active', isPlaying);
      this.playBtn.classList.toggle('playing', isPlaying);
    }

    if (this.metroBtn) {
      const isOn = this.ctx.metronomeOn;
      const sound = getMetronomeSound();
      
      this.metroBtn.classList.toggle('active', isOn);
      this.metroBtn.classList.toggle('metro-beeps', isOn && sound === 'Click');
      this.metroBtn.classList.toggle('metro-shaker', isOn && sound === 'Shaker');
      if (isOn) this.metroBtn.classList.remove('no-hover');
      this.metroBtn.style.opacity = isOn ? '1' : '0.5';
      this.metroBtn.title = isOn ? `Metronome: ${sound}` : 'Metronome: Off';
    }

    if (this.metroToggleRow) {
      const isOn = this.ctx.metronomeOn;
      const sound = getMetronomeSound();
      this.metroToggleRow.textContent = isOn ? `🔔 Metronome: ${sound}` : '🔔 Metronome: Off';
      this.metroToggleRow.classList.toggle('active', isOn);
    }

    if (this.beatsSelect) {
      this.beatsSelect.value = this.ctx.beats;
    }

    if (this.subSelect) {
      this.subSelect.value = this.ctx.subdivision;
    }

    if (this.subdivBtn) {
      const isOn = this.ctx.metronomeSubdiv;
      this.subdivBtn.classList.toggle('active', isOn);
      if (isOn) this.subdivBtn.classList.remove('no-hover');
      this.subdivBtn.style.opacity = isOn ? '1' : '0.5';
      this.subdivBtn.title = isOn ? 'Subdivision clicks: On' : 'Subdivision clicks: Off';
    }

    if (this.countdownBtn) {
      const isOn = this.ctx.countdownEnabled;
      this.countdownBtn.classList.toggle('active', isOn);
      if (isOn) this.countdownBtn.classList.remove('no-hover');
      this.countdownBtn.style.opacity = '';
      this.countdownBtn.title = isOn ? 'Count-in: On' : 'Count-in: Off';
    }

    if (this.bpmInput) {
      this.bpmInput.value = this.ctx.bpm;
    }

    if (this.bpmNum && document.activeElement !== this.bpmNum) {
      this.bpmNum.value = this.ctx.bpm;
    }

    if (this.metroSoundSelect) {
      this.metroSoundSelect.value = getMetronomeSound();
    }

    if (this.muteBtn) {
      this.muteBtn.textContent = this.ctx.isMuted ? '🔇' : '🔊';
      this.muteBtn.classList.toggle('muted', this.ctx.isMuted);
    }
  }
}

/**
 * TransportRegistry tracks all TransportUI instances and allows broadcasting updates.
 */
export const TransportRegistry = {
  instances: [],
  register(instance) {
    this.instances.push(instance);
  },
  updateAll(ctx) {
    this.instances
      .filter(inst => inst.ctx === ctx)
      .forEach(inst => inst.update());
  }
};



