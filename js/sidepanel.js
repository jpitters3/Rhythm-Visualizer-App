// sidepanel.js
// Sidepanel class: manages open/close and ESC stack for all sidepanels.
//
// Usage:
//   const myPanel = new Sidepanel(document.getElementById('myPanel'), { onClose: cleanupFn });
//   myPanel.open();          // adds .open, removes aria-hidden, pushes onto stack
//   myPanel.close();         // removes .open, sets aria-hidden=true, calls onClose, pops stack
//   Sidepanel.closeTopmost() // closes the most recently opened sidepanel (called by ESC handler)
//   Sidepanel.closeAll()     // closes all open sidepanels (mutual exclusivity enforcement)
//   Sidepanel.syncNavState() // syncs nav button active states to current open panel state

// Map of panel element IDs to their nav button IDs.
// Add entries here when new panels should highlight a nav button.
const NAV_BUTTON_MAP = {
  composerSidebar: 'toggleComposerBtn',
  courseSidebar:   'toggleSidebarBtn',
  lessonPlayer:    'toggleSidebarBtn',
};

// The Studio nav link stays active whenever any panel that lives inside the
// studio view is open (composer, courses, lesson player).
const STUDIO_PANEL_IDS = new Set(['composerSidebar', 'courseSidebar', 'lessonPlayer']);

export class Sidepanel {
  static #stack = [];
  static #all = [];
  #onClose;

  constructor(el, { onClose } = {}) {
    this.el = el;
    this.#onClose = onClose ?? null;
    Sidepanel.#all.push(this);
  }

  open() {
    this.el.classList.add('open');
    this.el.removeAttribute('aria-hidden');
    if (!Sidepanel.#stack.includes(this)) Sidepanel.#stack.push(this);
    Sidepanel.syncNavState();
  }

  close() {
    this.el.classList.remove('open');
    this.el.setAttribute('aria-hidden', 'true');
    this.#onClose?.();
    Sidepanel.#stack = Sidepanel.#stack.filter(s => s !== this);
    Sidepanel.syncNavState();
  }

  get isOpen() {
    return this.el.classList.contains('open');
  }

  static closeTopmost() {
    const top = Sidepanel.#stack.at(-1);
    if (!top) return false;
    top.close();
    return true;
  }

  // Close all open sidepanels, optionally excluding elements by ID.
  // Used by closeSidebar() to enforce mutual exclusivity.
  static closeAll({ except = [] } = {}) {
    for (const s of [...Sidepanel.#all]) {
      if (except.includes(s.el.id)) continue;
      if (s.isOpen) s.close();
    }
  }

  // Syncs nav button active states to the current open panel state.
  // Reads directly from #stack — no module needs to pass state in.
  static syncNavState() {
    const openIds = new Set(Sidepanel.#stack.map(s => s.el.id));

    // Collect which button IDs should be active (a button is active if ANY
    // of its mapped panels is open — handles multiple panels sharing one button)
    const activeButtons = new Set();
    for (const [panelId, btnId] of Object.entries(NAV_BUTTON_MAP)) {
      if (openIds.has(panelId)) activeButtons.add(btnId);
    }
    const allButtons = new Set(Object.values(NAV_BUTTON_MAP));
    for (const btnId of allButtons) {
      document.getElementById(btnId)?.classList.toggle('active', activeButtons.has(btnId));
    }

    // Studio link is active when on the freeplay route OR when a studio panel is open
    const onFreeplay = window.location.hash === '#freeplay' || window.location.hash === '';
    const studioActive = onFreeplay || [...openIds].some(id => STUDIO_PANEL_IDS.has(id));
    document.querySelector('.nav-link[data-route="freeplay"]')
      ?.classList.toggle('active', studioActive);
  }
}
