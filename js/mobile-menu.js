// Mobile UI Logic (Hamburger and Controls)
export function initMobileMenu() {
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const mobileControlsBtn = document.getElementById('mobileControlsBtn');
  const appNav = document.getElementById('appNav');
  const primaryControlsWrapper = document.getElementById('primaryControlsWrapper');

  if (!mobileMenuBtn || !appNav) return;

  mobileMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (primaryControlsWrapper) primaryControlsWrapper.classList.remove('mobile-open');
    appNav.classList.toggle('open');
    mobileMenuBtn.setAttribute('aria-expanded', appNav.classList.contains('open'));
  });

  if (mobileControlsBtn && primaryControlsWrapper) {
    mobileControlsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      appNav.classList.remove('open');
      mobileMenuBtn.setAttribute('aria-expanded', 'false');
      primaryControlsWrapper.classList.toggle('mobile-open');
      mobileControlsBtn.setAttribute('aria-expanded', primaryControlsWrapper.classList.contains('mobile-open'));
    });

  }

  // Close nav when a nav link is clicked
  appNav.addEventListener('click', (e) => {
    const btn = e.target.closest('button, a');
    if (!btn) return;
    // Don't close for dropdown triggers
    if (btn.id === 'accountBtn' || btn.id === 'phraseMenuBtn' || btn.id === 'adminMenuBtn') return;
    appNav.classList.remove('open');
    mobileMenuBtn.setAttribute('aria-expanded', 'false');
  });

  // Use capture phase so stopPropagation in child handlers (handpan, notegrid) doesn't block us
  document.addEventListener('click', (e) => {
    if (appNav.classList.contains('open') && !appNav.contains(e.target) && !mobileMenuBtn.contains(e.target)) {
      appNav.classList.remove('open');
      mobileMenuBtn.setAttribute('aria-expanded', 'false');
    }
    if (
      primaryControlsWrapper &&
      primaryControlsWrapper.classList.contains('mobile-open') &&
      !primaryControlsWrapper.contains(e.target) &&
      !mobileControlsBtn.contains(e.target)
    ) {
      primaryControlsWrapper.classList.remove('mobile-open');
      mobileControlsBtn?.setAttribute('aria-expanded', 'false');
    }
  }, true);
}
