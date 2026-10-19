const { test, expect } = require('@playwright/test');
const { gotoStudio, openMobileControlsIfNeeded } = require('./helpers');

test.describe('Presentation Mode', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate
    await gotoStudio(page);
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    // Wait for core UI
    await page.waitForSelector('.measure-row');

    // Mock Supabase
    await page.evaluate(() => {
      supabase = {
        auth: { getSession: async () => ({ data: { session: null }, error: null }) },
        from: () => ({
          select: () => ({
            order: () => ({
              limit: () => Promise.resolve({ data: [], error: null })
            })
          })
        })
      };
    });

    // Add 3 measures to have enough for animation checks. #addMeasureBtn
    // (index.html) is inside .measure-group.desktop-only — the real mobile
    // path is a second, class-only "addMeasureBtn hp-corner-btn" duplicate
    // (no id) in the handpan panel's corner, wired by the same shared
    // .addMeasureBtn class (js/measure-actions.js).
    await page.click('.addMeasureBtn:visible');
    await page.click('.addMeasureBtn:visible');
    await page.click('.addMeasureBtn:visible');

    await expect(page.locator('.measure-row')).toHaveCount(4);
  });

  test('should toggle presentation mode with "P" key', async ({ page }) => {
    await page.waitForTimeout(500);
    await page.keyboard.press('p');
    await expect(page.locator('body')).toHaveClass(/present/);

    await page.keyboard.press('p');
    await expect(page.locator('body')).not.toHaveClass(/present/);
  });

  test('should show/hide transport controls in presentation mode', async ({ page }) => {
    const pControls = page.locator('#presentationControls');
    await expect(pControls).not.toBeVisible();

    await page.keyboard.press('p');
    await expect(pControls).toBeVisible();

    await page.keyboard.press('p');
    await expect(pControls).not.toBeVisible();
  });

  test('should highlight active and next measures during playback', async ({ page }) => {
    await page.keyboard.press('p');

    const playBtn = page.locator('#presentationControls .t-play-btn');

    // 1. Confirm the measure with the current-measure class (row 0)
    await expect(page.locator('.measure-row').first()).toHaveClass(/current-measure/, { timeout: 5000 });

    // 2. Confirm the measure with the next-measure class (row 1)
    await expect(page.locator('.measure-row').nth(1)).toHaveClass(/next-measure/, { timeout: 5000 });

    // 3. Click the playback button
    await playBtn.scrollIntoViewIfNeeded();
    await playBtn.click();

    // 4. Confirm playing
    await expect(playBtn).toHaveClass(/playing/);

    // Cleanup
    await playBtn.scrollIntoViewIfNeeded();
    await playBtn.click();
  });

  test('should advance current measure during playback', async ({ page }) => {
    await page.keyboard.press('p');

    const playBtn = page.locator('#presentationControls .t-play-btn');
    const bpmInput = page.locator('#presentationControls .t-bpm-input');

    // 1. Increase BPM for faster transition
    await bpmInput.evaluate((el, val) => {
      el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, '220');

    // 2. Click play
    await playBtn.scrollIntoViewIfNeeded();
    await playBtn.click();
    await expect(playBtn).toHaveClass(/playing/);

    // 3. Confirm that the current measure is changing once the steps have all been played
    // Check next measure (row 1) becomes current
    await expect(page.locator('.measure-row').nth(1)).toHaveClass(/current-measure/, { timeout: 15000 });

    // Check previous measure (row 0) is no longer current
    await expect(page.locator('.measure-row').first()).not.toHaveClass(/current-measure/);

    // Cleanup
    await playBtn.scrollIntoViewIfNeeded();
    await playBtn.click();
  });

  test('should synchronize BPM between main UI and presentation mode',
    async ({ page, browserName }) => {

      const mainBpmInput = page.locator('#mainTransport-A .t-bpm-input');

      // Expected default
      await expect(mainBpmInput).toHaveValue('90');

      await page.keyboard.press('p');
      // .t-bpm-input (the range slider) is hidden under 430px width
      // (css/controls.css) in favor of .t-bpm-num — true on every viewport
      // this narrow regardless of device/isMobile, so check its value only,
      // not visibility; that's what this test actually cares about anyway.
      const presentBpmInput = page.locator('#presentationControls .t-bpm-input');
      await expect(presentBpmInput).toHaveValue('90');

      // Exit present to fill main
      await page.keyboard.press('p');
      await mainBpmInput.evaluate((el, val) => {
        el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }, '160');

      // Re-enter present and check sync
      await page.keyboard.press('p');
      await expect(presentBpmInput).toHaveValue('160');

      // Change in present and check main
      await presentBpmInput.evaluate((el, val) => {
        el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }, '110');

      await page.keyboard.press('p');
      await expect(mainBpmInput).toHaveValue('110');
    });

  test('should hide Context B controls in presentation mode', async ({ page }) => {
    await openMobileControlsIfNeeded(page);
    await page.click('#dualModeBtn');
    await expect(page.locator('#controls-B')).toBeVisible();

    await page.keyboard.press('p');
    await expect(page.locator('#controls-B')).not.toBeVisible();

    await page.keyboard.press('p');
    await expect(page.locator('#controls-B')).toBeVisible();
  });
});
