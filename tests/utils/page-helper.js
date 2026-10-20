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

  // The app logs its startup milestones ('--- APP INIT START ---',
  // 'SafeInit Started', '--- APP INIT COMPLETE ---' in js/init.js). Kept so
  // a page that never renders the grid can say how far startup got.
  const log = [];
  const onConsole = msg => log.push(`[${msg.type()}] ${msg.text()}`);
  const onPageError = err => log.push(`[pageerror] ${err.message}`);
  page.on('console', onConsole);
  page.on('pageerror', onPageError);

  // A cold load with no hash now defaults to the Dashboard route (see
  // js/router.js), not Studio, so '/' alone leaves .measure-row hidden
  // behind display:none — request Studio explicitly instead.
  await page.goto('/#studio', { waitUntil: 'networkidle' });

  // Wait for the grid to be rendered (ensures JS has initialized)
  try {
    await page.waitForSelector('.measure-row', { timeout: 10000 });
  } catch (err) {
    err.message += `\n\nPage console up to the timeout:\n${log.slice(-40).join('\n') || '(nothing logged)'}`;
    throw err;
  } finally {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
  }

  // Small delay to ensure all initialization is complete
  await page.waitForTimeout(500);
}

/**
 * Waits for the app's startup (js/init.js) to finish after a load or reload.
 * networkidle isn't enough: startup awaits auth, profile and scale requests
 * before it wires the hamburger menu, router and grid, and on a slow page
 * (seen on Mobile Safari) that can still be pending after networkidle; a
 * click on #mobileMenuBtn before then does nothing. The grid is rendered right after all of those
 * are wired (safeInit()), so its rows existing means startup got there.
 * Attached rather than visible: a signed-in reload lands on Dashboard, where
 * the grid exists but is hidden.
 * @param {import('@playwright/test').Page} page
 */
async function waitForAppReady(page) {
  await page.locator('.measure-row').first().waitFor({ state: 'attached', timeout: 15000 });
}

module.exports = { waitForPageReady, waitForAppReady, hideNetlifyBadge };
