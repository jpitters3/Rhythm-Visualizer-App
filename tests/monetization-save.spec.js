// @ts-check
const { test, expect } = require('@playwright/test');
const { createTestUser, deleteTestUser, loginAsTestUser } = require('./utils/auth-helper');
const { gotoStudio } = require('./helpers');


/**
 * Test case for the guest-to-pro pattern saving flow:
 * 1. Open the app as a guest.
 * 2. Attempt to save a pattern -> Prompted to sign in.
 * 3. Sign in/Register.
 * 4. Save 5 patterns successfully.
 * 5. Attempt to save a 6th pattern -> Prompted to upgrade to Pro.
 */
async function openPhraseMenu(page) {
  // On mobile the nav is hidden behind a hamburger — open #appNav first
  if (await page.locator('#mobileMenuBtn').isVisible()) {
    const appNav = page.locator('#appNav');
    const isOpen = await appNav.evaluate(/** @param {HTMLElement} el */ el => el.classList.contains('open'));
    if (!isOpen) await page.click('#mobileMenuBtn');
  }

  // #accountBtn lives inside #navAccountWrapper (display:none until signed in)
  await page.locator('#accountBtn').waitFor({ state: 'visible', timeout: 15000 });

  const accountDropdown = page.locator('#accountDropdownMenu');
  if (!await accountDropdown.evaluate(el => el.classList.contains('show'))) {
    await page.click('#accountBtn');
  }
  const phraseSubmenu = page.locator('#phraseSubmenu');
  if (!await phraseSubmenu.evaluate(el => el.classList.contains('open'))) {
    await page.click('#phraseMenuBtn');
  }
}

test.describe('Monetization Save Gating', () => {

  let testUser;

  test.beforeEach(async ({ page, isMobile }) => {
    // 0. Create unique test user
    testUser = await createTestUser();

    // 1. Initial Load as Guest, straight to Studio
    await gotoStudio(page);
  });

  test.afterEach(async ({ page }) => {
    // Clear browser session to prevent test interference
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());

    if (testUser) {
      await deleteTestUser(testUser.user.id);
    }
  });


  test('should enforce authentication and 5-pattern limit', async ({ page }) => {
    // Pipe browser logs to terminal
    page.on('console', msg => console.log(`[BROWSER] ${msg.text()}`));

    // Ensure grid is ready
    await page.waitForSelector('.measure-row');

    // 3. Add some notes to the grid to make it a valid pattern
    const cell0 = page.locator('.cell').nth(0);
    await cell0.click();
    await page.keyboard.type('D');

    // 4. Attempt to save as Guest
    // #saveBtn is inside the nav (hidden for guests) — trigger it directly
    console.log('[TEST] Checking guest save blocking...');
    await page.evaluate(() => document.getElementById('saveBtn')?.click());

    // Wait for Custom Confirm Modal (Alert mode for guest check)
    const confirmModal = page.locator('#confirmModal');
    await expect(confirmModal).toHaveClass(/open/);
    await expect(confirmModal).toContainText('Please sign in or create an account to save patterns');

    // Click OK on custom modal
    await confirmModal.locator('#confirmOkBtn').click();
    await expect(confirmModal).not.toHaveClass(/open/);

    // Verify Auth Modal automatically opened
    const authModal = page.locator('#authModal');
    await expect(authModal).toHaveClass(/open/);

    // 5. Sign In with a fresh test user
    console.log('[TEST] Creating test user and signing in...');
    const user = await createTestUser();
    await page.locator('#authEmail').fill(user.email);
    await page.click('#authContinueBtn');
    await page.locator('#authPasswordRow').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('#authPass').fill(user.password);
    await page.click('#authLogin');

    // Wait for login to complete (modal closes + nav updates)
    await expect(authModal).not.toHaveClass(/open/, { timeout: 15000 });
    await page.locator('#navAccountWrapper').waitFor({ state: 'visible', timeout: 15000 });
    console.log('[TEST] Signed in successfully.');

    // 6. Save 5 patterns (the free limit)
    for (let i = 1; i <= 5; i++) {
      console.log(`[TEST] Saving pattern ${i}/5...`);
      const patternName = `Sample Pattern ${i}`;

      await openPhraseMenu(page);
      await page.click('#saveBtn');

      // Wait for Custom Confirm Modal (Prompt mode)
      await expect(confirmModal).toHaveClass(/open/);
      await confirmModal.locator('#confirmInput').fill(patternName);
      await confirmModal.locator('#confirmOkBtn').click();
      await expect(confirmModal).not.toHaveClass(/open/);

      // Wait for the select dropdown to reflect the new pattern
      const patternSelect = page.locator('#patternSelect');
      await expect(patternSelect).toContainText(patternName, { timeout: 10000 });
    }

    // 7. Attempt to save 6th pattern -> Upgrade Modal should appear
    console.log('[TEST] Attempting to save 6th pattern (over the limit)...');
    await openPhraseMenu(page);
    await page.click('#saveBtn');

    // Custom Modal (Prompt mode for 6th save)
    await expect(confirmModal).toHaveClass(/open/);
    await confirmModal.locator('#confirmInput').fill('The Pro Pattern');
    await confirmModal.locator('#confirmOkBtn').click();
    await expect(confirmModal).not.toHaveClass(/open/);

    // Verify Upgrade Modal is shown
    const upgradeModal = page.locator('#upgradeModal');
    await expect(upgradeModal).toHaveClass(/open/, { timeout: 10000 });
    
    // Specifically verify the 'Unlimited Cloud Storage' feature is highlighted
    const highlightedFeature = upgradeModal.locator('#feat-storage');
    await expect(highlightedFeature).toHaveClass(/highlight/);
    
    // Capture screenshot for visual validation in walkthrough
    await page.screenshot({ path: 'upgrade_modal_highlight.png' });
    console.log('[TEST] Captured screenshot: upgrade_modal_highlight.png');

    await expect(upgradeModal).toContainText('Unlock Player+ Features');
    await expect(upgradeModal).toContainText('Unlimited Cloud Storage');

    console.log('[TEST] Verified: 6th pattern save triggered upgrade modal with feature highlight.');
  });
});
