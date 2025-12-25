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

let hpPulseTimer = null;

function highlightHandpan(note){
  const key = String(note || '').toUpperCase();
  const el = handpanDots.get(key);
  if (!el) return;

  // reset animation cleanly
  el.classList.remove('active');
  void el.offsetWidth; // reflow to restart animation
  el.classList.add('active');

  // fade it back out after a beat tick
  clearTimeout(hpPulseTimer);
  hpPulseTimer = setTimeout(() => {
    el.classList.remove('active');
  }, Math.min(220, intervalMs() * 0.9));
}