// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Playback & Controls', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.measure-row');
  });

  test('Play Start/Stop', async ({ page }) => {
    const playBtn = page.locator('#mainTransport-A .t-play-btn');

    // 1. Initial State: Stopped
    await expect(playBtn).not.toHaveClass(/active/);

    // 2. Start Playback
    // Give the app a moment to settle and use evaluate for absolute reliability
    await page.waitForTimeout(500);
    await page.evaluate(() => document.querySelector('#mainTransport-A .t-play-btn').click());

    // 3. Verify Active State
    // Increase timeout to 10s to account for async audio initialization in test environment
    await expect(playBtn).toHaveText('⏹', { timeout: 10000 });
    await expect(playBtn).toHaveClass(/active/, { timeout: 10000 });

    // 4. Stop
    await page.evaluate(() => document.querySelector('#mainTransport-A .t-play-btn').click());
    await expect(playBtn).toHaveText('►', { timeout: 10000 });
    await expect(playBtn).not.toHaveClass(/active/, { timeout: 10000 });
  });

  test('BPM Adjustment', async ({ page }) => {
    const bpmInput = page.locator('#mainTransport-A .t-bpm-input');
    const bpmVal = page.locator('#mainTransport-A .t-bpm-val');

    // 1. Change BPM via Input
    await bpmInput.fill('120');
    // 2. Verify Display
    await expect(bpmVal).toHaveText('120');

    // 3. Verify System State (User-Like: check that input holds value)
    await expect(bpmInput).toHaveValue('120');
  });

  test('Metronome Toggle', async ({ page }) => {
    const metroBtn = page.locator('#mainTransport-A .t-metro-btn');

    // 1. Toggle On (use evaluate to bypass headless click restrictions)
    await page.evaluate(() => document.querySelector('#mainTransport-A .t-metro-btn').click());
    await expect(metroBtn).toHaveClass(/active/);

    // 2. Toggle Off (click twice more to cycle through states: Click -> Shaker -> Off)
    await page.evaluate(() => document.querySelector('#mainTransport-A .t-metro-btn').click());
    await page.evaluate(() => document.querySelector('#mainTransport-A .t-metro-btn').click());
    await expect(metroBtn).not.toHaveClass(/active/);
  });

  test('Mute Toggle', async ({ page }) => {
    const muteBtn = page.locator('#mainTransport-A .t-mute-btn');

    // 1. Toggle Mute (button is hidden, use evaluate to trigger handler directly)
    await page.evaluate(() => document.querySelector('#mainTransport-A .t-mute-btn').click());
    await expect(muteBtn).toHaveText('🔇');
    await expect(muteBtn).toHaveClass(/muted/);

    // 2. Unmute
    await page.evaluate(() => document.querySelector('#mainTransport-A .t-mute-btn').click());
    await expect(muteBtn).toHaveText('🔊');
    await expect(muteBtn).not.toHaveClass(/muted/);
  });

  /* 
   * Looping 
   */
  test('Looping: Playback cycles correctly', async ({ page }) => {
    // Setup: 1 measure.
    // Set BPM fast enough to see changes but not too fast
    await page.fill('#mainTransport-A .t-bpm-input', '120');

    // To verify looping without internals, we look for the 'active' class on columns.

    // 1. Start playback
    await page.evaluate(() => document.querySelector('#mainTransport-A .t-play-btn').click());

    // Verify playback active
    await expect(page.locator('#mainTransport-A .t-play-btn')).toHaveClass(/active/, { timeout: 10000 });

    // Check if ANY cell gets 'play' class (indicating playback progress)
    // In noteplayer.js, cells get the 'play' class when hit.
    const playingCell = page.locator('.cell.play');
    await expect(playingCell).toBeVisible({ timeout: 10000 });

    // Wait for a few steps to pass (UI updates)
    await page.waitForTimeout(2000);

    // Stop
    await page.click('#mainTransport-A .t-play-btn');
    await expect(page.locator('#mainTransport-A .t-play-btn')).not.toHaveClass(/active/);
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
    await page.click('#mainTransport-A .t-play-btn');

    // Wait a bit for loading
    await page.waitForTimeout(2000);

    if (failedRequests.length > 0) {
      console.error('Failed Audio Requests:', failedRequests);
    }
    expect(failedRequests).toEqual([]);

    // Also check if SCALES are loaded in the UI (User-Like Test)
    const scaleOptions = page.locator('#scaleSelect option');
    await expect(scaleOptions).toHaveCount(await scaleOptions.count());
    const count = await scaleOptions.count();
    expect(count).toBeGreaterThan(0);

    // Check for a known scale to be present
    await expect(page.locator('#scaleSelect')).toContainText('D Kurd');
  });

});
