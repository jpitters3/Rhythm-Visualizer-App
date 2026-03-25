const { test, expect } = require('@playwright/test');

test.describe('Virtual Handpan Synchronization', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.cell');
  });

  test('Handpan pulses and virtual hands should ONLY follow Grid A', async ({ page }) => {
    // 1. Enable Dual Mode
    await page.click('#dualModeBtn');
    await expect(page.locator('#measures-B')).toBeVisible();

    // 2. Clear both grids just in case
    await page.click('#clearBtn-A');
    await page.locator('#confirmModal.open').waitFor({ timeout: 5000 });
    await page.click('#confirmOkBtn');
    await page.click('#clearBtn-B');
    await page.locator('#confirmModal.open').waitFor({ timeout: 5000 });
    await page.click('#confirmOkBtn');

    // 3. Add a note ONLY to Grid B
    const cellB0 = page.locator('#measures-B .cell').first();
    await cellB0.click();
    await page.keyboard.type('1');
    await expect(cellB0).toHaveText('1');

    // Dismiss selection tools so they don't intercept the play button click
    await page.keyboard.press('Escape');

    // 4. Start Grid B (using its specific play button)
    const playBtnB = page.locator('#mainTransport-B .t-play-btn');
    await playBtnB.click();
    await expect(playBtnB).toHaveClass(/active/);

    // 5. Verify Handpan NOT pulsing
    const hpDots = page.locator('.hp-dot');
    const activeDotsCount = await hpDots.evaluateAll(els => els.filter(el => el.classList.contains('active')).length);

    if (activeDotsCount > 0) {
      const dotClasses = await hpDots.evaluateAll(els => els.map(el => el.classList.value));
      console.log('Active dots found:', activeDotsCount);
      console.log('All dot classes:', dotClasses);
    }

    expect(activeDotsCount).toBe(0);

    // 6. Verify Virtual Hands NOT striking
    const vHands = page.locator('.v-hand');
    const strikingHandsCount = await vHands.evaluateAll(els => els.filter(el => el.classList.contains('striking')).length);
    expect(strikingHandsCount).toBe(0);

    // 7. Stop Grid B
    await playBtnB.click();

    // 8. Add a note ONLY to Grid A
    const cellA0 = page.locator('#measures .cell').first();
    await cellA0.click();
    await page.keyboard.type('2');
    await expect(cellA0).toHaveText('2');

    // Dismiss selection tools so they don't intercept the play button click
    await page.keyboard.press('Escape');

    // 9. Start Grid A
    const playBtnA = page.locator('#mainTransport-A .t-play-btn');
    await playBtnA.click();
    await expect(playBtnA).toHaveClass(/active/);

    // 10. Verify Handpan IS pulsing (wait for it)
    await expect(hpDots.filter({ hasClass: 'active' }).first()).toBeVisible({ timeout: 2000 });

    // 11. Verify Virtual Hands ARE striking
    await expect(vHands.filter({ hasClass: 'striking' }).first()).toBeVisible({ timeout: 2000 });
  });
});
