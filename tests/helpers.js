// @ts-check
/**
 * Shared Playwright test helpers
 */

/**
 * Sets BPM via .t-bpm-num (the number input), not .t-bpm-input (the range
 * slider) — small phones hide the slider entirely (css/controls.css,
 * @media max-width:430px) in favor of the number input + tap, so filling
 * the slider directly only works on desktop. .t-bpm-num applies on
 * blur/Enter rather than on input (js/transport-ui.js), and syncs
 * .t-bpm-input's value either way, so this works on every viewport and
 * leaves existing .toHaveValue() assertions on either input unaffected.
 */
async function setBpm(page, value, containerSelector = '#mainTransport-A') {
  const bpmNum = page.locator(`${containerSelector} .t-bpm-num`);
  await bpmNum.fill(String(value));
  await bpmNum.press('Enter');
}

/**
 * Clicks the metronome bell. On mobile (js/transport-ui.js), .t-metro-btn
 * opens a submenu instead of toggling directly — the real toggle is
 * .t-metro-toggle-row inside it, and toggleMetronome() closes that menu
 * again after every click, so each call needs to reopen it. That menu isn't
 * reachable as a descendant of containerSelector though: transport-ui.js
 * reparents it to directly under <body> at construction time (clipping /
 * position:fixed-containing-block reasons, its own comment explains), for
 * every .transport-container that exists (A and B both, dual mode or not).
 * Querying .show globally works anyway, since at most one menu is open at
 * a time. A no-op extra step on desktop, where the bell toggles directly
 * and this menu is never shown, so clicking the row too, if present, is
 * harmless either way.
 */
async function clickMetroToggle(page, containerSelector = '#mainTransport-A') {
  const metroBtn = page.locator(`${containerSelector} .t-metro-btn`);
  await metroBtn.click();
  const openMenu = page.locator('.t-metro-menu.show');
  if (await openMenu.count() > 0) {
    await openMenu.locator('.t-metro-toggle-row').click();
  }
}

/**
 * #primaryControlsWrapper (clear/groove/label-notation/compose buttons etc.)
 * is hidden entirely on mobile viewports (css/controls.css) — reachable only
 * by first opening it via #mobileControlsBtn (js/mobile-menu.js), which
 * relocates it into view. A no-op on desktop, where that button doesn't
 * exist, and on mobile once it's already open — #mobileControlsBtn is a
 * toggle, so clicking it a second time would close the panel instead.
 * Call this before interacting with anything inside that wrapper.
 */
async function openMobileControlsIfNeeded(page) {
  const btn = page.locator('#mobileControlsBtn').first();
  if (!(await btn.isVisible().catch(() => false))) return;
  const alreadyOpen = await page.locator('#primaryControlsWrapper')
    .evaluate(el => el.classList.contains('mobile-open')).catch(() => false);
  if (!alreadyOpen) await btn.click();
}

/**
 * The inverse of openMobileControlsIfNeeded — opening the controls panel on
 * mobile relocates it into the handpan panel's own slot (js/mobile-menu.js),
 * hiding the handpan itself while it's open. Call this to restore the
 * handpan (e.g. for tests that tap .hp-dot) after using a control that only
 * mobile-controls-opening made reachable.
 */
async function closeMobileControlsIfNeeded(page) {
  const btn = page.locator('#mobileControlsBtn').first();
  if (!(await btn.isVisible().catch(() => false))) return;
  const isOpen = await page.locator('#primaryControlsWrapper')
    .evaluate(el => el.classList.contains('mobile-open')).catch(() => false);
  if (isOpen) await btn.click();
}

/**
 * #appNav (the nav links — Dashboard, Studio, Practice, Courses,
 * Composer...) is a collapsed hamburger menu on mobile — #mobileMenuBtn
 * toggles it open (js/mobile-menu.js). A no-op on desktop, where it's
 * always visible. Call this before clicking any .nav-link.
 */
async function openNavIfNeeded(page) {
  const menuBtn = page.locator('#mobileMenuBtn');
  if (!(await menuBtn.isVisible().catch(() => false))) return;
  const isOpen = await page.locator('#appNav').evaluate(el => el.classList.contains('open')).catch(() => false);
  if (!isOpen) await menuBtn.click();
}

/**
 * Clicks the clear button for the given grid and confirms the custom dialog.
 * The app uses a custom #confirmModal instead of the native browser confirm,
 * so we must wait for it to open and click OK. Only #clearBtn-A lives inside
 * #primaryControlsWrapper (index.html) — #clearBtn-B is a separate,
 * always-in-flow element that the mobile controls panel, when open,
 * visually covers and intercepts clicks on instead of helping reach.
 */
async function clearGrid(page, gridId = 'A') {
  if (gridId === 'A') {
    await openMobileControlsIfNeeded(page);
  } else {
    await closeMobileControlsIfNeeded(page);
  }
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

module.exports = { clearGrid, gotoStudio, openMobileControlsIfNeeded, closeMobileControlsIfNeeded, setBpm, clickMetroToggle, openNavIfNeeded };
