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
 * flags, so whichever onboarding tour belongs to the current route
 * (js/onboarding-tour.js — one flag per route) opens on arrival and
 * intercepts clicks on everything underneath it. All seven are seeded, not
 * just Studio's, because js/dashboard.js's initDashboard() unconditionally
 * force-navigates to #dashboard on any page load with an already-active
 * session — so any test that logs in (or reloads while logged in) will
 * detour through Dashboard at least once, even if it only cares about
 * Studio. Seeding via addInitScript (runs before the app's own scripts)
 * skips all of them regardless of which route is landed on.
 */
async function gotoStudio(page) {
  await page.addInitScript(() => {
    const tourFlags = [
      'panafide_tour_dashboard', 'panafide_tour_studio', 'panafide_tour_library',
      'panafide_tour_composer', 'panafide_tour_practice', 'panafide_tour_courses',
      'panafide_tour_community',
    ];
    tourFlags.forEach(flag => localStorage.setItem(flag, '1'));
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
