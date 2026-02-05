// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Undo/Redo Features', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.measure-row');
  });

  test('Undo/Redo Note Entry', async ({ page }) => {
    // 1. Initial State: grid empty
    // (Assuming default empty grid or we clear it)
    await page.click('#clearBtn-A');

    // 2. Add a note (Click first cell)
    const cell0 = page.locator('.cell').nth(0);
    await cell0.click();
    // Assuming click sets caret, verify we can write note?
    // Actually, simple click selects. We need to type '1' or similar.
    await page.keyboard.press('1');

    // Verify Label '1'
    await expect(cell0.locator('.inner')).toHaveText('1');

    // 3. Undo
    await page.keyboard.press('Meta+z'); // Cmd+Z
    await expect(cell0.locator('.inner')).toBeEmpty();

    // 4. Redo
    await page.keyboard.press('Meta+Shift+z'); // Cmd+Shift+Z
    await expect(cell0.locator('.inner')).toHaveText('1');
  });


  test('Data Loss Prevention', async ({ page }) => {
    // 1. Clean state
    await page.click('#clearBtn-A');

    // 2. Make change
    await page.locator('.cell').nth(0).click();
    await page.keyboard.press('1');

    // 3. Verify Dirty State via Import Prompt
    // If dirty, clicking Import should trigger "You have unsaved changes" confirm
    let confirmMsg = '';
    page.once('dialog', dialog => {
      confirmMsg = dialog.message();
      dialog.dismiss(); // Cancel import
    });

    // Open File Dropdown first
    // Mobile Check: If file dropdown is hidden, we might need to open mobile menu?
    // Actually, File Dropdown is usually in the top bar. On mobile it might be hidden or collapsed.
    // If #fileDropdownBtn is not visible, try opening #mobileMenuBtn first (if it exists)
    if (!await page.locator('#fileDropdownBtn').isVisible()) {
      const mobileBtn = page.locator('#mobileMenuBtn');
      if (await mobileBtn.isVisible()) {
        await mobileBtn.click();
      }
    }
    await page.click('#fileDropdownBtn');
    await expect(page.locator('#fileDropdownMenu')).toBeVisible();
    await page.click('#importBtn');

    expect(confirmMsg).toContain('unsaved changes');

    // 4. Undo and Verify Clean State
    // Click outside to close dropdown if needed, or just press Undo
    await page.locator('body').click();
    await page.keyboard.press('Meta+z');

    // Now clicking Import should NOT warn about unsaved changes.
    // It should prompt for JSON input immediately.
    let promptMsg = '';
    page.once('dialog', dialog => {
      promptMsg = dialog.message();
      dialog.dismiss(); // Cancel input
    });

    if (!await page.locator('#fileDropdownBtn').isVisible()) {
      const mobileBtn = page.locator('#mobileMenuBtn');
      if (await mobileBtn.isVisible()) {
        await mobileBtn.click();
      }
    }
    await page.click('#fileDropdownBtn'); // Re-open dropdown
    await expect(page.locator('#fileDropdownMenu')).toBeVisible();
    await page.click('#importBtn');

    // The prompt message is "Paste pattern JSON here:"
    expect(promptMsg).toContain('Paste pattern JSON');
    expect(promptMsg).not.toContain('unsaved changes');
  });

  /*
   * Share Pattern
   */
  test('Share Pattern: Auth Check', async ({ page }) => {
    // 1. Unauthenticated (Default)
    // Clicking share should trigger alert
    page.once('dialog', dialog => {
      expect(dialog.message()).toContain('Please sign in');
      dialog.accept();
    });

    // Mobile Handling
    if (await page.locator('#mobileMenuBtn').isVisible()) {
      const menu = page.locator('#headerMenu');
      if (!await menu.evaluate(el => el.classList.contains('open'))) {
        await page.click('#mobileMenuBtn');
      }
    }

    await page.click('#shareBtn');
  });

});
