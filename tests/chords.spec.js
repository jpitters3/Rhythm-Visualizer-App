// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Chords & Chords', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    page.once('dialog', dialog => dialog.accept());
    await page.click('#clearBtn');
  });

  test('Multi-Note (Chord) Entry and Playback', async ({ page }) => {
    // 1. Enter Multi-Edit Mode
    const cell0 = page.locator('.cell').nth(0);
    await cell0.dblclick();
    await expect(cell0).toHaveClass(/multi-selected/); // or multi-selected based on analysis

    // 2. Select specific sub-dots
    // In notegrid.js:
    // Left Hand: .lh-index (0), .lh-thumb (1) - LH Thumb is visible on mobile
    // Right Hand: .rh-index (2), .rh-thumb (3)

    // Let's pick Bottom-Left (lh-thumb) and Bottom-Right (rh-thumb)
    // to simulate a chord.
    const subDots = cell0.locator('.sub-dot');

    // sub-dot 1 (LH Thumb)
    await subDots.nth(1).click();
    await expect(subDots.nth(1)).toHaveClass(/selected/);
    await page.keyboard.press('1'); // Enter Note '1'
    await expect(subDots.nth(1)).toHaveText('1');

    // sub-dot 3 (RH Thumb)
    await subDots.nth(3).click();
    await expect(subDots.nth(3)).toHaveClass(/selected/);
    await page.keyboard.press('3'); // Enter Note '3'
    await expect(subDots.nth(3)).toHaveText('3');

    // 3. Verify Cell state (should show labels)
    // sub-dots updated visual text

    // 4. Start Playback
    await page.click('#playBtn');

    // 5. Verify Handpan Map Visualization
    // When playback hits step 0, both Note '1' and Note '3' should light up.

    // Locate the handpan dots
    // Assuming .hp-dot elements have data-note attributes.
    // I need to find the selector. In handpanmap.js, lookups use window.HANDPAN_MAP keys.
    // Usually '1', '2', '3'...
    // Strategy: Look for .hp-dot with specific text or title or dataset.
    // Let's assume there's a unique attribute or text.
    // If not, we might need a generic selector and filter.

    // Note: '1' is typically A3 or similar depending on scale.
    // But the ID/key in `handpanDots` map is '1', '2', etc.
    // Let's try locating by text or class if they have specific classes like 'hp-dot-1'.
    // `highlightHandpan` uses `handpanDots.get(key)`.
    // I didn't see where handpanDots are created, but likely `data-note="1"`.

    const dot1 = page.locator('.hp-dot[data-note="1"]');
    const dot3 = page.locator('.hp-dot[data-note="3"]');

    // Ensure they exist
    await expect(dot1).toBeVisible();
    await expect(dot3).toBeVisible();

    // Verify Active Class during playback
    // This is timing sensitive. Playwright retries assertions.
    // If BPM is 90, 16th notes are fast. 
    // But step 0 is the FIRST step. It should light up immediately after Play.
    // Verify Active Class during playback
    // Use Promise.all to catch transient states simultaneously
    await Promise.all([
      expect(dot1).toHaveClass(/active/),
      expect(dot3).toHaveClass(/active/)
    ]);
  });

});
