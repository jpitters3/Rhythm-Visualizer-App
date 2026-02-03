/**
 * TransportUI manages a set of transport controls (Play, Metronome, BPM).
 * It binds a GridContext to a DOM container and keeps them in sync.
 */
import { start, stop } from './noteplayer.js';

export class TransportUI {
  constructor(ctx, container) {
    this.ctx = ctx;
    this.container = container;

    // Elements
    this.playBtn = container.querySelector('.t-play-btn');
    this.metroBtn = container.querySelector('.t-metro-btn');
    this.bpmInput = container.querySelector('.t-bpm-input');
    this.bpmVal = container.querySelector('.t-bpm-val');
    this.muteBtn = container.querySelector('.t-mute-btn');

    this.init();
  }

  init() {
    if (this.playBtn) {
      this.playBtn.onclick = (e) => {
        e.stopPropagation();
        if (this.ctx.playing) {
          stop(this.ctx);
        } else {
          start(this.ctx);
        }
        TransportRegistry.updateAll(this.ctx);
      };
    }

    if (this.metroBtn) {
      this.metroBtn.onclick = (e) => {
        e.stopPropagation();
        this.ctx.metronomeOn = !this.ctx.metronomeOn;
        TransportRegistry.updateAll(this.ctx);
      };
    }

    if (this.bpmInput) {
      this.bpmInput.oninput = (e) => {
        const val = parseInt(e.target.value);
        this.ctx.bpm = val;
        // Sync real BPM input if this is a proxy
        const realInput = document.getElementById(`bpmInput-${this.ctx.id}`);
        if (realInput && realInput !== this.bpmInput) {
          realInput.value = val;
        }
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

    // Register instance
    TransportRegistry.register(this);

    // Initial sync
    this.update();
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
      this.metroBtn.classList.toggle('active', isOn);
      this.metroBtn.style.opacity = isOn ? '1' : '0.5';
    }

    if (this.bpmInput) {
      this.bpmInput.value = this.ctx.bpm;
    }

    if (this.bpmVal) {
      this.bpmVal.textContent = this.ctx.bpm;
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


window.TransportRegistry = TransportRegistry;
window.TransportUI = TransportUI;

// Legacy global found in init.js assertion
window.metroClick = function (ctx) {
  const c = ctx || (window.activeGrid || window.gridA);
  if (!c) return;
  c.metronomeOn = !c.metronomeOn;
  TransportRegistry.updateAll(c);
};
