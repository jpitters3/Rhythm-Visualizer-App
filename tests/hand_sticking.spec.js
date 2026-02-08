// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Hand Sticking Mechanics', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.measure-row');
    await page.click('#clearBtn-A');
  });

  test('Right-click toggles hand sticking (skips redundant state)', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Right-click not available on mobile');
    const cell0 = page.locator('.cell').nth(0); // Usually 'R' (downbeat)
    const cell1 = page.locator('.cell').nth(1); // Usually 'L' (upbeat)

    // Verify initial effective hands
    await expect(cell0).toHaveClass(/downbeat/); // Red
    await expect(cell1).toHaveClass(/upbeat/);   // Blue

    // 1. Right Click cell 0 (R -> L)
    await cell0.click({ button: 'right' });
    await expect(cell0).toHaveClass(/force-hand-l/);
    await expect(cell0).not.toHaveClass(/downbeat/);

    // 2. Right Click cell 1 (L -> R)
    await cell1.click({ button: 'right' });
    await expect(cell1).toHaveClass(/force-hand-r/);
    await expect(cell1).not.toHaveClass(/upbeat/);

    // 3. Right Click again to reset to auto
    await cell0.click({ button: 'right' });
    await expect(cell0).not.toHaveClass(/manual-hand/);
    await expect(cell0).toHaveClass(/downbeat/);
  });

  test('Hand Sticking flip undo/redo', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Right-click not available on mobile');
    const cell0 = page.locator('.cell').nth(0); // auto R

    // 1. Right Click to set Hand 'L' (auto was R)
    await cell0.click({ button: 'right' });
    await expect(cell0).toHaveClass(/force-hand-l/);

    // 2. Undo
    await page.keyboard.press('Meta+z');
    await expect(cell0).not.toHaveClass(/manual-hand/);
    await expect(cell0).toHaveClass(/downbeat/); // back to R

    // 3. Redo
    await page.keyboard.press('Meta+Shift+z');
    await expect(cell0).toHaveClass(/force-hand-l/);
  });

  test('Flip hands button', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Right-click not available on mobile');
    const cell0 = page.locator('.cell').nth(0); // auto R

    // Enter sticking mode to show the flip button
    await page.click('#stickingBtn');
    const flipBtn = page.locator('#flipHandsBtn');
    await expect(flipBtn).toBeVisible();

    // 1. Change first cell to 'L' (manual)
    await cell0.click({ button: 'right' });
    await expect(cell0).toHaveClass(/force-hand-l/);

    // 2. Click Flip hands (should flip L -> R)
    await flipBtn.click();
    await expect(cell0).toHaveClass(/force-hand-r/);

    // 3. Undo
    await page.keyboard.press('Meta+z');
    await expect(cell0).toHaveClass(/force-hand-l/);
  });

  test('Right-click multi-note cell does NOT select it', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Right-click not available on mobile');
    const cell0 = page.locator('.cell').nth(0);
    const cell1 = page.locator('.cell').nth(1);

    // 1. Setup: Cell 0 is a multi-note cell (chord)
    // Double click to enter multi-mode
    await cell0.dblclick();
    await expect(cell0).toHaveClass(/multi-selected/);

    // Set some sub-notes manually via UI to make it a real chord
    const sub0 = cell0.locator('.sub-dot').nth(0);
    await sub0.click();
    await page.keyboard.press('1'); // enter a value

    // Click outside to confirm and render
    await page.locator('#measures').click();

    // Now it should be 'multi-mode' (rendered as array)
    await expect(cell0).toHaveClass(/multi-mode/);

    // 2. Select cell 1 first
    await cell1.click();

    // 3. Right-click cell 0 to toggle sticking
    await cell0.click({ button: 'right' });

    // 4. Verify sticking toggled (default R -> L)
    await expect(cell0).toHaveClass(/force-hand-l/);

    // 5. Verify cell 0 is NOT selected
    await expect(cell0).not.toHaveClass(/selected/);

    // 6. Verify selection stayed on cell 1
    await expect(cell1).toHaveClass(/selected/);
  });

});
