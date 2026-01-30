// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Import / Export Features', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  /*
   * Export / Import
   */
  test('Export / Import: JSON Roundtrip', async ({ page, context, browserName }) => {
    // Clipboard API in headless WebKit/Firefox is restrictive/flaky regarding permissions and mocking.
    // We rely on Chromium for verified coverage. (Update: Firefox enabled via prefs)

    // Grant clipboard permissions to ensure stable behavior (Chromium only)
    if (browserName === 'chromium') {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    }

    // WebKit clipboard API is often flaky/restricted in headless.
    test.skip(browserName === 'webkit', 'Clipboard API unstable in headless WebKit');

    // 1. Setup Pattern
    await page.click('#clearBtn-A');
    const cell0 = page.locator('.cell').nth(0);
    await cell0.click();
    await page.keyboard.press('1'); // Set first cell to "1"

    // Open Mobile Menu if needed
    if (await page.locator('#mobileMenuBtn').isVisible()) {
      const menu = page.locator('#headerMenu');
      if (!await menu.evaluate(el => el.classList.contains('open'))) {
        await page.click('#mobileMenuBtn');
      }
    }

    // Open File Dropdown first to ensure buttons are visible
    if (await page.locator('#fileDropdownBtn').isVisible()) {
      await page.click('#fileDropdownBtn');
    }

    // 2. EXPORT
    let exportedData = '';

    // We listen for dialogs.
    // Case A: Clipboard write fails -> Prompt with data.
    // Case B: Clipboard write succeeds -> Alert "copied to clipboard".
    page.on('dialog', async dialog => {
      const msg = dialog.message();
      if (msg.includes('Copy this JSON')) {
        exportedData = dialog.defaultValue();
        await dialog.accept();
      }
      else if (msg.includes('Pattern JSON copied')) {
        await dialog.accept();
      }
      // Handle Import prompt
      else if (msg.includes('Paste pattern JSON')) {
        await dialog.accept(exportedData);
      }
      else if (msg.includes('Save this pattern')) {
        await dialog.dismiss();
      }
      else if (msg.includes('unsaved changes')) {
        await dialog.accept(); // Discard allowed
      }
      else {
        await dialog.accept();
      }
    });

    await page.click('#exportBtn');

    // If exportedData is still empty, it means clipboard write likely succeeded.
    // Let's try to read it from clipboard.
    if (!exportedData) {
      try {
        exportedData = await page.evaluate(async () => {
          return await navigator.clipboard.readText();
        });
      } catch (e) {
        console.log('Clipboard read failed:', e);
      }
    }

    expect(exportedData).toContain('"version":');
    expect(exportedData).toContain('"steps":');

    // Close menus to unblock clearBtn
    if (await page.locator('#fileDropdownBtn').isVisible()) {
      // Close dropdown if open
      const menu = page.locator('#fileDropdownMenu');
      if (await menu.isVisible()) await page.click('#fileDropdownBtn');
    }
    if (await page.locator('#mobileMenuBtn').isVisible()) {
      const menu = page.locator('#headerMenu');
      if (await menu.evaluate(el => el.classList.contains('open'))) {
        await page.click('#mobileMenuBtn');
      }
    }

    // 3. CLEAR GRID
    await page.click('#clearBtn-A');
    await expect(cell0.locator('.inner')).toBeEmpty();

    // 4. IMPORT
    // Open Mobile Menu if needed (it was closed earlier)
    if (await page.locator('#mobileMenuBtn').isVisible()) {
      const menu = page.locator('#headerMenu');
      if (!await menu.evaluate(el => el.classList.contains('open'))) {
        await page.click('#mobileMenuBtn');
      }
    }

    // Open dropdown again if needed
    if (await page.locator('#fileDropdownBtn').isVisible()) {
      const menu = page.locator('#fileDropdownMenu');
      if (!await menu.isVisible()) await page.click('#fileDropdownBtn');
    }

    await page.click('#importBtn');

    // 5. VERIFY
    await expect(cell0.locator('.inner')).toHaveText('1');
  });

});
