
// Mobile UI Logic (Hamburger and Controls)
export function initMobileMenu() {
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const headerMenu = document.getElementById('headerMenu');
  const mobileControlsBtn = document.getElementById('mobileControlsBtn');
  const primaryControlsWrapper = document.getElementById('primaryControlsWrapper');
  const mobileFileOptionsBtn = document.getElementById('mobileFileOptionsBtn');
  const mobileFileOptionsDrawer = document.getElementById('mobileFileOptionsDrawer');

  if (!mobileMenuBtn || !headerMenu) return;

  // Move File Options to drawer on Mobile
  function moveFileOptionsForMobile() {
    if (window.innerWidth <= 768 && mobileFileOptionsDrawer) {
      const patternSelect = document.querySelector('.grid-child.pattern-select');
      const shareBtn = document.getElementById('shareBtn');
      if (patternSelect) mobileFileOptionsDrawer.appendChild(patternSelect);
      if (shareBtn) mobileFileOptionsDrawer.appendChild(shareBtn);
    }
  }
  moveFileOptionsForMobile();

  // Toggle Main Menu
  mobileMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    // Close other drawers if open
    if (primaryControlsWrapper) primaryControlsWrapper.classList.remove('open');
    if (mobileFileOptionsDrawer) mobileFileOptionsDrawer.classList.remove('open');
    
    headerMenu.classList.toggle('open');
    const isOpen = headerMenu.classList.contains('open');
    mobileMenuBtn.setAttribute('aria-expanded', isOpen);
  });

  // Toggle Primary Controls Drawer
  if (mobileControlsBtn && primaryControlsWrapper) {
    mobileControlsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      headerMenu.classList.remove('open');
      if (mobileFileOptionsDrawer) mobileFileOptionsDrawer.classList.remove('open');
      mobileMenuBtn.setAttribute('aria-expanded', 'false');

      primaryControlsWrapper.classList.toggle('open');
    });
  }

  // Toggle File Options Drawer
  if (mobileFileOptionsBtn && mobileFileOptionsDrawer) {
    mobileFileOptionsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      headerMenu.classList.remove('open');
      if (primaryControlsWrapper) primaryControlsWrapper.classList.remove('open');
      mobileMenuBtn.setAttribute('aria-expanded', 'false');

      mobileFileOptionsDrawer.classList.toggle('open');
    });
  }

  // Close drawers when a button inside them is clicked
  [headerMenu, primaryControlsWrapper, mobileFileOptionsDrawer].forEach(panel => {
    if (!panel) return;
    panel.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
        // Special case: don't close if it's a dropdown toggle that just opened something
        if (e.target.classList.contains('dropdown-toggle')) return;
        
        panel.classList.remove('open');
        if (panel === headerMenu) mobileMenuBtn.setAttribute('aria-expanded', 'false');
      }
    });
  });

  // CLICK OUTSIDE to close all
  document.addEventListener('click', (e) => {
    const panels = [
      { el: headerMenu, btn: mobileMenuBtn },
      { el: primaryControlsWrapper, btn: mobileControlsBtn },
      { el: mobileFileOptionsDrawer, btn: mobileFileOptionsBtn }
    ];

    panels.forEach(({ el, btn }) => {
      if (el && el.classList.contains('open')) {
        if (!el.contains(e.target) && !btn.contains(e.target)) {
          el.classList.remove('open');
          if (btn === mobileMenuBtn) btn.setAttribute('aria-expanded', 'false');
        }
      }
    });
  });

  // Handle Native Mobile File Select
  const mobileFileSelect = document.getElementById('mobileFileSelect');
  if (mobileFileSelect) {
    mobileFileSelect.addEventListener('change', (e) => {
      const val = e.target.value;
      if (!val) return;

      const btnMap = {
        'save': 'saveBtn',
        'load': 'loadBtn',
        'rename': 'renameBtn',
        'delete': 'deleteBtn',
        'export': 'exportBtn',
        'import': 'importBtn',
        'midi': 'importMidiBtn'
      };

      const targetBtnId = btnMap[val];
      if (targetBtnId) {
        const btn = document.getElementById(targetBtnId);
        if (btn) {
          btn.click();
        }
      }

      // Reset selection for next use
      mobileFileSelect.value = "";
    });
  }
}
