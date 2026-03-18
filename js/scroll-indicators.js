export function initScrollIndicators() {
  const container = document.getElementById('primaryControlsRow');
  const leftIndicator = document.querySelector('.scroll-indicator.left');
  const rightIndicator = document.querySelector('.scroll-indicator.right');
  
  if (!container || !leftIndicator || !rightIndicator) return;

  function updateIndicators() {
    // Only apply logic on mobile widths where scrolling is active
    if (window.innerWidth > 768) {
      leftIndicator.classList.remove('active');
      rightIndicator.classList.remove('active');
      return;
    }

    const { scrollLeft, scrollWidth, clientWidth } = container;
    
    // threshold to prevent flickering
    const buffer = 2;

    if (scrollLeft > buffer) {
      leftIndicator.classList.add('active');
    } else {
      leftIndicator.classList.remove('active');
    }

    if (Math.ceil(scrollLeft + clientWidth) < scrollWidth - buffer) {
      rightIndicator.classList.add('active');
    } else {
      rightIndicator.classList.remove('active');
    }
  }

  container.addEventListener('scroll', updateIndicators, { passive: true });
  window.addEventListener('resize', updateIndicators);
  
  // Create a MutationObserver to detect DOM changes
  const observer = new MutationObserver(updateIndicators);
  observer.observe(container, { childList: true, subtree: true, attributes: true, characterData: true });

  // initial check
  setTimeout(updateIndicators, 100);
}
