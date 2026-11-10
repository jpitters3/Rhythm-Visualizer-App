/* Notation guides: a soft highlight behind the selected step (label + cell), its
   note outlined on the pan, and a dismissable legend/hint on the first measure header. */
import { Bus, BUS_EVENT } from './bus.js';
import { gridA } from './grid-context.js';
import { markStepNotes } from './handpanmap.js';

const LEGEND_KEY = 'gp_notationLegendDismissed';
const PAD = 4; // highlight reaches this far past the label and cell

let measuresEl;
let highlightEl;
let queued = false;

function selectedCell() {
  if (document.body.classList.contains('present')) return null;
  return measuresEl.querySelector('.cell.selected');
}

function placeHighlight(cell) {
  const row = cell?.closest('.measure-row');
  if (!row) {
    highlightEl?.remove();
    return;
  }
  if (!highlightEl) {
    highlightEl = document.createElement('div');
    highlightEl.className = 'step-highlight';
    highlightEl.setAttribute('aria-hidden', 'true');
  }
  if (highlightEl.parentElement !== row) row.prepend(highlightEl);

  // The labels strip right above this cell's line of cells
  const labels = cell.parentElement?.previousElementSibling;
  const r = row.getBoundingClientRect();
  const c = cell.getBoundingClientRect();
  const top = labels?.classList.contains('labels') ? labels.getBoundingClientRect().top : c.top;
  highlightEl.style.left = `${c.left - r.left - PAD}px`;
  highlightEl.style.top = `${top - r.top - PAD}px`;
  highlightEl.style.width = `${c.width + PAD * 2}px`;
  highlightEl.style.height = `${c.bottom - top + PAD * 2}px`;
}

function update() {
  queued = false;
  const cell = selectedCell();
  placeHighlight(cell);
  const step = cell ? Number(cell.dataset.index) : null;
  markStepNotes(step === null ? null : gridA.innerLabels?.[step], step);
}

function queueUpdate() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(update);
}

// ── Legend / hint on the first measure header ──
function legendDismissed() {
  try { return localStorage.getItem(LEGEND_KEY) === '1'; } catch { return false; }
}

function gridIsEmpty() {
  return !(gridA.innerLabels || []).some(l => (Array.isArray(l) ? l.some(Boolean) : l));
}

function renderLegend() {
  const header = measuresEl.querySelector('.measure-row .measure-header');
  if (!header || legendDismissed() || document.body.classList.contains('present')) return;
  let legend = header.querySelector('.notation-legend');
  if (!legend) {
    legend = document.createElement('span');
    legend.className = 'notation-legend';
    header.appendChild(legend);
  }
  const empty = gridIsEmpty();
  if (legend.dataset.mode === (empty ? 'hint' : 'legend')) return;
  legend.dataset.mode = empty ? 'hint' : 'legend';
  legend.innerHTML = empty
    ? '<span class="notation-legend-hint">Tap a step, then play a note</span>'
    : '<span class="nl-key nl-left">Left</span><span class="nl-key nl-right">Right</span><span class="nl-key nl-ghost">Ghost</span>';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'notation-legend-close';
  close.setAttribute('aria-label', 'Hide this guide');
  close.textContent = '✕';
  close.addEventListener('click', (e) => {
    e.stopPropagation();
    try { localStorage.setItem(LEGEND_KEY, '1'); } catch { /* private mode */ }
    legend.remove();
  });
  legend.appendChild(close);
}

export function initNotationGuides() {
  measuresEl = document.getElementById('measures');
  if (!measuresEl) return;
  Bus.on(BUS_EVENT.CARET_CHANGED, queueUpdate);
  Bus.on(BUS_EVENT.CELL_CLICKED, queueUpdate);
  Bus.on(BUS_EVENT.GRID_CHANGED, () => { queueUpdate(); renderLegend(); });
  Bus.on(BUS_EVENT.GRID_RENDERED, (e) => {
    if (e.detail?.gridId && e.detail.gridId !== 'A') return;
    queueUpdate();
    renderLegend();
  });
  // Zoom, divider drags and rotation move the cell under the highlight
  if ('ResizeObserver' in window) new ResizeObserver(queueUpdate).observe(measuresEl);
  addEventListener('resize', queueUpdate);
  // Scale or label changes rebuild the pan's dots, dropping the outline
  const overlay = document.getElementById('handpanOverlay');
  if (overlay) new MutationObserver(queueUpdate).observe(overlay, { childList: true });
  renderLegend();
}
