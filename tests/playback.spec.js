// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Playback & Controls', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('Play Start/Stop', async ({ page }) => {
    const playBtn = page.locator('#playBtn-A');

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
    const bpmInput = page.locator('#bpmInput-A');
    const bpmVal = page.locator('#bpmVal-A');

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

  /* 
   * Looping 
   */
  test('Looping: Playback cycles correctly', async ({ page }) => {
    // Setup: 1 measure.
    // Set BPM slower to ensure Playwright catches the class change
    await page.fill('#bpmInput-A', '60');
    await page.evaluate(() => {
      const bpm = document.getElementById('bpmInput-A');
      if (bpm) { bpm.value = '60'; bpm.dispatchEvent(new Event('input')); }
    });

    // Start Playback
    await page.click('#playBtn-A');

    // Verify playback started (button text change from ► to ⏹ or class active)
    await expect(page.locator('#playBtn-A')).toHaveClass(/active/);

    // Spy on the step update hook
    await page.evaluate(() => {
      window.__testStepLog = [];
      // Hook into the player's external callback (or overwrite it if existing matches)
      // noteplayer.js calls updatePresentationView(step) inside tick()
      window.updatePresentationView = (s) => window.__testStepLog.push(s);
    });

    // Wait enough time for >1 loop (8 steps * 500ms = 4s). Wait 6s.
    await page.waitForTimeout(6000);

    // Analyze steps
    const steps = await page.evaluate(() => window.__testStepLog);

    // Check progression
    expect(steps.length).toBeGreaterThan(5);
    // Check wrapping (should see 0 after 7, or similar)
    const hasWrap = steps.some((s, i) => i > 0 && s < steps[i - 1]);
    expect(hasWrap).toBe(true, 'Sequencer did not wrap/loop');
  });

  /* 
   * Sample Loading 
   */
  test('Sample Loading: Assets load check', async ({ page }) => {
    // We monitor network requests to ensure audio files return 200
    // and that no console errors occurred regarding audio.

    const failedRequests = [];
    page.on('requestfailed', request => {
      if (request.url().endsWith('.wav')) failedRequests.push(request.url());
    });

    const responses = [];
    page.on('response', response => {
      if (response.url().endsWith('.wav')) {
        if (response.status() !== 200 && response.status() !== 304) {
          failedRequests.push(`${response.url()} [${response.status()}]`);
        }
      }
    });

    // Trigger audio unlock/load
    // Clicking play usually unlocks audio context and loads samples
    await page.click('#playBtn-A');

    // Wait a bit for loading
    await page.waitForTimeout(2000);

    if (failedRequests.length > 0) {
      console.error('Failed Audio Requests:', failedRequests);
    }
    expect(failedRequests).toEqual([]);

    // Also check if SCALES are defined (implied but good to check)
    const scales = await page.evaluate(() => window.SCALES);
    expect(scales).toBeTruthy();
    expect(Object.keys(scales).length).toBeGreaterThan(0);
  });

});
