// Makes the handpan-tab drawers (Settings/Chords/Customize) draggable by
// their header, so they can be moved off the handpan they'd otherwise cover.
// Each drawer's position is remembered per-device (localStorage) and
// restored the next time it opens.

const STORAGE_PREFIX = 'gp_drawer_pos_';

function clamp(value, max) {
  return Math.min(Math.max(0, value), Math.max(0, max));
}

function applyPosition(panel, left, top) {
  panel.style.position = 'fixed';
  panel.style.margin = '0';
  panel.style.left = `${clamp(left, window.innerWidth - panel.offsetWidth)}px`;
  panel.style.top = `${clamp(top, window.innerHeight - panel.offsetHeight)}px`;
}

export function initDraggableDrawers() {
  document.querySelectorAll('.hp-drawer-modal').forEach(panel => {
    const header = panel.querySelector('.modal-header');
    const overlay = panel.closest('.modal-overlay');
    if (!header || !overlay || !overlay.id) return;

    const storageKey = STORAGE_PREFIX + overlay.id;
    const title = header.querySelector('.modal-title') || header;
    const handle = document.createElement('span');
    handle.className = 'drawer-drag-handle';
    handle.textContent = '⠿';
    handle.title = 'Drag to move';
    title.insertBefore(handle, title.firstChild);
    header.classList.add('draggable');

    let dragging = false;
    let startX = 0, startY = 0, startLeft = 0, startTop = 0;

    header.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.close-modal-btn')) return;
      dragging = true;
      const rect = panel.getBoundingClientRect();
      applyPosition(panel, rect.left, rect.top);
      startX = e.clientX;
      startY = e.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      header.classList.add('dragging');
      header.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    });

    header.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      applyPosition(panel, startLeft + (e.clientX - startX), startTop + (e.clientY - startY));
    });

    const endDrag = (e) => {
      if (!dragging) return;
      dragging = false;
      header.classList.remove('dragging');
      header.releasePointerCapture?.(e.pointerId);
      localStorage.setItem(storageKey, JSON.stringify({
        left: parseFloat(panel.style.left),
        top: parseFloat(panel.style.top),
      }));
    };
    header.addEventListener('pointerup', endDrag);
    header.addEventListener('pointercancel', endDrag);

    // Restore the last-dragged position (re-clamped, in case the viewport
    // has since shrunk) whenever this drawer opens.
    new MutationObserver(() => {
      if (!overlay.classList.contains('open')) return;
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(storageKey)); } catch { /* ignore malformed */ }
      if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
        applyPosition(panel, saved.left, saved.top);
      } else {
        panel.style.position = '';
        panel.style.left = '';
        panel.style.top = '';
        panel.style.margin = '';
      }
    }).observe(overlay, { attributes: true, attributeFilter: ['class'] });
  });
}
