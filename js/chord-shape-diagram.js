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
// Named diagrams draw bottom notes as pucks outside the pan, their name inside,
// like the Studio's perimeter view (the svg must allow overflow)
const PUCK_R = 55;

let layout = null;
let layoutVersion = 0;
const labelers = new WeakMap(); // svg -> noteKey => text, for diagrams that name their notes

function noteRadius(p) {
  return p.r || (p.width ? p.width / 2 : 9);
}

// Same geometry as the pan's perimeter arcs (js/handpanmap.js buildPerimeterSvg):
// x mirrored, since the bottom is seen from below. mid is in degrees.
function arcPath({ mid, r }, R) {
  const toRad = d => d * Math.PI / 180;
  const deg = 2 * Math.asin(Math.min(r / R, 1)) * 180 / Math.PI;
  const [a0, a1] = [mid - deg / 2, mid + deg / 2];
  const pt = a => `${(50 + R * Math.cos(toRad(a))).toFixed(2)} ${(50 + R * Math.sin(toRad(a))).toFixed(2)}`;
  return `M ${pt(a0)} A ${R} ${R} 0 ${deg > 180 ? 1 : 0} 1 ${pt(a1)}`;
}

function buildLayout(map) {
  const dots = [];
  const arcs = [];
  for (const [note, p] of Object.entries(map || {})) {
    if (/^(T|S)_/.test(note) || p == null) continue;
    if (p.side === 'bottom') {
      arcs.push({ note, mid: Math.atan2(p.y - 50, (100 - p.x) - 50) * 180 / Math.PI, r: noteRadius(p) });
    } else {
      const r = note === 'Ding' ? 12 : Math.min(10, Math.max(6, noteRadius(p)));
      dots.push({ note, x: p.x, y: p.y, r });
    }
  }
  return { dots, arcs };
}

const layoutListeners = new Set();

export function setChordShapeLayout(map) {
  layout = buildLayout(map);
  layoutVersion += 1;
  layoutListeners.forEach(fn => fn());
}

// Called whenever the pan's layout changes (a new scale or handpan)
export function onChordShapeLayout(fn) {
  layoutListeners.add(fn);
}

function currentLayout() {
  return layout || buildLayout(FALLBACK_MAP);
}

function addLabel(svg, note, x, y, size, onArc) {
  const text = labelers.get(svg)?.(note);
  if (!text) return;
  const el = document.createElementNS(SVG_NS, 'text');
  el.setAttribute('class', onArc ? 'note-label note-label-arc' : 'note-label');
  el.dataset.note = note;
  el.setAttribute('x', x.toFixed(2));
  el.setAttribute('y', y.toFixed(2));
  el.setAttribute('font-size', size.toFixed(2));
  el.setAttribute('text-anchor', 'middle');
  el.setAttribute('dominant-baseline', 'central');
  el.textContent = text;
  svg.appendChild(el);
}

function addArc(svg, note, d, className) {
  const arc = document.createElementNS(SVG_NS, 'path');
  arc.setAttribute('class', className);
  arc.dataset.note = note;
  arc.setAttribute('d', d);
  svg.appendChild(arc);
}

function drawNotes(svg) {
  svg.querySelectorAll('.note-dot, .note-arc, .note-puck-edge, .note-label').forEach(el => el.remove());
  const { dots, arcs } = currentLayout();
  const pucks = labelers.has(svg);
  for (const arc of arcs) {
    if (pucks) {
      const d = arcPath(arc, PUCK_R);
      addArc(svg, arc.note, d, 'note-puck-edge'); // the puck's rim, under its body
      addArc(svg, arc.note, d, 'note-arc note-puck');
    } else {
      addArc(svg, arc.note, arcPath(arc, ARC_R), 'note-arc');
    }
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
  if (pucks) {
    const toRad = d => d * Math.PI / 180;
    for (const { note, mid } of arcs) {
      addLabel(svg, note, 50 + PUCK_R * Math.cos(toRad(mid)), 50 + PUCK_R * Math.sin(toRad(mid)), 3.8, true);
    }
    for (const { note, x, y, r } of dots) addLabel(svg, note, x, y, Math.min(5.2, r * 0.62), false);
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

// Names each note (labeler: noteKey => text, e.g. "C4"); null takes them off
export function setChordShapeLabels(svgEl, labeler) {
  if (labeler) labelers.set(svgEl, labeler);
  else labelers.delete(svgEl);
  drawNotes(svgEl);
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

  svgEl.querySelectorAll('.note-dot, .note-arc, .note-puck-edge, .note-label').forEach((el) => {
    el.classList.toggle('active', active.has(el.dataset.note));
  });
}
