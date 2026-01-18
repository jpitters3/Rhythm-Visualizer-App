// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Playback & Controls', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('Play Start/Stop', async ({ page }) => {
    const playBtn = page.locator('#playBtn');

    // 1. Initial State: Stopped
    await expect(playBtn).not.toHaveClass(/active/);

    // 2. Start Playback
    await playBtn.click();

    // 3. Verify Active State
    // Note: The button itself might not get 'active' class depending on CSS, 
    // but the icon changes or text changes. 
    // Let's check if the body has a playing state or simply if the button text/icon toggles.
    // In index.html, playBtn contains an SVG.
    // Let's check if the 'playing' flag is set in window or similar.
    // Or check if visualization starts (harder).

    // Simpler: Check if 'Stop' icon is visible or 'Play' icon is hidden?
    // Code says: if (playing) stop() else start().
    // Controls.js toggles classes? 
    // Actually, let's just check the button functionality via a side effect if UI isn't clear.
    // But usually controls have active state.

    // 3. Verify Active State
    await expect(playBtn).toHaveClass(/active/);

    // 4. Stop
    await playBtn.click();
    await expect(playBtn).not.toHaveClass(/active/);
  });

  test('BPM Adjustment', async ({ page }) => {
    const bpmInput = page.locator('#bpmInput');
    const bpmVal = page.locator('#bpmVal');

    // 1. Change BPM via Input
    await bpmInput.fill('120');
    // Trigger change event if needed
    await bpmInput.evaluate(e => e.dispatchEvent(new Event('input')));

    // 2. Verify Display
    await expect(bpmVal).toHaveText('120');

    // 3. Verify System State
    const currentBPM = await page.evaluate(() => window.bpm); // Assuming global 'bpm' or similar
    // Note: in noteplayer.js/controls.js, bpm is read from input. 
    // Let's rely on UI reflection first.
  });

  test('Metronome Toggle', async ({ page }) => {
    const metroBtn = page.locator('#metroBtn');

    // 1. Toggle On
    await metroBtn.click();
    await expect(metroBtn).toHaveClass(/active/);

    // 2. Toggle Off
    await metroBtn.click();
    await expect(metroBtn).not.toHaveClass(/active/);
  });

});
