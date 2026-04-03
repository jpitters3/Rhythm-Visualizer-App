// Mobile UI Logic (Hamburger and Controls)
export function initMobileMenu() {
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const headerMenu = document.getElementById('headerMenu');
  const mobileControlsBtn = document.getElementById('mobileControlsBtn');
  const primaryControlsWrapper = document.getElementById('primaryControlsWrapper');

  if (!mobileMenuBtn || !headerMenu) return;

  // Toggle Main Menu
  mobileMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (primaryControlsWrapper) primaryControlsWrapper.classList.remove('open');
    headerMenu.classList.toggle('open');
    const isOpen = headerMenu.classList.contains('open');
    mobileMenuBtn.setAttribute('aria-expanded', isOpen);
  });

  // Toggle Primary Controls Drawer
  if (mobileControlsBtn && primaryControlsWrapper) {
    mobileControlsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      headerMenu.classList.remove('open');
      mobileMenuBtn.setAttribute('aria-expanded', 'false');
      primaryControlsWrapper.classList.toggle('open');
    });
  }

  // Close drawers when a button inside them is clicked
  [headerMenu, primaryControlsWrapper].forEach(panel => {
    if (!panel) return;
    panel.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
        if (e.target.classList.contains('dropdown-toggle')) return;
        if (e.target.id === 'projectMenuBtn') return;
        if (e.target.id === 'adminMenuBtn') return;
        panel.classList.remove('open');
        if (panel === headerMenu) mobileMenuBtn.setAttribute('aria-expanded', 'false');
      }
    });
  });

  // CLICK OUTSIDE to close all
  document.addEventListener('click', (e) => {
    const panels = [
      { el: headerMenu, btn: mobileMenuBtn },
      { el: primaryControlsWrapper, btn: mobileControlsBtn }
    ];

    panels.forEach(({ el, btn }) => {
      if (el && btn && el.classList.contains('open')) {
        if (!el.contains(e.target) && !btn.contains(e.target)) {
          el.classList.remove('open');
          if (btn === mobileMenuBtn) btn.setAttribute('aria-expanded', 'false');
        }
      }
    });
  });
}
