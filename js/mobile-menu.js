// Mobile UI Logic (Hamburger and Controls)
export function initMobileMenu() {
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const mobileControlsBtn = document.getElementById('mobileControlsBtn');
  const appNav = document.getElementById('appNav');
  const primaryControlsWrapper = document.getElementById('primaryControlsWrapper');

  if (!mobileMenuBtn || !appNav) return;

  function openControls() {
    if (!primaryControlsWrapper) return;
    const panel = document.querySelector('.handpan-panel');
    const slot = document.getElementById('panelControlsSlot');
    if (panel && slot && primaryControlsWrapper.parentElement !== slot) {
      primaryControlsWrapper._origParent = primaryControlsWrapper.parentElement;
      primaryControlsWrapper._origNext = primaryControlsWrapper.nextSibling;
      slot.appendChild(primaryControlsWrapper);
      panel.classList.add('controls-mode');
    }
    primaryControlsWrapper.classList.add('mobile-open');
    mobileControlsBtn?.setAttribute('aria-expanded', 'true');
  }

  function closeControls() {
    if (!primaryControlsWrapper) return;
    const panel = document.querySelector('.handpan-panel');
    primaryControlsWrapper.classList.remove('mobile-open');
    if (primaryControlsWrapper._origParent) {
      primaryControlsWrapper._origParent.insertBefore(primaryControlsWrapper, primaryControlsWrapper._origNext || null);
      primaryControlsWrapper._origParent = null;
      primaryControlsWrapper._origNext = null;
    }
    panel?.classList.remove('controls-mode');
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
      if (primaryControlsWrapper.classList.contains('mobile-open')) {
        closeControls();
      } else {
        openControls();
      }
    });
  }

  appNav.addEventListener('click', (e) => {
    const btn = e.target.closest('button, a');
    if (!btn) return;
    if (btn.id === 'accountBtn' || btn.id === 'phraseMenuBtn' || btn.id === 'adminMenuBtn') return;
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
