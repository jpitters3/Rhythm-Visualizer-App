// @ts-check
const { test, expect } = require('@playwright/test');
const { gotoStudio } = require('./helpers');

test.describe('Tap vs long-press cell selection', () => {

  test.beforeEach(async ({ page }) => {
    await gotoStudio(page);
    await page.waitForSelector('.measure-row');
    await page.click('#clearBtn-A');
    await page.locator('#confirmModal.open').waitFor({ timeout: 5000 });
    await page.click('#confirmOkBtn');
  });

  test('Quick tap/click selects the cell', async ({ page, isMobile }) => {
    const cell0 = page.locator('.cell').nth(0);
    await cell0.click();

    await expect(cell0).toHaveClass(/selected/);

    if (isMobile) {
      // Touch: a quick tap must NOT open the selection menu — only a
      // long-press does. Otherwise every tap-to-write hides the handpan.
      await expect(page.locator('#selectionTools')).not.toHaveClass(/visible/);
    } else {
      // Desktop: a mouse click has always opened the selection menu
      // directly — there's no long-press gesture to fall back on there.
      await expect(page.locator('#selectionTools')).toHaveClass(/visible/);
      await expect(page.locator('#selBarText')).toHaveText('1 selected');
    }

    // Playing a handpan note should still write into the tapped cell. This
    // can trigger the one-time guest "sign in to save" nudge, which
    // gotoStudio()'s addLocatorHandler auto-dismisses before the next action.
    await page.locator('.hp-dot[data-note="1"]').click({ force: true });
    await expect(cell0.locator('.inner')).toHaveText('1');
  });

  test('Long-press then drag opens the selection menu with the dragged range', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Uses page.mouse — see mobile-specific coverage separately if needed');

    const cellA = page.locator('.cell').nth(3);
    const cellB = page.locator('.cell').nth(5);
    const boxA = await cellA.boundingBox();
    const boxB = await cellB.boundingBox();
    if (!boxA || !boxB) throw new Error('Could not locate cell bounding boxes');

    await page.mouse.move(boxA.x + boxA.width / 2, boxA.y + boxA.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(550); // clear the 450ms long-press threshold

    // Menu should already be open at this point, before any drag.
    await expect(page.locator('#selectionTools')).toHaveClass(/visible/);

    await page.mouse.move(boxB.x + boxB.width / 2, boxB.y + boxB.height / 2, { steps: 5 });
    await page.waitForTimeout(150);
    await page.mouse.up();

    await expect(page.locator('#selectionTools')).toHaveClass(/visible/);
    await expect(page.locator('#selBarText')).toHaveText('3 selected');
  });

  test('Clicking a different cell after a drag selection replaces it (does not extend it)', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Uses page.mouse — see mobile-specific coverage separately if needed');

    const cellA = page.locator('.cell').nth(3);
    const cellB = page.locator('.cell').nth(5);
    const cellC = page.locator('.cell').nth(0);
    const boxA = await cellA.boundingBox();
    const boxB = await cellB.boundingBox();
    if (!boxA || !boxB) throw new Error('Could not locate cell bounding boxes');

    await page.mouse.move(boxA.x + boxA.width / 2, boxA.y + boxA.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(550);
    await page.mouse.move(boxB.x + boxB.width / 2, boxB.y + boxB.height / 2, { steps: 5 });
    await page.waitForTimeout(150);
    await page.mouse.up();
    await expect(page.locator('#selBarText')).toHaveText('3 selected');

    await cellC.click();

    // A plain desktop click opens/replaces the selection with just the
    // clicked cell — it doesn't extend the previous drag range, but the
    // menu stays visible since a real (1-cell) selection now exists.
    await expect(page.locator('#selectionTools')).toHaveClass(/visible/);
    await expect(page.locator('#selBarText')).toHaveText('1 selected');
    await expect(page.locator('.cell.range')).toHaveCount(1);
    await expect(cellC).toHaveClass(/selected/);
  });

  test('Touch-style long-press does not toggle hand sticking', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Right-click/contextmenu simulation targets desktop mouse semantics');

    const cell0 = page.locator('.cell').nth(0);
    const initialClass = await cell0.getAttribute('class');

    // A touch long-press synthesizes a native contextmenu event with
    // button === 0 (no real mouse button pressed) — simulate that directly,
    // since Playwright's click({ button: 'right' }) always reports button 2.
    await cell0.dispatchEvent('contextmenu', { button: 0 });

    await expect(cell0).not.toHaveClass(/force-hand-l/);
    await expect(cell0).not.toHaveClass(/force-hand-r/);
    expect(await cell0.getAttribute('class')).toBe(initialClass);

    // A genuine right-click (button 2) should still work.
    await cell0.click({ button: 'right' });
    await expect(cell0).toHaveClass(/force-hand-l|force-hand-r/);
  });

});
