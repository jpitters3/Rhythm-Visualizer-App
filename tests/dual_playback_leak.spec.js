const { test, expect } = require('@playwright/test');

test.describe('Dual Grid Playback Leak', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.cell');
  });

  test('Grid B should NOT play when Dual Mode is OFF', async ({ page }) => {
    // Ensure Dual Mode is OFF
    const measuresB = page.locator('#measures-B');
    await expect(measuresB).not.toBeVisible();

    // Add a note to Grid B to make it audible (if it were playing)
    // We need to enable it momentarily to add the note
    await page.click('#dualModeBtn');
    const cellB0 = page.locator('#measures-B .cell').first();
    await cellB0.click();
    await page.keyboard.type('1');
    await expect(cellB0).toHaveText('1');

    // Disable Dual Mode
    await page.click('#dualModeBtn');
    await expect(measuresB).not.toBeVisible();

    // Start Grid A
    const playBtnA = page.locator('#mainTransport-A .t-play-btn');
    await playBtnA.click();
    await expect(playBtnA).toHaveClass(/active/);

    // Grid B's play button (even if hidden) should NOT be active
    const playBtnB = page.locator('#mainTransport-B .t-play-btn');
    // Note: It might be hidden, but we can check the class
    await expect(playBtnB).not.toHaveClass(/active/);

    // Verify Grid B state via UI
    await expect(page.locator('#mainTransport-B .t-play-btn')).not.toHaveClass(/active/);
  });

  test('Grid B should STOP playing when Dual Mode is toggled OFF', async ({ page }) => {
    // Enable Dual Mode
    await page.click('#dualModeBtn');
    await expect(page.locator('#measures-B')).toBeVisible();

    // Start Grid A (should sync to B)
    const playBtnA = page.locator('#mainTransport-A .t-play-btn');
    const playBtnB = page.locator('#mainTransport-B .t-play-btn');

    await playBtnA.click();
    await expect(playBtnActive(playBtnA)).toBeTruthy();
    await expect(playBtnActive(playBtnB)).toBeTruthy();

    // Disable Dual Mode while playing
    await page.click('#dualModeBtn');
    await expect(page.locator('#measures-B')).not.toBeVisible();

    // Grid B's button should stop
    const playBtnBAfter = page.locator('#mainTransport-B .t-play-btn');
    await expect(playBtnBAfter).not.toHaveClass(/active/);

    // Grid A should keep playing
    await expect(playBtnA).toHaveClass(/active/);
  });
});

function playBtnActive(locator) {
  return locator.evaluate(el => el.classList.contains('active'));
}
