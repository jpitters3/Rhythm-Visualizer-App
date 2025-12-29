/* Includes scale selector */

/* Perfectly mapped to nine-note-handpan-numbered.png */
const HANDPAN_MAP = {
  D: { x: 50.3, y: 47, r: 12 },
  1: { x: 63, y: 78.3, r: 12 },
  2: { x: 33.5, y: 76.3, r: 12 },
  3: { x: 81.2, y: 58, r: 11 },
  4: { x: 17.8, y: 54.7, r: 11 },
  5: { x: 79, y: 33, r: 10 },
  6: { x: 21.3, y: 30.3, r: 10 },
  7: { x: 61.2, y: 16, r: 9 },
  8: { x: 38.2, y: 15.3, r: 9 },
};

const handpanOverlay = document.getElementById('handpanOverlay');
const handpanDots = new Map();

function buildHandpanOverlay(){
  if (!handpanOverlay) return;
  handpanOverlay.innerHTML = '';
  handpanDots.clear();

  for (const [note, p] of Object.entries(HANDPAN_MAP)) {
    const dot = document.createElement('div');
    dot.className = 'hp-dot';
    dot.dataset.note = note;

    dot.style.left = `${p.x}%`;
    dot.style.top  = `${p.y}%`;
    dot.style.width  = `${p.r * 2}%`;
    dot.style.height = `${p.r * 2}%`;
    dot.style.transform = 'translate(-50%, -50%)';

    handpanOverlay.appendChild(dot);
    handpanDots.set(note, dot);
  }
}

buildHandpanOverlay();

let hpPulseTimers = new Map();

function highlightHandpan(note, stepIndex){
  const key = String(note || '').toUpperCase();
  const el = handpanDots.get(key);
  if (!el) return;

  const down = isDownbeatStep(stepIndex);

  el.classList.remove('hp-down','hp-up','active');
  el.classList.add(down ? 'hp-down' : 'hp-up');

  // restart animation
  void el.offsetWidth;
  el.classList.add('active');

  // per-note timer so multiple notes in a row don't fight
  clearTimeout(hpPulseTimers.get(key));
  hpPulseTimers.set(key, setTimeout(() => {
    el.classList.remove('active');
  }, Math.min(220, intervalMs() * 0.9)));
}

/* Calibration */
const calBtn = document.getElementById('calBtn');
let calibrating = false;
let selectedHpNote = null;

function setCalibrating(on) {
  calibrating = on;
  document.body.classList.toggle('calibrating', on);
  if (calBtn) calBtn.classList.toggle('active', on);
  if (calBtn) calBtn.textContent = on ? 'Calibrating…' : 'Calibrate Map';

  // Clear selection when exiting
  if (!on) {
    selectedHpNote = null;
    for (const el of handpanDots.values()) el.classList.remove('selected');
  }
}

calBtn?.addEventListener('click', () => setCalibrating(!calibrating));

function selectHpDot(note) {
  selectedHpNote = note;
  for (const [k, el] of handpanDots.entries()) {
    el.classList.toggle('selected', k === note);
  }
}

// Click-to-select dots
handpanOverlay?.addEventListener('click', (e) => {
  if (calibrating) {
    const dot = e.target.closest('.hp-dot');
    if (!dot) return;
    const note = dot.dataset.note;
    if (!note || !HANDPAN_MAP[note]) return;
    selectHpDot(note);

  } else {
    // Play notes like a virtual handpan
    const dot = e.target.closest('.hp-dot');
    if (!dot) return;

    const note = dot.dataset.note;
    if (!note) return;

    // If not composing and nothing selected, we can still play sounds.
    // If a beat is selected, write to it.

    // Play note sound on click / tap
    playNoteByLabel(note, step); 
    highlightHandpan(note, step);

    // If a beat is selected, write to it (Compose auto-advance applies)
    if (selectedIndex !== null) {
      // Alt click means "don’t advance"
      const noAdvance = e.altKey; // Alt = write without advancing
      writeToSelected(note, { advance: !noAdvance });
      // if (composeOn && !noAdvance) advanceSelection(1);
    }
  }
});

// Nudge with arrow keys
document.addEventListener('keydown', (e) => {
  if (!calibrating) return;

  // Esc exits calibration
  if (e.key === 'Escape') {
    setCalibrating(false);
    return;
  }

  // C prints current map
  if (e.key.toLowerCase() === 'c') {
    e.preventDefault();
    console.log('HANDPAN_MAP =', JSON.parse(JSON.stringify(HANDPAN_MAP)));
    console.log('Copy/paste version:\n' + stringifyHandpanMap(HANDPAN_MAP));
    return;
  }

  if (!selectedHpNote) return;

  const step = e.shiftKey ? 0.5 : 0.2; // percent increments
  let dx = 0, dy = 0;

  if (e.key === 'ArrowLeft')  dx = -step;
  if (e.key === 'ArrowRight') dx =  step;
  if (e.key === 'ArrowUp')    dy = -step;
  if (e.key === 'ArrowDown')  dy =  step;

  if (!dx && !dy) return;

  e.preventDefault();

  const p = HANDPAN_MAP[selectedHpNote];
  p.x = clamp(p.x + dx, 0, 100);
  p.y = clamp(p.y + dy, 0, 100);

  // Update DOM position live
  const el = handpanDots.get(selectedHpNote);
  if (el) {
    el.style.left = `${p.x}%`;
    el.style.top  = `${p.y}%`;
  }
});

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function stringifyHandpanMap(map) {
  const keys = Object.keys(map).sort((a,b) => {
    if (a === 'D') return -1;
    if (b === 'D') return 1;
    return Number(a) - Number(b);
  });

  const lines = keys.map(k => {
    const p = map[k];
    // keep tidy rounding so your file stays clean
    const x = Number(p.x.toFixed(1));
    const y = Number(p.y.toFixed(1));
    const r = Number(p.r.toFixed(1));
    return `  ${JSON.stringify(k)}: { x: ${x}, y: ${y}, r: ${r} },`;
  });

  return `const HANDPAN_MAP = {\n${lines.join('\n')}\n};`;
}

// Event handlers

scaleSelect.addEventListener('change', async () => {
  selectedScaleName = scaleSelect.value;
  scaleStatus.textContent = `Scale: ${selectedScaleName}`;
  saveScaleLocal(selectedScaleName);
  await preloadScaleSamples();
  if (currentUser) await saveScaleRemote(selectedScaleName);
});
