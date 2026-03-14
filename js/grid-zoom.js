/**
 * grid-zoom.js
 *
 * Manages the zoom level for the #measures grid.
 * Persistence: localStorage ('groovepan_grid_zoom')
 */

let currentZoom = 100;

export function initGridZoom() {
  const measuresEl = document.getElementById('measures');
  const zoomInBtn = document.getElementById('zoomInBtn');
  const zoomOutBtn = document.getElementById('zoomOutBtn');

  if (!measuresEl) return;

  // 1. Load from localStorage
  const saved = localStorage.getItem('groovepan_grid_zoom');
  if (saved) {
    currentZoom = parseInt(saved, 10) || 100;
  }

  // 2. Initial Apply
  applyZoom(measuresEl);

  // 3. Event Listeners
  if (zoomInBtn) {
    zoomInBtn.addEventListener('click', () => {
      currentZoom = Math.min(200, currentZoom + 5);
      applyZoom(measuresEl);
    });
  }

  if (zoomOutBtn) {
    zoomOutBtn.addEventListener('click', () => {
      currentZoom = Math.max(50, currentZoom - 5);
      applyZoom(measuresEl);
    });
  }
}

function applyZoom(container) {
  // We set CSS variables on the container so that any child (like .measures-scroller)
  // automatically inherits the correct zoom level even if it's recreated.
  container.style.setProperty('--grid-zoom', `${currentZoom}%`);
  container.style.setProperty('--grid-zoom-raw', currentZoom.toString());
  localStorage.setItem('groovepan_grid_zoom', currentZoom.toString());
}
