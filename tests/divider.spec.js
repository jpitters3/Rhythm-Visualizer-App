// @ts-check
const { test, expect } = require('./fixtures');
const { gotoStudio } = require('./helpers');

// Mobile divider between notation and handpan (js/panel-resize.js).
test.describe('Panel divider', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('Mobile'), 'The divider is mobile-only');
    // A full-height phone: on shorter ones the pan already sits at its minimum
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoStudio(page);
    await page.waitForSelector('.measure-row');
  });

  test('hint, keyboard ends, snapping and persistence', { tag: '@core' }, async ({ page }) => {
    const handle = page.locator('#panelResizeHandle');
    const hint = handle.locator('.panel-resize-hint');
    await expect(hint).toBeVisible();

    // Keyboard: End = smallest pan, Home = largest
    await handle.focus();
    await page.keyboard.press('End');
    await expect(handle).toHaveAttribute('aria-valuenow', '0');
    await expect(handle).toHaveAttribute('aria-valuetext', 'Notation larger');
    await expect(hint).toBeHidden();
    // Smallest: the scale/labels row steps aside for the grid
    await expect(page.locator('.hp-top-row')).toBeHidden();
    await page.keyboard.press('Home');
    await expect(handle).toHaveAttribute('aria-valuenow', '100');
    await expect(page.locator('.hp-top-row')).toBeVisible();

    // Drag to just short of halfway: it settles on the balanced point
    const panelH = async () => page.locator('.handpan-panel').evaluate(el => el.getBoundingClientRect().height);
    const maxH = await panelH();
    await page.keyboard.press('End');
    const minH = await panelH();
    const box = await handle.boundingBox();
    if (!box) throw new Error('no divider');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const towardMiddle = (maxH - minH) / 2 - 12; // panel grows as the divider moves up
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - towardMiddle / 2, { steps: 4 });
    await page.mouse.move(x, y - towardMiddle, { steps: 4 });
    await page.mouse.up();
    await expect(handle).toHaveAttribute('aria-valuenow', '50');
    await expect(handle).toHaveAttribute('aria-valuetext', 'Balanced');

    // The chosen size and the dismissed hint survive a reload
    await page.reload();
    await page.waitForSelector('.measure-row');
    await expect(handle).toHaveAttribute('aria-valuenow', '50');
    await expect(hint).toBeHidden();
  });
});
