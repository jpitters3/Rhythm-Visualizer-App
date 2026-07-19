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

  // Writing the first note while signed out triggers a one-time "you're not
  // signed in" confirm dialog (same #confirmModal used by clearBtn above).
  // Dismiss it if it shows up so it doesn't block subsequent interactions.
  async function dismissGuestNoticeIfShown(page) {
    const cancelBtn = page.locator('#confirmCancelBtn');
    if (await cancelBtn.isVisible().catch(() => false)) {
      await cancelBtn.click();
    }
  }

  test('Quick tap selects the cell without opening the selection menu', async ({ page }) => {
    const cell0 = page.locator('.cell').nth(0);
    await cell0.click();

    await expect(cell0).toHaveClass(/selected/);
    await expect(page.locator('#selectionTools')).not.toHaveClass(/visible/);

    // Playing a handpan note should still write into the tapped cell.
    await page.locator('.hp-dot[data-note="1"]').click({ force: true });
    await dismissGuestNoticeIfShown(page);
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

  test('Tapping a different cell after a drag selection clears it (does not extend it)', async ({ page, isMobile }) => {
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

    await expect(page.locator('#selectionTools')).not.toHaveClass(/visible/);
    await expect(page.locator('.cell.range')).toHaveCount(0);
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
