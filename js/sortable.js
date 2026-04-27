/**
 * js/sortable.js
 * Minimal drag-and-drop reorder utility for vertical lists.
 *
 * Features:
 *  - Delegation-based (one listener on the container, not per-item)
 *  - Insertion-line indicator shows exactly where the item will land
 *  - Multi-container groups: items can be dragged between registered containers
 *  - Works with dynamically added items as long as they have draggable=true
 *
 * Usage — single container:
 *   const { destroy } = makeSortable(el, {
 *     itemSelector: '.my-card',
 *     onReorder({ draggedId, fromEl, toEl, beforeId }) { ... },
 *   });
 *
 * Usage — multiple containers sharing a drag group (e.g. folder columns):
 *   const group = makeSortableGroup({ itemSelector: '.my-card', onReorder });
 *   group.add(folderBodyA);
 *   group.add(folderBodyB);
 *   // Before re-rendering: group.destroy() then rebuild
 *
 * onReorder params:
 *   draggedId  — value of idAttribute on the dragged item
 *   fromEl     — the container the item was dragged FROM
 *   toEl       — the container it was dropped INTO
 *   beforeId   — insert BEFORE the item with this id; null means append to end
 *
 * Items must have:
 *   - draggable="true" (set by your render code)
 *   - an id attribute matching idAttribute (default: data-id)
 */

const DRAG_KEY = 'sortable/drag-id';

export function makeSortableGroup({
  itemSelector,
  idAttribute = 'data-id',
  onReorder,
} = {}) {
  const containers = new Map(); // containerEl → { event handlers }
  let indicator = null;
  let activeDragId = null;
  let sourceContainer = null;

  function getIndicator() {
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.className = 'sortable-indicator';
    }
    return indicator;
  }

  function removeIndicator() {
    indicator?.parentNode?.removeChild(indicator);
  }

  function getId(el) {
    return el.getAttribute(idAttribute);
  }

  // Returns the item that the dragged card should be inserted BEFORE
  // (null = append to end of container).
  function getInsertionPoint(containerEl, clientY) {
    const items = [...containerEl.querySelectorAll(itemSelector)]
      .filter(el => getId(el) !== activeDragId);
    for (const item of items) {
      const { top, height } = item.getBoundingClientRect();
      if (clientY < top + height / 2) return item;
    }
    return null;
  }

  function handleDragStart(e) {
    const item = e.target.closest(itemSelector);
    if (!item) return;
    activeDragId = getId(item);
    sourceContainer = null;
    for (const [el] of containers) {
      if (el.contains(item)) { sourceContainer = el; break; }
    }
    e.dataTransfer.setData(DRAG_KEY, activeDragId);
    e.dataTransfer.effectAllowed = 'move';
    item.classList.add('sortable-dragging');
  }

  function handleDragOver(containerEl, e) {
    if (!activeDragId) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    const beforeEl = getInsertionPoint(containerEl, e.clientY);
    const ind = getIndicator();
    containerEl.insertBefore(ind, beforeEl); // insertBefore(x, null) = appendChild
  }

  function handleDragLeave(containerEl, e) {
    if (!containerEl.contains(e.relatedTarget)) removeIndicator();
  }

  function handleDrop(containerEl, e) {
    e.preventDefault();
    const id = e.dataTransfer.getData(DRAG_KEY);
    const beforeEl = getInsertionPoint(containerEl, e.clientY);
    removeIndicator();
    if (!id || !onReorder) return;
    onReorder({
      draggedId: id,
      fromEl: sourceContainer,
      toEl: containerEl,
      beforeId: beforeEl ? getId(beforeEl) : null,
    });
  }

  function handleDragEnd() {
    // Clean up dragging class regardless of which container the item is in
    document.querySelectorAll('.sortable-dragging')
      .forEach(el => el.classList.remove('sortable-dragging'));
    activeDragId = null;
    sourceContainer = null;
    removeIndicator();
  }

  function add(containerEl) {
    if (containers.has(containerEl)) return;
    const handlers = {
      dragstart: handleDragStart,
      dragover:  (e) => handleDragOver(containerEl, e),
      dragleave: (e) => handleDragLeave(containerEl, e),
      drop:      (e) => handleDrop(containerEl, e),
      dragend:   handleDragEnd,
    };
    for (const [evt, fn] of Object.entries(handlers)) {
      containerEl.addEventListener(evt, fn);
    }
    containers.set(containerEl, handlers);
  }

  function remove(containerEl) {
    const handlers = containers.get(containerEl);
    if (!handlers) return;
    for (const [evt, fn] of Object.entries(handlers)) {
      containerEl.removeEventListener(evt, fn);
    }
    containers.delete(containerEl);
  }

  function destroy() {
    for (const [el] of containers) remove(el);
    removeIndicator();
    activeDragId = null;
    sourceContainer = null;
  }

  return { add, remove, destroy };
}

// Convenience wrapper for a single container.
export function makeSortable(containerEl, options) {
  const group = makeSortableGroup(options);
  group.add(containerEl);
  return { destroy: () => group.destroy() };
}
