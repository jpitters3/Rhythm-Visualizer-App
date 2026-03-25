// windowControls.js
//
// Centralizes ESC and outside-click close behavior for all modals and sidepanels.
//
// - Modals (.modal-overlay) have priority over sidepanels.
// - Sidepanels are any element with data-panel-type="sidepanel".
// - ESC is handled via handleEscKey(), called from keyboard-shortcuts.js so all
//   key handling stays in one place. Outside-click is handled here directly.
// - Panels with non-trivial close logic are registered in CLOSE_FNS by element ID.
//   Everything else falls back to removing the .open class.

import { closeSidebar, closeLessonSidebar } from './courses.js';
import { closeCoachingSidebar, closeCoachResultsSidebar } from './coaching-mode.js';
import { aiAssistant } from './ai-assistant.js';

// Sidepanels with non-trivial close logic (e.g. updateBodySidebarClass), keyed by element ID.
// Modals all use the generic fallback in getCloseFn.
const CLOSE_FNS = {
  courseSidebar:        closeSidebar,
  lessonSidebar:        closeLessonSidebar,
  coachingSidebar:      closeCoachingSidebar,
  coachResultsSidebar:  closeCoachResultsSidebar,
  aiChatContainer:      () => aiAssistant?.toggleChat(false),
};

// Ordered list of currently-open panels (earliest → latest).
const openStack = [];

function getCloseFn(el) {
  return CLOSE_FNS[el.id] ?? (() => {
    el.classList.remove('open');
    el.setAttribute('aria-hidden', 'true');
  });
}

function isModal(el) {
  return el.classList.contains('modal-overlay');
}

function isSidepanel(el) {
  return el.dataset.panelType === 'sidepanel';
}

function closeTopmost(predicate) {
  for (let i = openStack.length - 1; i >= 0; i--) {
    const el = openStack[i];
    if (el.classList.contains('open') && predicate(el)) {
      getCloseFn(el)();
      return true;
    }
  }
  return false;
}

// Called from keyboard-shortcuts.js on Escape.
// Returns true if a panel was closed (caller should return early).
export function handleEscKey() {
  if (closeTopmost(isModal)) return true;
  if (closeTopmost(isSidepanel)) return true;
  return false;
}

export function initWindowControls() {
  // Track which panels are open via MutationObserver — no changes needed
  // in individual modal files.
  const observer = new MutationObserver((mutations) => {
    for (const { target } of mutations) {
      const isOpen = target.classList.contains('open');
      const idx = openStack.indexOf(target);
      if (isOpen && idx === -1) openStack.push(target);
      else if (!isOpen && idx !== -1) openStack.splice(idx, 1);
    }
  });

  const selector = '.modal-overlay, [data-panel-type="sidepanel"]';
  document.querySelectorAll(selector).forEach(el =>
    observer.observe(el, { attributes: true, attributeFilter: ['class'] })
  );

  // Outside click: clicking the backdrop (not the inner card) closes the modal.
  document.addEventListener('click', (e) => {
    const overlay = e.target.closest('.modal-overlay');
    if (overlay && e.target === overlay) getCloseFn(overlay)();
  });
}
