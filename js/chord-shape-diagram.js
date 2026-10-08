// Mini handpan-outline diagram shown inside multi-note cells in place of
// the 4 finger-quadrant dots, so a chord reads as "these spots on the pan"
// instead of "these finger codes". Uses a fixed, generic classic-layout
// position table (not the player's live scale/custom handpan) — see
// js/handpanmap.js HANDPAN_MAP_BRONZE for the source coordinates this was
// copied from. Tak/Slap are intentionally excluded (not pitched notes).
const POSITIONS = {
  Ding: { x: 48.1, y: 45.6 },
  '1':  { x: 58.9, y: 75.7 }, '2': { x: 34.4, y: 75.3 },
  '3':  { x: 77.9, y: 59.2 }, '4': { x: 17.9, y: 55.9 },
  '5':  { x: 77.5, y: 34.8 }, '6': { x: 21.1, y: 32.6 },
  '7':  { x: 60,   y: 18.8 }, '8': { x: 38.3, y: 18.6 },
};

function noteKeyForLabel(label) {
  if (label === '0' || label === 'Ding') return 'Ding';
  if (/^[1-8]$/.test(label || '')) return label;
  return null; // Tak/Slap/empty/ghost — not shown on the diagram
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function createChordShapeDiagramEl() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('class', 'chord-shape-diagram');

  const outline = document.createElementNS(SVG_NS, 'circle');
  outline.setAttribute('class', 'pan-outline');
  outline.setAttribute('cx', '50');
  outline.setAttribute('cy', '50');
  outline.setAttribute('r', '48');
  svg.appendChild(outline);

  for (const [note, pos] of Object.entries(POSITIONS)) {
    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('class', 'note-dot');
    dot.dataset.note = note;
    dot.setAttribute('cx', String(pos.x));
    dot.setAttribute('cy', String(pos.y));
    dot.setAttribute('r', note === 'Ding' ? '12' : '9');
    svg.appendChild(dot);
  }

  return svg;
}

export function updateChordShapeDiagram(svgEl, lbl) {
  if (!svgEl) return;

  const active = new Set();
  if (Array.isArray(lbl)) {
    for (const v of lbl) {
      const key = noteKeyForLabel(v);
      if (key) active.add(key);
    }
  }

  svgEl.querySelectorAll('.note-dot').forEach((dot) => {
    dot.classList.toggle('active', active.has(dot.dataset.note));
  });
}
