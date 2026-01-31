const { test, expect } = require('@playwright/test');

test.describe('12-Beat Sub-dot Styling', () => {
  test('sub-dots should be 22px when measure has 12 beats', async ({ page }) => {
    await page.goto('http://localhost:8000');

    // Set time signature to something that results in 12 beats (e.g., 3/4 with 16th grid enabled? No, 12 beats is usually 12/8 or 3/4 triplets)
    // The calculateSteps logic usually gives 12 for 3/4 triplets or 12/8.
    // Let's manually trigger a 12-beat state if possible, or just set the UI.

    // For this test, we'll look for the BPM/TimeSig controls if they exist, or just use JS to force the state for verification.
    await page.evaluate(() => {
      const ctx = window.gridA;
      ctx.mode = '12'; // Hypothetical or actual mode that triggers 12 steps
      // Or just override the calculateSteps return if needed, but let's try to set the state.
      // In this app, 12 beats might come from 3/4 + triplets.

      // Let's find a way to get s=12.
      // If we can't easily trigger it via UI in a generic way, we'll just force renderAllMeasures with a mock.
      window.gridA.innerLabels = Array(12).fill('');
      // We need to make sure getStepCountPerMeasure returns 12.
      // Let's mock calculateSteps.
      const oldCalc = window.calculateSteps;
      window.calculateSteps = () => 12;
      window.renderAllMeasures(window.gridA);
      window.calculateSteps = oldCalc;
    });

    const subDot = page.locator('.twelve-beats .sub-dot').first();
    await expect(subDot).toBeVisible();

    const size = await subDot.evaluate(el => ({
      width: window.getComputedStyle(el).width,
      height: window.getComputedStyle(el).height
    }));

    expect(size.width).toBe('22px');
    expect(size.height).toBe('22px');
  });
});
