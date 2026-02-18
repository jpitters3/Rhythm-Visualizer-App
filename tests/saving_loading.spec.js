// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Pattern Management', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.measure-row');
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
    // Handle Prompt
    page.once('dialog', dialog => {
      expect(dialog.message()).toContain('Save pattern as');
      dialog.accept(uniqueName);
    });

    await ensureMenuOpen(page); // OPEN MENU IF NEEDED
    await page.click('#fileDropdownBtn');
    await page.waitForSelector('.dropdown-content.show');
    await page.click('#saveBtn');

    // Wait for save logic (it might verify via alert or UI update)
    // patternSelect should have the new val
    const select = page.locator('#patternSelect');
    await expect(select).toHaveValue(uniqueName);

    // 3. Clear Grid
    await ensureMenuClosed(page); // Ensure menu is closed so we can click Clear
    // Handle Clear Confirm
    page.once('dialog', dialog => {
      dialog.accept();
    });
    await page.click('#clearBtn-A');
    await expect(cell0.locator('.inner')).toBeEmpty();

    // 4. Load Pattern
    // Select is already set to uniqueName from save, but let's Ensure
    await ensureMenuOpen(page); // Ensure menu is visible to select pattern
    await select.selectOption(uniqueName);

    // Handle "Unsaved Changes" check

    // 5. Verify Restoration
    await expect(cell0.locator('.inner')).toHaveText('1');
  });

  test('Delete Pattern', async ({ page }) => {
    const uniqueName = `Delete Me ${Date.now()}`;

    // 1. Save dummy pattern
    page.once('dialog', dialog => dialog.accept(uniqueName));

    await ensureMenuOpen(page); // OPEN MENU IF NEEDED
    await page.click('#fileDropdownBtn');
    await page.waitForSelector('.dropdown-content.show');
    await page.click('#saveBtn');

    // 2. Click Delete
    // Handle Confirm

    await ensureMenuOpen(page); // OPEN MENU IF NEEDED
    await page.click('#fileDropdownBtn');
    await page.waitForSelector('.dropdown-content.show');
    await page.click('#deleteBtn');
    await page.click('#confirmOkBtn');

    // 3. Verify Removal
    // The select should no longer have this option (retry until update happens)
    await expect(page.locator('#patternSelect')).not.toContainText(uniqueName);
  });

});
