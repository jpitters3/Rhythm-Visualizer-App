/**
 * js/toast.js
 * Minimal non-blocking toast notifications (e.g. "Your post is live!").
 * Unlike alert.js's modal alert(), these don't block interaction.
 */

let container = null;

function ensureContainer() {
  if (container) return container;
  container = document.createElement('div');
  container.className = 'toast-container';
  document.body.appendChild(container);
  return container;
}

/**
 * @param {string} message
 * @param {{ type?: 'success'|'error'|'info', duration?: number }} [opts]
 */
export function showToast(message, opts = {}) {
  const { type = 'info', duration = 5000 } = opts;
  const el = ensureContainer();

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  el.appendChild(toast);

  // Force reflow so the enter transition plays
  void toast.offsetWidth;
  toast.classList.add('toast-show');

  const remove = () => {
    toast.classList.remove('toast-show');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    setTimeout(() => toast.remove(), 500); // fallback if transitionend doesn't fire
  };

  toast.addEventListener('click', remove);
  setTimeout(remove, duration);
}
