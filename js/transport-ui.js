// TransportUI manages a set of transport controls
import { start, stop, getMetronomeSound, setMetronomeSound, getAudioCtx } from './noteplayer.js';
import { Bus, BUS_EVENT } from './bus.js';

export class TransportUI {
  constructor(ctx, container) {
    this.ctx = ctx;
    this.container = container;

    // Elements
    this.playBtn = container.querySelector('.t-play-btn');
    this.metroBtn = container.querySelector('.t-metro-btn');
    this.bpmInput = container.querySelector('.t-bpm-input');
    this.bpmNum = container.querySelector('.t-bpm-num');
    this.tapBtn = container.querySelector('.t-tap-btn');
    this.metroSoundSelect = container.querySelector('.t-metro-sound');
    this.muteBtn = container.querySelector('.t-mute-btn');

    // Tap tempo state
    this.tapTimes = [];

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
      this.metroBtn.onclick = (e) => {
        e.stopPropagation();
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
      };
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
        const val = Math.min(220, Math.max(40, raw));
        this.applyBpm(val, this.bpmNum);
        Bus.emit(BUS_EVENT.GRID_CHANGED);
      };
      this.bpmNum.addEventListener('blur', applyNum);
      this.bpmNum.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); applyNum(); this.bpmNum.blur(); }
      });
    }

    if (this.tapBtn) {
      this.tapBtn.addEventListener('click', () => this.handleTap());
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

    // Register instance
    TransportRegistry.register(this);

    // Initial sync
    this.update();
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
    const clamped = Math.min(220, Math.max(40, bpm));

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
      
      this.metroBtn.style.opacity = isOn ? '1' : '0.5';
      this.metroBtn.title = isOn ? `Metronome: ${sound}` : 'Metronome: Off';
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



