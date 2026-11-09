// Mobile UI Logic (Hamburger and Controls)
export function initMobileMenu() {
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const mobileControlsBtn = document.getElementById('mobileControlsBtn');
  const appNav = document.getElementById('appNav');
  const primaryControlsWrapper = document.getElementById('primaryControlsWrapper');

  if (!mobileMenuBtn || !appNav) return;

  const CLOSE_MS = 180; // matches the slot transition in css/measure-actions.css
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let origParent = null;
  let origNext = null;
  let closeTimer = null;

  function openControls() {
    if (!primaryControlsWrapper) return;
    if (closeTimer) finishClose(); // reopened mid-close
    const panel = document.querySelector('.handpan-panel');
    const slot = document.getElementById('panelControlsSlot');
    if (panel && slot && primaryControlsWrapper.parentElement !== slot) {
      // Pin the ghost row (and its controls toggle) where it is, so the toggle stays under the thumb.
      const ghostRow = document.getElementById('ghostNoteSection');
      if (ghostRow) panel.style.setProperty('--ghost-row-top', `${ghostRow.offsetTop}px`);
      origParent = primaryControlsWrapper.parentElement;
      origNext = primaryControlsWrapper.nextSibling;
      slot.appendChild(primaryControlsWrapper);
      panel.classList.add('controls-mode');
    }
    primaryControlsWrapper.classList.add('mobile-open');
    mobileControlsBtn?.setAttribute('aria-expanded', 'true');
  }

  // Fade the card out first, then restore the handpan.
  function closeControls() {
    if (!primaryControlsWrapper?.classList.contains('mobile-open') || closeTimer) return;
    const panel = document.querySelector('.handpan-panel');
    mobileControlsBtn?.setAttribute('aria-expanded', 'false');
    if (!panel?.classList.contains('controls-mode') || reduceMotion.matches) {
      finishClose();
      return;
    }
    panel.classList.add('controls-closing');
    closeTimer = setTimeout(finishClose, CLOSE_MS);
  }

  function finishClose() {
    clearTimeout(closeTimer);
    closeTimer = null;
    const panel = document.querySelector('.handpan-panel');
    primaryControlsWrapper.classList.remove('mobile-open');
    if (origParent) {
      origParent.insertBefore(primaryControlsWrapper, origNext);
      origParent = null;
      origNext = null;
    }
    panel?.classList.remove('controls-mode', 'controls-closing');
    panel?.style.removeProperty('--ghost-row-top');
    mobileControlsBtn?.setAttribute('aria-expanded', 'false');
  }

  mobileMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeControls();
    appNav.classList.toggle('open');
    mobileMenuBtn.setAttribute('aria-expanded', appNav.classList.contains('open'));
  });

  if (mobileControlsBtn && primaryControlsWrapper) {
    mobileControlsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      appNav.classList.remove('open');
      mobileMenuBtn.setAttribute('aria-expanded', 'false');
      if (primaryControlsWrapper.classList.contains('mobile-open') && !closeTimer) {
        closeControls();
      } else {
        openControls();
      }
    });
  }

  appNav.addEventListener('click', (e) => {
    const btn = e.target.closest('button, a');
    if (!btn) return;
    if (btn.id === 'accountBtn' || btn.id === 'adminMenuBtn') return;
    appNav.classList.remove('open');
    mobileMenuBtn.setAttribute('aria-expanded', 'false');
  });

  document.addEventListener('click', (e) => {
    if (appNav.classList.contains('open') && !appNav.contains(e.target) && !mobileMenuBtn.contains(e.target)) {
      appNav.classList.remove('open');
      mobileMenuBtn.setAttribute('aria-expanded', 'false');
    }
    if (
      primaryControlsWrapper?.classList.contains('mobile-open') &&
      !primaryControlsWrapper.contains(e.target) &&
      !mobileControlsBtn?.contains(e.target)
    ) {
      closeControls();
    }
  }, true);
}
