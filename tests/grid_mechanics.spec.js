// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Grid Mechanics', () => {

  // Helper for mobile menu
  async function ensureMenuClosed(page) {
    if (await page.locator('#mobileMenuBtn').isVisible()) {
      const menu = page.locator('#headerMenu');
      const isOpen = await menu.evaluate(el => el.classList.contains('open'));
      if (isOpen) {
        await page.click('#mobileMenuBtn');
        await expect(menu).not.toHaveClass(/open/);
      }
    }
  }

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.measure-row');
    await ensureMenuClosed(page);
    await page.click('#clearBtn-A');
    await page.locator('#confirmModal.open').waitFor({ timeout: 5000 });
    await page.click('#confirmOkBtn');
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
    const isMac = process.platform === 'darwin'; // This runs in Node (Playwright), so checks host OS. 
    // Wait, browser OS matters for modifier key. 
    // Playwright `Meta` maps to Command on Mac, Control on Windows usually.
    // Let's use 'Meta' for consistent "Primary Modifier".
    // Actually, on Linux/Windows 'Meta' is Windows key. 'Control' is Ctrl.
    // 'ControlOrMeta' is a safe bet if supported, but typically tests specify.
    // Let's try 'Meta' since user is on Mac (User Info says "The USER's OS version is mac").

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
    await page.keyboard.press('Meta+c');

    // 4. Move to Cell 4
    const c4 = page.locator('.cell').nth(4);
    await c4.click();

    // 5. Paste
    await page.keyboard.press('Meta+v');

    // 6. Verify
    const c5 = page.locator('.cell').nth(5);
    await expect(c4.locator('.inner')).toHaveText('1');
    await expect(c5.locator('.inner')).toHaveText('2');
  });

});
