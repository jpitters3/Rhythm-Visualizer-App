const { test, expect } = require('@playwright/test');
const { gotoStudio, clearGrid, closeMobileControlsIfNeeded, setBpm } = require('./helpers');

test.describe('Handpan Pulse Animations', () => {

  test.beforeEach(async ({ page }) => {
    await gotoStudio(page);
    await page.waitForSelector('.cell');
    await clearGrid(page, 'A');
    // Restore the handpan — clearGrid needed the controls panel open on
    // mobile, which relocates into (and hides) the handpan's own slot, and
    // every test here taps .hp-dot.
    await closeMobileControlsIfNeeded(page);
  });

  test('Grid A playback triggers pulses on handpan', async ({ page }) => {
    // 1. Set very slow BPM (30 BPM = 2 steps per second = 500ms intervals)
    // Pulse will last ~450ms, making it easy for Playwright to catch.
    await setBpm(page, 40, '#mainTransport-A');

    // 2. Enter notes '1' and '2'
    const cell0 = page.locator('#measures .cell').first();
    const cell1 = page.locator('#measures .cell').nth(1);

    await cell0.click();
    await page.keyboard.type('1');
    await cell1.click();
    await page.keyboard.type('2');

    // Reset caret to 0 so playback starts from the beginning
    await cell0.click();

    // 3. Start playback
    const playBtn = page.locator('#mainTransport-A .t-play-btn');
    await playBtn.click();
    await expect(playBtn).toHaveClass(/active/);

    // 4. Verify pulse occurs on note 1
    const note1Dot = page.locator('.hp-dot[data-note="1"]');
    // For firefox testing, wait up to 10s.
    await expect(note1Dot).toHaveClass(/active/, { timeout: 10000 });

    // 5. Verify pulse occurs on note 2
    const note2Dot = page.locator('.hp-dot[data-note="2"]');
    await expect(note2Dot).toHaveClass(/active/, { timeout: 10000 });

    // 6. Stop playback
    await playBtn.click();
    await expect(playBtn).not.toHaveClass(/active/);
  });

  test('Compose Mode: Manual note entry should NOT trigger pulse', async ({ page }) => {
    const note1Dot = page.locator('.hp-dot[data-note="1"]');

    // Focus first cell
    await page.locator('#measures .cell').first().click();

    // Type note
    await page.keyboard.type('1');

    // Wait a bit and verify NO active class (as per user request)
    await page.waitForTimeout(300);
    await expect(note1Dot).not.toHaveClass(/active/);
  });

});
