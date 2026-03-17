// @ts-check
const { test, expect } = require('@playwright/test');
const { createTestUser } = require('./utils/auth-helper');

/**
 * Test case for the guest-to-pro pattern saving flow:
 * 1. Open the app as a guest.
 * 2. Attempt to save a pattern -> Prompted to sign in.
 * 3. Sign in/Register.
 * 4. Save 5 patterns successfully.
 * 5. Attempt to save a 6th pattern -> Prompted to upgrade to Pro.
 */
test.describe('Monetization Save Gating', () => {

  test('should enforce authentication and 5-pattern limit', async ({ page }) => {
    // Pipe browser logs to terminal
    page.on('console', msg => console.log(`[BROWSER] ${msg.text()}`));

    // 1. Initial Load as Guest
    await page.goto('/');
    
    // Ensure grid is ready
    await page.waitForSelector('.measure-row');

    // 2. Add some notes to the grid to make it a valid pattern
    const cell0 = page.locator('.cell').nth(0);
    await cell0.click();
    await page.keyboard.type('D');

    // 3. Attempt to save as Guest
    console.log('[TEST] Checking guest save blocking...');
    
    // Set up dialog listener before click
    const dialogPromise = page.waitForEvent('dialog');
    
    // Open File dropdown and click Save
    await page.click('#fileDropdownBtn');
    await page.click('#saveBtn');
    
    const dialog = await dialogPromise;
    expect(dialog.message()).toContain('Please sign in or create an account to save patterns');
    await dialog.accept();

    // Verify Auth Modal automatically opened
    const authModal = page.locator('#authModal');
    await expect(authModal).toHaveClass(/open/);

    // 4. Sign In with a fresh test user
    console.log('[TEST] Creating test user and signing in...');
    const user = await createTestUser();
    await page.locator('#authEmail').fill(user.email);
    await page.locator('#authPass').fill(user.password);
    await page.click('#authLogin');

    // Wait for login to complete (modal closes)
    await expect(authModal).not.toHaveClass(/open/, { timeout: 15000 });
    console.log('[TEST] Signed in successfully.');

    // 5. Save 5 patterns (the free limit)
    for (let i = 1; i <= 5; i++) {
        console.log(`[TEST] Saving pattern ${i}/5...`);
        const patternName = `Sample Pattern ${i}`;
        
        const promptPromise = page.waitForEvent('dialog');
        await page.click('#fileDropdownBtn');
        await page.click('#saveBtn');
        const promptDialog = await promptPromise;
        await promptDialog.accept(patternName);
        
        // Wait for the select dropdown to reflect the new pattern
        const patternSelect = page.locator('#patternSelect');
        await expect(patternSelect).toContainText(patternName, { timeout: 10000 });
    }

    // 6. Attempt to save 6th pattern -> Upgrade Modal should appear
    console.log('[TEST] Attempting to save 6th pattern (over the limit)...');
    const sixthPromptPromise = page.waitForEvent('dialog');
    await page.click('#fileDropdownBtn');
    await page.click('#saveBtn');
    const sixthPrompt = await sixthPromptPromise;
    await sixthPrompt.accept('The Pro Pattern');

    // Verify Upgrade Modal is shown
    const upgradeModal = page.locator('#upgradeModal');
    await expect(upgradeModal).toHaveClass(/open/, { timeout: 10000 });
    await expect(upgradeModal).toContainText('Unlock Pro Features');
    await expect(upgradeModal).toContainText('Unlimited Cloud Storage');
    
    console.log('[TEST] Verified: 6th pattern save triggered upgrade modal.');
  });
});
