
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
    // Close controls if open
    if (primaryControlsWrapper) primaryControlsWrapper.classList.remove('open');
    
    headerMenu.classList.toggle('open');
    const isOpen = headerMenu.classList.contains('open');
    mobileMenuBtn.setAttribute('aria-expanded', isOpen);
  });

  // Close Main Menu when a button inside it is clicked (mobile)
  headerMenu.addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
      headerMenu.classList.remove('open');
      mobileMenuBtn.setAttribute('aria-expanded', 'false');
    }
  });


  // Toggle Primary Controls Drawer
  if (mobileControlsBtn && primaryControlsWrapper) {
    mobileControlsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Close main menu if open
      headerMenu.classList.remove('open');
      mobileMenuBtn.setAttribute('aria-expanded', 'false');

      primaryControlsWrapper.classList.toggle('open');
    });
  }

  // CLICK OUTSIDE to close both
  document.addEventListener('click', (e) => {
    // Handle Main Menu
    if (headerMenu.classList.contains('open')) {
      if (!headerMenu.contains(e.target) && !mobileMenuBtn.contains(e.target)) {
        headerMenu.classList.remove('open');
        mobileMenuBtn.setAttribute('aria-expanded', 'false');
      }
    }

    // Handle Controls Drawer
    if (primaryControlsWrapper && primaryControlsWrapper.classList.contains('open')) {
      if (!primaryControlsWrapper.contains(e.target) && !mobileControlsBtn.contains(e.target)) {
        primaryControlsWrapper.classList.remove('open');
      }
    }
  });
}
