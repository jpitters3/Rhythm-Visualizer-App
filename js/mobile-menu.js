
// Mobile Hamburger Menu Logic
export function initMobileMenu() {
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const headerMenu = document.getElementById('headerMenu');

  if (!mobileMenuBtn || !headerMenu) return;

  // Toggle menu
  mobileMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    headerMenu.classList.toggle('open');
    // Toggle aria-expanded for accessibility
    const isOpen = headerMenu.classList.contains('open');
    mobileMenuBtn.setAttribute('aria-expanded', isOpen);
  });

  // CLICK OUTSIDE to close
  document.addEventListener('click', (e) => {
    if (!headerMenu.classList.contains('open')) return;

    // If click is NOT inside the menu AND NOT on the button, close it
    if (!headerMenu.contains(e.target) && !mobileMenuBtn.contains(e.target)) {
      headerMenu.classList.remove('open');
      mobileMenuBtn.setAttribute('aria-expanded', 'false');
    }
  });
}
