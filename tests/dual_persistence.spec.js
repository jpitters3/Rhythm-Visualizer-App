const { test, expect } = require('@playwright/test');

test.describe('Dual Grid Persistence', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:8000');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector('.cell');

    // Listen to console for debug logs
    page.on('console', msg => {
      if (msg.type() === 'log' || msg.type() === 'error') {
        console.log(`[PAGE LOG] ${msg.text()}`);
      }
    });
  });

  async function ensureHeaderMenuOpen(page) {
    const mobileMenuBtn = page.locator('#mobileMenuBtn');
    const headerMenu = page.locator('#headerMenu');
    if (await mobileMenuBtn.isVisible()) {
      const isOpen = await headerMenu.evaluate(el => el.classList.contains('open'));
      if (!isOpen) {
        await mobileMenuBtn.click();
        await page.waitForTimeout(300); // Wait for transition
      }
    }
  }

  test('should save and load a dual-grid pattern with time signature', async ({ page }) => {
    // 1. Enable Dual Mode
    await page.click('#dualModeBtn');
    await expect(page.locator('#controls-B')).toBeVisible();

    // 2. Set a custom time signature (3/4)
    await page.selectOption('#tsNum', '3');
    await page.selectOption('#tsDen', '4');

    // 3. Add notes
    const cellA0 = page.locator('#measures .cell').first();
    await cellA0.click();
    await page.keyboard.type('1');
    await expect(cellA0).toHaveText('1');

    const cellB0 = page.locator('#measures-B .cell').first();
    await cellB0.click();
    await page.keyboard.type('2');
    await expect(cellB0).toHaveText('2');

    // 4. Save
    page.on('dialog', async dialog => {
      console.log(`[DIALOG] ${dialog.message()}`);
      if (dialog.type() === 'prompt') {
        await dialog.accept('DualPersistenceTest');
      } else {
        await dialog.accept();
      }
    });

    await ensureHeaderMenuOpen(page);
    await page.click('#fileDropdownBtn');
    await page.click('#saveBtn');

    // WAIT for the pattern select to have the new option before reload
    await page.waitForFunction((val) => {
      const sel = document.querySelector('#patternSelect');
      return sel && Array.from(sel.options).some(o => o.value === val);
    }, 'DualPersistenceTest', { timeout: 5000 });

    // 5. Reload
    await page.reload();
    await page.waitForSelector('.cell');
    await page.waitForTimeout(1000);

    // 6. Select and Load
    await ensureHeaderMenuOpen(page);
    await page.waitForFunction((val) => {
      const sel = document.querySelector('#patternSelect');
      return sel && Array.from(sel.options).some(o => o.value === val);
    }, 'DualPersistenceTest', { timeout: 10000 });

    await page.selectOption('#patternSelect', 'DualPersistenceTest');
    await page.click('#fileDropdownBtn');
    await page.click('#loadBtn');

    await page.waitForTimeout(1000);

    // 7. Verification
    await expect(page.locator('#controls-B')).toBeVisible();
    await expect(page.locator('#tsNum')).toHaveValue('3');
    await expect(page.locator('#tsDen')).toHaveValue('4');
    await expect(page.locator('#measures .cell').first()).toHaveText('1');
    await expect(page.locator('#measures-B .cell').first()).toHaveText('2');
  });

  test('should hide Grid B when loading a single-grid pattern while Dual Mode is active', async ({ page }) => {
    // 1. Save a single grid pattern
    const cellA0 = page.locator('#measures .cell').first();
    await cellA0.click();
    await page.keyboard.type('1');
    await expect(cellA0).toHaveText('1');

    page.on('dialog', async dialog => {
      if (dialog.type() === 'prompt') await dialog.accept('SingleGridPattern');
      else await dialog.accept();
    });

    await ensureHeaderMenuOpen(page);
    await page.click('#fileDropdownBtn');
    await page.click('#saveBtn');

    await page.waitForFunction((val) => {
      const sel = document.querySelector('#patternSelect');
      return sel && Array.from(sel.options).some(o => o.value === val);
    }, 'SingleGridPattern', { timeout: 5000 });

    // 2. Clear reload
    await page.reload();
    await page.waitForSelector('.cell');
    await page.waitForTimeout(500);

    // 3. Enable Dual Mode manually
    await page.click('#dualModeBtn');
    await expect(page.locator('#measures-B')).toBeVisible();

    // 4. Load the single grid pattern
    await ensureHeaderMenuOpen(page);
    await page.waitForFunction((val) => {
      const sel = document.querySelector('#patternSelect');
      return sel && Array.from(sel.options).some(o => o.value === val);
    }, 'SingleGridPattern', { timeout: 10000 });

    await page.selectOption('#patternSelect', 'SingleGridPattern');
    await page.click('#fileDropdownBtn');
    await page.click('#loadBtn');

    // 5. Grid B should be hidden
    await expect(page.locator('#measures-B')).not.toBeVisible();
    await expect(page.locator('#measures .cell').first()).toHaveText('1');
  });
});
