// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Rhythm Visualizer Features', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('Undo/Redo Note Entry', async ({ page }) => {
    // 1. Initial State: grid empty
    // (Assuming default empty grid or we clear it)
    await page.click('#clearBtn');

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

  test('Hand Sticking Flip', async ({ page }) => {
    const cell0 = page.locator('.cell').nth(0);

    // 1. Right Click to set Hand 'R'
    await cell0.click({ button: 'right' });
    await expect(cell0).toHaveClass(/hand-r/);

    // 2. Undo
    await page.keyboard.press('Meta+z');
    await expect(cell0).not.toHaveClass(/force-hand-r/);

    // 3. Redo
    await page.keyboard.press('Meta+Shift+z');
    await expect(cell0).toHaveClass(/hand-r/);
  });

  test('Data Loss Prevention', async ({ page }) => {
    // 1. Clean state
    await page.click('#clearBtn');

    // 2. Make change
    await page.locator('.cell').nth(0).click();
    await page.keyboard.press('1');

    // 3. Try to load (Mock confirm)
    page.on('dialog', dialog => {
      expect(dialog.message()).toContain('Unsaved changes');
      dialog.accept(); // Discard changes
    });

    // Trigger load (simulating prompt/import)
    // Actually, simpler to test "Import" button flow if possible, 
    // or just toggle a sidebar lesson if sidebar is open.
    // Let's assume Import button click with a prompt mock?
    // Too complex for basic test.

    // Let's test the `hasUnsavedChanges` function directly via evaluate
    const dirty = await page.evaluate(() => window.hasUnsavedChanges());
    expect(dirty).toBeTruthy();

    // Undo
    await page.keyboard.press('Meta+z');
    const clean = await page.evaluate(() => window.hasUnsavedChanges());
    expect(clean).toBeFalsy();
  });

});
