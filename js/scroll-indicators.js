/**
 * Sets up scroll indicators for a specific container and its indicators.
 * @param {HTMLElement} container - The scrollable element.
 * @param {HTMLElement} leftIndicator - The left arrow element.
 * @param {HTMLElement} rightIndicator - The right arrow element.
 */
export function setupScrollIndicators(container, leftIndicator, rightIndicator) {
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
  
  return updateIndicators; // Return for manual triggering if needed
}

export function initScrollIndicators() {
  // 1. Primary Controls
  const primaryRow = document.getElementById('primaryControlsRow');
  const primaryWrapper = primaryRow?.closest('.scrollable-controls-wrapper');
  if (primaryRow && primaryWrapper) {
    const left = primaryWrapper.querySelector('.scroll-indicator.left');
    const right = primaryWrapper.querySelector('.scroll-indicator.right');
    setupScrollIndicators(primaryRow, left, right);
  }

  // 2. Selection Tools
  const selectionRow = document.getElementById('selectionTools');
  const selectionWrapper = document.getElementById('selectionToolsWrapper');
  if (selectionRow && selectionWrapper) {
    const left = selectionWrapper.querySelector('.scroll-indicator.left');
    const right = selectionWrapper.querySelector('.scroll-indicator.right');
    setupScrollIndicators(selectionRow, left, right);
  }
}

