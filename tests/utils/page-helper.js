/**
 * Netlify deploy previews inject a fixed "Powered by Netlify" badge iframe
 * bottom-right that swallows clicks on mobile viewports. It can be injected
 * after load, so a CSS rule is used rather than removing the node.
 * @param {import('@playwright/test').Page} page
 */
async function hideNetlifyBadge(page) {
  await page.addInitScript(() => {
    const addStyle = () => {
      const style = document.createElement('style');
      style.textContent = '#nl-badge-frame { display: none !important; }';
      document.documentElement.appendChild(style);
    };
    if (document.documentElement) addStyle();
    else document.addEventListener('DOMContentLoaded', addStyle, { once: true });
  });
}

/**
 * Wait for the page to be fully loaded and initialized
 * @param {import('@playwright/test').Page} page - Playwright page object
 */
async function waitForPageReady(page) {
  await hideNetlifyBadge(page);

  // A fresh context has no "tour seen" flags, so whichever onboarding tour
  // belongs to the landing route (js/onboarding-tour.js — one flag per
  // route: dashboard/studio/library/composer/practice/courses/community)
  // opens on arrival and intercepts clicks on everything underneath it (see
  // the same fix in tests/helpers.js's gotoStudio(), which only covers the
  // studio one). Seed all of them via addInitScript (runs before the app's
  // own scripts) so callers of this helper don't hit any of them mid-test.
  await page.addInitScript(() => {
    const tourFlags = [
      'panafide_tour_dashboard', 'panafide_tour_studio', 'panafide_tour_library',
      'panafide_tour_composer', 'panafide_tour_practice', 'panafide_tour_courses',
      'panafide_tour_community',
    ];
    tourFlags.forEach(flag => localStorage.setItem(flag, '1'));
  });

  // A cold load with no hash now defaults to the Dashboard route (see
  // js/router.js), not Studio, so '/' alone leaves .measure-row hidden
  // behind display:none — request Studio explicitly instead.
  await page.goto('/#studio', { waitUntil: 'networkidle' });

  // Wait for the grid to be rendered (ensures JS has initialized)
  await page.waitForSelector('.measure-row', { timeout: 10000 });

  // Small delay to ensure all initialization is complete
  await page.waitForTimeout(500);
}

module.exports = { waitForPageReady, hideNetlifyBadge };
