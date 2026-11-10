// Mini handpan diagram shown inside multi-note cells (and in the Chords panel and
// stage), so a chord reads as "these spots on the pan". The layout follows the
// player's current handpan: js/handpanmap.js passes its map in whenever the pan is
// rebuilt (setChordShapeLayout). Top-side notes are dots; bottom-side notes are
// arcs on the rim, as on the pan's perimeter view. Tak/Slap aren't shown.

// Until the pan reports its layout: the classic 9-note bronze positions
const FALLBACK_MAP = {
  Ding: { x: 48.1, y: 45.6 },
  '1':  { x: 58.9, y: 75.7 }, '2': { x: 34.4, y: 75.3 },
  '3':  { x: 77.9, y: 59.2 }, '4': { x: 17.9, y: 55.9 },
  '5':  { x: 77.5, y: 34.8 }, '6': { x: 21.1, y: 32.6 },
  '7':  { x: 60,   y: 18.8 }, '8': { x: 38.3, y: 18.6 },
};

const SVG_NS = 'http://www.w3.org/2000/svg';
const ARC_R = 46; // just inside the outline (r 48), like the pan's rim arcs

let layout = null;
let layoutVersion = 0;

function noteRadius(p) {
  return p.r || (p.width ? p.width / 2 : 9);
}

// Same geometry as the pan's perimeter arcs (js/handpanmap.js buildPerimeterSvg):
// x mirrored, since the bottom is seen from below
function arcPath(p) {
  const toRad = d => d * Math.PI / 180;
  const mid = Math.atan2(p.y - 50, (100 - p.x) - 50) * 180 / Math.PI;
  const deg = 2 * Math.asin(Math.min(noteRadius(p) / ARC_R, 1)) * 180 / Math.PI;
  const [a0, a1] = [mid - deg / 2, mid + deg / 2];
  const pt = a => `${(50 + ARC_R * Math.cos(toRad(a))).toFixed(2)} ${(50 + ARC_R * Math.sin(toRad(a))).toFixed(2)}`;
  return `M ${pt(a0)} A ${ARC_R} ${ARC_R} 0 ${deg > 180 ? 1 : 0} 1 ${pt(a1)}`;
}

function buildLayout(map) {
  const dots = [];
  const arcs = [];
  for (const [note, p] of Object.entries(map || {})) {
    if (/^(T|S)_/.test(note) || p == null) continue;
    if (p.side === 'bottom') {
      arcs.push({ note, d: arcPath(p) });
    } else {
      const r = note === 'Ding' ? 12 : Math.min(10, Math.max(6, noteRadius(p)));
      dots.push({ note, x: p.x, y: p.y, r });
    }
  }
  return { dots, arcs };
}

export function setChordShapeLayout(map) {
  layout = buildLayout(map);
  layoutVersion += 1;
}

function currentLayout() {
  return layout || buildLayout(FALLBACK_MAP);
}

function drawNotes(svg) {
  svg.querySelectorAll('.note-dot, .note-arc').forEach(el => el.remove());
  const { dots, arcs } = currentLayout();
  for (const { note, d } of arcs) {
    const arc = document.createElementNS(SVG_NS, 'path');
    arc.setAttribute('class', 'note-arc');
    arc.dataset.note = note;
    arc.setAttribute('d', d);
    svg.appendChild(arc);
  }
  for (const { note, x, y, r } of dots) {
    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('class', 'note-dot');
    dot.dataset.note = note;
    dot.setAttribute('cx', String(x));
    dot.setAttribute('cy', String(y));
    dot.setAttribute('r', String(r));
    svg.appendChild(dot);
  }
  svg.dataset.layoutVersion = String(layoutVersion);
}

function noteKeyForLabel(label) {
  if (label === '0' || label === 'Ding' || label === 'D') return 'Ding';
  return label || null; // only notes on the diagram light up
}

// flat: the standalone variant used by the Chords panel and stage.
export function createChordShapeDiagramEl({ flat = false } = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('class', flat ? 'chord-shape-diagram chord-shape-flat' : 'chord-shape-diagram');

  const outline = document.createElementNS(SVG_NS, 'circle');
  outline.setAttribute('class', 'pan-outline');
  outline.setAttribute('cx', '50');
  outline.setAttribute('cy', '50');
  outline.setAttribute('r', '48');
  svg.appendChild(outline);

  drawNotes(svg);
  return svg;
}

export function updateChordShapeDiagram(svgEl, lbl) {
  if (!svgEl) return;
  // The handpan changed since this diagram was drawn: redraw its notes
  if (svgEl.dataset.layoutVersion !== String(layoutVersion)) drawNotes(svgEl);

  const active = new Set();
  for (const v of (Array.isArray(lbl) ? lbl : [lbl])) {
    const key = noteKeyForLabel(v);
    if (key) active.add(key);
  }

  svgEl.querySelectorAll('.note-dot, .note-arc').forEach((el) => {
    el.classList.toggle('active', active.has(el.dataset.note));
  });
}
