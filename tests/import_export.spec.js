// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Import / Export Features', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.measure-row');
  });

  /*
   * Export / Import
   */
  test('Export / Import: JSON Roundtrip', async ({ page, context, browserName }) => {
    // Clipboard API in headless WebKit/Firefox is restrictive/flaky regarding permissions and mocking.
    // We rely on Chromium for verified coverage.
    if (browserName === 'chromium') {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    }
    test.skip(browserName === 'webkit', 'Clipboard API unstable in headless WebKit');
    test.skip(browserName === 'firefox', 'Clipboard API unstable in headless Firefox');

    // 1. Setup Pattern
    await page.click('#clearBtn-A');
    await page.locator('#confirmModal.open').waitFor({ timeout: 5000 });
    await page.click('#confirmOkBtn');
    const cell0 = page.locator('.cell').nth(0);
    await cell0.click();
    await page.keyboard.press('1');

    // Open File Dropdown
    if (await page.locator('#mobileMenuBtn').isVisible()) {
      const menu = page.locator('#headerMenu');
      if (!await menu.evaluate(el => el.classList.contains('open'))) {
        await page.click('#mobileMenuBtn');
      }
    }
    if (await page.locator('#fileDropdownBtn').isVisible()) {
      await page.click('#fileDropdownBtn');
    }

    // 2. EXPORT
    await page.click('#exportBtn');

    // Dismiss the custom "Exported" alert modal (app uses #confirmModal, not native dialog)
    await page.locator('#confirmModal.open').waitFor({ timeout: 5000 });
    await page.click('#confirmOkBtn');

    // Read exported JSON from clipboard
    const exportedData = await page.evaluate(async () => navigator.clipboard.readText());
    expect(exportedData).toContain('"version":');
    expect(exportedData).toContain('"steps":');

    // Close menus
    if (await page.locator('#fileDropdownBtn').isVisible()) {
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
    await page.locator('#confirmModal.open').waitFor({ timeout: 5000 });
    await page.click('#confirmOkBtn');
    await expect(cell0.locator('.inner')).toBeEmpty();

    // 4. IMPORT
    if (await page.locator('#mobileMenuBtn').isVisible()) {
      const menu = page.locator('#headerMenu');
      if (!await menu.evaluate(el => el.classList.contains('open'))) {
        await page.click('#mobileMenuBtn');
      }
    }
    if (await page.locator('#fileDropdownBtn').isVisible()) {
      const menu = page.locator('#fileDropdownMenu');
      if (!await menu.isVisible()) await page.click('#fileDropdownBtn');
    }

    await page.click('#importBtn');

    // Fill the "Import Pattern" custom prompt with our exported JSON
    await page.locator('#confirmModal.open').waitFor({ timeout: 5000 });
    await page.fill('#confirmInput', exportedData);
    await page.click('#confirmOkBtn');

    // Dismiss "Import Success" modal if it appears
    const maybeSuccess = page.locator('#confirmModal.open');
    if (await maybeSuccess.isVisible()) {
      await page.click('#confirmCancelBtn');
    }

    // 5. VERIFY
    await expect(cell0.locator('.inner')).toHaveText('1');
  });

});
