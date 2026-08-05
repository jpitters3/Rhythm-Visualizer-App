/**
 * Wait for the page to be fully loaded and initialized
 * @param {import('@playwright/test').Page} page - Playwright page object
 */
async function waitForPageReady(page) {
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

module.exports = { waitForPageReady };
