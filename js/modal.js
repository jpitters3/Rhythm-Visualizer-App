// modal.js
// Modal class: manages open/close, outside-click, and ESC stack for all modals.
//
// Usage:
//   const myModal = new Modal(document.getElementById('myModal'), { onClose: cleanupFn });
//   myModal.open();   // adds .open, sets aria-hidden=false, pushes onto stack
//   myModal.close();  // removes .open, sets aria-hidden=true, calls onClose, pops stack
//   Modal.closeTopmost()  // closes the most recently opened modal (called by ESC handler)

export class Modal {
  static #stack = [];
  #onClose;

  constructor(el, { onClose } = {}) {
    this.el = el;
    this.#onClose = onClose ?? null;

    // Outside-click: clicking the backdrop (not the inner card) closes the modal.
    el.addEventListener('click', (e) => {
      if (e.target === el) this.close();
    });
  }

  open() {
    this.el.classList.add('open');
    this.el.setAttribute('aria-hidden', 'false');
    if (!Modal.#stack.includes(this)) Modal.#stack.push(this);
  }

  close() {
    this.el.classList.remove('open');
    this.el.setAttribute('aria-hidden', 'true');
    this.#onClose?.();
    Modal.#stack = Modal.#stack.filter(m => m !== this);
  }

  get isOpen() {
    return this.el.classList.contains('open');
  }

  static closeTopmost() {
    const top = Modal.#stack.at(-1);
    if (top) { top.close(); return true; }

    // Fallback: close any open modal-overlay not managed by Modal class
    const open = document.querySelector('.modal-overlay.open, .modal-overlay[aria-hidden="false"]');
    if (open) {
      open.classList.remove('open');
      open.setAttribute('aria-hidden', 'true');
      return true;
    }
    return false;
  }
}
