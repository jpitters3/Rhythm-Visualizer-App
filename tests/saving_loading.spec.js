const { test, expect } = require('@playwright/test');
const { createTestUser, deleteTestUser, loginAsTestUser } = require('./utils/auth-helper');

test.describe('Pattern Management', () => {
  let testUser;

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    testUser = await createTestUser();
    await loginAsTestUser(page, testUser);
  });

  test.afterEach(async () => {
    if (testUser?.user?.id) {
      await deleteTestUser(testUser.user.id);
    }
  });

  // Helper for mobile menu
  async function ensureMenuOpen(page) {
    if (await page.locator('#mobileMenuBtn').isVisible()) {
      const menu = page.locator('#headerMenu');
      if (await menu.evaluate(el => el.classList.contains('open'))) return;

      await page.click('#mobileMenuBtn');
      try {
        await expect(menu).toHaveClass(/open/, { timeout: 2000 });
      } catch (e) {
        // Retry once
        if (await menu.evaluate(el => !el.classList.contains('open'))) {
          await page.click('#mobileMenuBtn');
          await expect(menu).toHaveClass(/open/);
        }
      }
    }
  }

  async function ensureMenuClosed(page) {
    // Only act if we are in mobile view (button is visible)
    if (await page.locator('#mobileMenuBtn').isVisible()) {
      const menu = page.locator('#headerMenu');
      const isOpen = await menu.evaluate(el => el.classList.contains('open'));
      if (isOpen) {
        await page.click('#mobileMenuBtn');
        await expect(menu).not.toHaveClass(/open/);
      }
    }
  }

  test('Save and Load Pattern', async ({ page }) => {
    const uniqueName = `Test Pattern ${Date.now()}`;

    // 1. Create a Pattern
    // Click first cell
    const cell0 = page.locator('.cell').nth(0);
    await cell0.click();
    await page.keyboard.press('1');
    await expect(cell0.locator('.inner')).toHaveText('1');

    // 2. Save Pattern
    await ensureMenuOpen(page); // OPEN MENU IF NEEDED
    await page.click('#fileDropdownBtn');
    await page.waitForSelector('.dropdown-content.show');
    await page.click('#saveBtn');

    // Handle Custom Modal Prompt
    const saveModal = page.locator('#confirmModal');
    await expect(saveModal).toHaveClass(/open/);
    await expect(page.locator('#confirmTitle')).toHaveText('Save Pattern');
    await page.fill('#confirmInput', uniqueName);
    await page.click('#confirmOkBtn');
    await expect(saveModal).not.toHaveClass(/open/);

    // Wait for save logic (it might verify via alert or UI update)
    // patternSelect should have the new val
    const select = page.locator('#patternSelect');
    await expect(select).toHaveValue(uniqueName);

    // 3. Clear Grid
    await ensureMenuClosed(page); // Ensure menu is closed so we can click Clear
    await page.click('#clearBtn-A');

    // Handle Custom Modal Confirm
    const clearModal = page.locator('#confirmModal');
    await expect(clearModal).toHaveClass(/open/);
    await page.click('#confirmOkBtn');
    await expect(clearModal).not.toHaveClass(/open/);
    await expect(cell0.locator('.inner')).toBeEmpty();

    // 4. Load Pattern
    await ensureMenuOpen(page);
    await page.click('#fileDropdownBtn');
    await page.waitForSelector('.dropdown-content.show');
    await page.click('#loadBtn');

    // Handle "Unsaved Changes" confirm modal (since we cleared the grid)
    const loadConfirmModal = page.locator('#confirmModal');
    await expect(loadConfirmModal).toHaveClass(/open/);
    await expect(page.locator('#confirmTitle')).toHaveText('Unsaved Changes');
    await page.click('#confirmOkBtn');
    await expect(loadConfirmModal).not.toHaveClass(/open/);

    // 5. Verify Restoration
    await expect(cell0.locator('.inner')).toHaveText('1');
  });

  test('Delete Pattern', async ({ page }) => {
    const uniqueName = `Delete Me ${Date.now()}`;

    // 1. Save dummy pattern
    await ensureMenuOpen(page); // OPEN MENU IF NEEDED
    await page.click('#fileDropdownBtn');
    await page.waitForSelector('.dropdown-content.show');
    await page.click('#saveBtn');

    // Custom Modal
    await page.fill('#confirmInput', uniqueName);
    await page.click('#confirmOkBtn');
    await expect(page.locator('#confirmModal')).not.toHaveClass(/open/);

    // 2. Click Delete
    await ensureMenuOpen(page); // OPEN MENU IF NEEDED
    await page.click('#fileDropdownBtn');
    await page.waitForSelector('.dropdown-content.show');
    await page.click('#deleteBtn');

    // Handle Delete Confirm Modal
    const deleteModal = page.locator('#confirmModal');
    await expect(deleteModal).toHaveClass(/open/);
    await expect(page.locator('#confirmTitle')).toHaveText('Delete Pattern');
    await page.click('#confirmOkBtn');
    await expect(deleteModal).not.toHaveClass(/open/);

    // 3. Verify Removal
    // The select should no longer have this option (retry until update happens)
    await expect(page.locator('#patternSelect')).not.toContainText(uniqueName);
  });

});
