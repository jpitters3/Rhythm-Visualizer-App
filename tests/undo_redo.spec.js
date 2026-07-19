// @ts-check
const { test, expect } = require('@playwright/test');
const { gotoStudio } = require('./helpers');

async function openPhraseMenu(page) {
  if (await page.locator('#mobileMenuBtn').isVisible()) {
    const menu = page.locator('#headerMenu');
    if (!await menu.evaluate(el => el.classList.contains('open'))) {
      await page.click('#mobileMenuBtn');
    }
  }
  const accountDropdown = page.locator('#accountDropdownMenu');
  if (!await accountDropdown.evaluate(el => el.classList.contains('show'))) {
    await page.click('#accountBtn');
  }
  const phraseSubmenu = page.locator('#phraseSubmenu');
  if (!await phraseSubmenu.evaluate(el => el.classList.contains('open'))) {
    await page.click('#phraseMenuBtn');
  }
}

test.describe('Undo/Redo Features', () => {

  test.beforeEach(async ({ page }) => {
    await gotoStudio(page);
    await page.waitForSelector('.measure-row');
  });

  test('Undo/Redo Note Entry', async ({ page }) => {
    // 1. Initial State: grid empty
    // (Assuming default empty grid or we clear it)
    await page.click('#clearBtn-A');
    await page.locator('#confirmModal.open').waitFor({ timeout: 5000 });
    await page.click('#confirmOkBtn');

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
    await page.locator('#confirmModal.open').waitFor({ timeout: 5000 });
    await page.click('#confirmOkBtn');

    // 2. Make change
    await page.locator('.cell').nth(0).click();
    await page.keyboard.press('1');

    // 3. Verify Dirty State via Import Prompt
    // App uses custom #confirmModal (not native browser dialog)
    await openPhraseMenu(page);
    await page.click('#importBtn');

    // Should show "Unsaved Changes" custom confirm modal
    await page.locator('#confirmModal.open').waitFor({ timeout: 5000 });
    const confirmMsg = await page.locator('#confirmMessage').textContent();
    expect(confirmMsg.toLowerCase()).toContain('unsaved');
    await page.click('#confirmCancelBtn'); // Cancel import

    // 4. Undo and Verify Clean State
    await page.keyboard.press('Escape'); // ensure no modals block
    await page.keyboard.press('Meta+z');

    // Now clicking Import should show "Import Pattern" prompt directly
    await openPhraseMenu(page);
    await page.click('#importBtn');

    // Should go straight to "Import Pattern" prompt (no unsaved changes warning)
    await page.locator('#confirmModal.open').waitFor({ timeout: 5000 });
    const promptTitle = await page.locator('#confirmTitle').textContent();
    expect(promptTitle).toContain('Import Pattern');
    await page.click('#confirmCancelBtn'); // Cancel without importing
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

    await openPhraseMenu(page);
    await page.click('#shareBtn');
  });

});
