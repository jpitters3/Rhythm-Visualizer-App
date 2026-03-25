// sidepanel.js
// Sidepanel class: manages open/close and ESC stack for all sidepanels.
//
// Usage:
//   const myPanel = new Sidepanel(document.getElementById('myPanel'), { onClose: cleanupFn });
//   myPanel.open();          // adds .open, removes aria-hidden, pushes onto stack
//   myPanel.close();         // removes .open, sets aria-hidden=true, calls onClose, pops stack
//   Sidepanel.closeTopmost() // closes the most recently opened sidepanel (called by ESC handler)
//   Sidepanel.closeAll()     // closes all open sidepanels (mutual exclusivity enforcement)

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
  }

  close() {
    this.el.classList.remove('open');
    this.el.setAttribute('aria-hidden', 'true');
    this.#onClose?.();
    Sidepanel.#stack = Sidepanel.#stack.filter(s => s !== this);
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
}
