// Synthetic handpan recordings for Chord listen tests, fed to Chromium's fake
// mic (--use-file-for-fake-audio-capture). Deterministic: claps use seeded noise.
const fs = require('fs');
const os = require('os');
const path = require('path');

const SR = 48000;
const FREQ = {
  D3: 146.83, A3: 220.0, Bb3: 233.08, C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0,
};

function track(seconds) {
  return new Float32Array(Math.ceil(SR * seconds));
}

// A struck pan note: quick attack, long decay, a little octave
function note(buf, t, name, amp = 0.35) {
  const f = FREQ[name];
  const start = Math.round(t * SR);
  for (let i = 0; i < SR * 2.2 && start + i < buf.length; i++) {
    const x = i / SR;
    const env = Math.exp(-x * 2.2) * Math.min(1, x / 0.004);
    buf[start + i] += amp * env * (Math.sin(2 * Math.PI * f * x) + 0.3 * Math.sin(4 * Math.PI * f * x) + 0.1 * Math.sin(6 * Math.PI * f * x));
  }
}

// A plain tone with its own fade-in and decay (for octave "blooms")
function tone(buf, t, freq, amp, fadeIn, decay) {
  const start = Math.round(t * SR);
  for (let i = 0; i < SR * 2.5 && start + i < buf.length; i++) {
    const x = i / SR;
    buf[start + i] += amp * Math.min(1, x / fadeIn) * Math.exp(-x * decay) * Math.sin(2 * Math.PI * freq * x);
  }
}

let seed = 1;
function noise() {
  seed = (seed * 16807) % 2147483647;
  return seed / 1073741823.5 - 1;
}

// A hand clap: a short, bright burst of noise
function clap(buf, t, amp = 0.7) {
  const start = Math.round(t * SR);
  let prev = 0;
  for (let i = 0; i < SR * 0.08; i++) {
    const r = noise();
    buf[start + i] += amp * Math.exp(-(i / SR) * 60) * (r - prev);
    prev = r;
  }
}

function writeWav(buf, file) {
  let peak = 0;
  for (const v of buf) peak = Math.max(peak, Math.abs(v));
  const scale = peak ? 0.9 / peak : 0;
  const data = Buffer.alloc(44 + buf.length * 2);
  data.write('RIFF', 0);
  data.writeUInt32LE(36 + buf.length * 2, 4);
  data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(SR, 24);
  data.writeUInt32LE(SR * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(buf.length * 2, 40);
  buf.forEach((v, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v * scale)) * 32767), 44 + i * 2));
  fs.writeFileSync(file, data);
  return file;
}

const DIR = path.join(os.tmpdir(), 'panafide-listen-audio');
const CHORDS = [['A3', 'D4', 'F4'], ['C4', 'E4', 'G4'], ['Bb3', 'D4', 'F4']]; // Dm C Bb

// Each recording, by name: written once per run, path returned
const RECORDINGS = {
  // Dm, C, Bb played note by note with a clap after each; a double clap; then
  // the progression twice at `bpm`, `beatsPerChord` beats a chord
  // (capture: 0 leaves out the note-by-note part and the claps)
  session({ bpm = 90, beatsPerChord = 4, reps = 2, capture = 1 } = {}) {
    const beat = 60 / bpm;
    const buf = track(1 + (capture ? 3 * 3.1 + 2 : 0) + reps * 3 * beatsPerChord * beat + 2);
    seed = 1;
    let t = 1;
    if (capture) {
      CHORDS.forEach((chord, i) => {
        chord.forEach((n) => { note(buf, t, n); t += 0.7; });
        t += 0.6;
        clap(buf, t);
        t += i < 2 ? 1.6 : 0.35;
      });
      clap(buf, t);
      t += 1.5;
    }
    for (let r = 0; r < reps; r++) {
      CHORDS.forEach((chord) => {
        for (let b = 0; b < beatsPerChord; b++) { note(buf, t, chord[b % 3], 0.3); t += beat; }
      });
    }
    return buf;
  },
  // D3, A3, F4, each followed by its octave swelling in softly, as a pan's does
  bloom() {
    const buf = track(9);
    [[1, 146.83], [3, 220], [5, 349.23]].forEach(([t, f]) => {
      tone(buf, t, f, 0.8, 0.004, 2.5);
      tone(buf, t + 0.35, 2 * f, 0.9, 0.25, 1.2);
    });
    return buf;
  },
  // E4 struck three times, a little over a second apart
  threeStrikes() {
    const buf = track(9);
    [2.5, 3.7, 4.9].forEach(t => note(buf, t, 'E4'));
    return buf;
  },
  silence() {
    return track(60);
  },
};

// Workers load specs in parallel: each file is written once, atomically, and the
// same options always make the same file (`copy` just gives a test its own)
function recording(name, options = {}) {
  fs.mkdirSync(DIR, { recursive: true });
  const key = `${name}${Object.entries(options).map(([k, v]) => `-${k}${v}`).join('')}`;
  const file = path.join(DIR, `${key}.wav`);
  if (fs.existsSync(file)) return file;
  const shape = { ...options };
  delete shape.copy; // only names the file
  const temp = `${file}.${process.pid}.tmp`;
  writeWav(RECORDINGS[name](shape), temp);
  fs.renameSync(temp, file);
  return file;
}

// Launch options that make Chromium's mic play the recording once
function fakeMic(file) {
  return {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${file}%noloop`],
  };
}

module.exports = { recording, fakeMic };
