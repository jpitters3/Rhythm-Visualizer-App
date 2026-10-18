// @ts-check
const { test, expect } = require('@playwright/test');
const { gotoStudio, clearGrid } = require('./helpers');

test.describe('Grid Mechanics', () => {

  // Helper for mobile menu
  async function ensureMenuClosed(page) {
    if (await page.locator('#mobileMenuBtn').isVisible()) {
      const menu = page.locator('#appNav');
      const isOpen = await menu.evaluate(el => el.classList.contains('open'));
      if (isOpen) {
        await page.click('#mobileMenuBtn');
        await expect(menu).not.toHaveClass(/open/);
      }
    }
  }

  test.beforeEach(async ({ page }) => {
    await gotoStudio(page);
    await page.waitForSelector('.measure-row');
    await ensureMenuClosed(page);
    await clearGrid(page, 'A');
  });

  test('Range Selection', async ({ page }) => {
    const cell0 = page.locator('.cell').nth(0);
    const cell2 = page.locator('.cell').nth(2);

    // 1. Click start
    await cell0.click();
    await expect(cell0).toHaveClass(/selected/);

    // 2. Shift+Click end
    await page.keyboard.down('Shift');
    await cell2.click();
    await page.keyboard.up('Shift');

    // 3. Verify Range (0, 1, 2 should be selected)
    await expect(cell0).toHaveClass(/range/);
    await expect(page.locator('.cell').nth(1)).toHaveClass(/range/);
    await expect(cell2).toHaveClass(/range/);
  });

  test('Note Entry Types', async ({ page }) => {
    const cell = page.locator('.cell').nth(0);
    await cell.click();

    // D = Ding
    await page.keyboard.type('d');
    await expect(cell.locator('.inner')).toHaveText('D');
    await expect(cell).toHaveClass(/label-ding/);

    // T = Tak
    await page.keyboard.type('t');
    await expect(cell.locator('.inner')).toHaveText('T');
    await expect(cell).toHaveClass(/label-t/); // Assuming logic replaces class

    // S = Slap
    await page.keyboard.type('s');
    await expect(cell.locator('.inner')).toHaveText('S');
  });

  test('Copy and Paste', async ({ page }) => {
    // Meta = Command on macOS but the Windows key on Linux (where CI runs),
    // which doesn't trigger copy/paste there — use the actual OS-correct
    // modifier instead of hardcoding one.
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

    // 1. Setup: Cell 0 = '1', Cell 1 = '2'
    const c0 = page.locator('.cell').nth(0);
    const c1 = page.locator('.cell').nth(1);
    await c0.click(); await page.keyboard.type('1');
    await c1.click(); await page.keyboard.type('2');

    // 2. Select Range
    await c0.click();
    await page.keyboard.down('Shift');
    await c1.click();
    await page.keyboard.up('Shift');

    // 3. Copy
    await page.keyboard.press(`${mod}+c`);

    // 4. Move to Cell 4
    const c4 = page.locator('.cell').nth(4);
    await c4.click();

    // 5. Paste
    await page.keyboard.press(`${mod}+v`);

    // 6. Verify
    const c5 = page.locator('.cell').nth(5);
    await expect(c4.locator('.inner')).toHaveText('1');
    await expect(c5.locator('.inner')).toHaveText('2');
  });

});
