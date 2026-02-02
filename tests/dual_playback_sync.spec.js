const { test, expect } = require('@playwright/test');

test.describe('Dual Grid Playback Synchronization', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    await page.waitForSelector('.cell');

    // Enable Dual Mode
    await page.click('#dualModeBtn');
    await expect(page.locator('#controls-B')).toBeVisible();
  });

  test('starting Grid A should also start Grid B', async ({ page }) => {
    const playBtnA = page.locator('#mainTransport-A .t-play-btn');
    const playBtnB = page.locator('#mainTransport-B .t-play-btn');

    // Initial state
    await expect(playBtnA).not.toHaveClass(/playing/);
    await expect(playBtnB).not.toHaveClass(/playing/);

    // Play A
    await playBtnA.click();

    // Both should be playing
    await expect(playBtnA).toHaveClass(/playing/);
    await expect(playBtnB).toHaveClass(/playing/);

    // Check internal state
    const isPlayingA = await page.evaluate(() => window.gridA.playing);
    const isPlayingB = await page.evaluate(() => window.gridB.playing);
    expect(isPlayingA).toBe(true);
    expect(isPlayingB).toBe(true);

    // Stop A
    await playBtnA.click();
    await expect(playBtnA).not.toHaveClass(/playing/);
    await expect(playBtnB).not.toHaveClass(/playing/);
  });

  test('stopping Grid A should also stop Grid B', async ({ page }) => {
    const playBtnA = page.locator('#mainTransport-A .t-play-btn');
    const playBtnB = page.locator('#mainTransport-B .t-play-btn');

    // Play A (starts both)
    await playBtnA.click();
    await expect(playBtnB).toHaveClass(/playing/);

    // Stop A
    await playBtnA.click();

    // Both should stop
    await expect(playBtnA).not.toHaveClass(/playing/);
    await expect(playBtnB).not.toHaveClass(/playing/);
  });

  test('playing Grid B should NOT start Grid A (unidirectional)', async ({ page }) => {
    const playBtnA = page.locator('#mainTransport-A .t-play-btn');
    const playBtnB = page.locator('#mainTransport-B .t-play-btn');

    // Play B
    await playBtnB.click();

    // Only B should be playing
    await expect(playBtnB).toHaveClass(/playing/);
    await expect(playBtnA).not.toHaveClass(/playing/);

    // Stop B
    await playBtnB.click();
    await expect(playBtnB).not.toHaveClass(/playing/);
  });
});
