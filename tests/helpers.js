// @ts-check
/**
 * Shared Playwright test helpers
 */

/**
 * Clicks the clear button for the given grid and confirms the custom dialog.
 * The app uses a custom #confirmModal instead of the native browser confirm,
 * so we must wait for it to open and click OK.
 */
async function clearGrid(page, gridId = 'A') {
  await page.click(`#clearBtn-${gridId}`);
  await page.locator('#confirmModal.open').waitFor({ timeout: 5000 });
  await page.click('#confirmOkBtn');
}

/**
 * Navigates to the Studio grid. A fresh browser context has no "tour seen"
 * flags, so the Studio onboarding tour overlay (js/onboarding-tour.js) opens
 * on arrival and intercepts clicks on everything underneath it. Seeding the
 * flag via addInitScript (runs before the app's own scripts) skips it.
 */
async function gotoStudio(page) {
  await page.addInitScript(() => {
    localStorage.setItem('panafide_tour_studio', '1');
  });

  // Writing the first note as a guest opens a "save your creation" nudge
  // via #confirmModal (js/controls.js) that then blocks every click after
  // it. It shares the #confirmModal element with legitimate confirms tests
  // already handle explicitly (clear grid, delete pattern, etc.), so this
  // is scoped to the "Sign Up / Sign In" button text, which is distinctive
  // to this one dialog — NOTE: this copy has already changed once; if it's
  // reworded again, update the match here too.
  await page.addLocatorHandler(
    page.locator('#confirmModal.open', { hasText: 'Sign Up / Sign In' }),
    async () => {
      await page.click('#confirmCancelBtn');
    }
  );

  await page.goto('/#studio');
}

module.exports = { clearGrid, gotoStudio };
