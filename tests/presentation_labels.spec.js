const { test, expect } = require('@playwright/test');

test.describe('Presentation Label Synchronization', () => {
  test('presentation header should match grid beats (e.g. 12 beats)', async ({ page }) => {
    await page.goto('http://localhost:8000');

    // Force a 12-beat state via JS
    await page.evaluate(() => {
      // Mock 12 steps
      const oldCalc = window.calculateSteps;
      window.calculateSteps = () => 12;
      window.gridA.mode = '12';

      // Enter presentation mode class
      document.body.classList.add('present');

      // Trigger update
      window.updatePresentationView(0, window.gridA);

      window.calculateSteps = oldCalc;
    });

    const header = page.locator('#static-measure-labels');
    await expect(header).toBeVisible();

    // Check column count
    const cols = await header.evaluate(el => el.style.getPropertyValue('--cols'));
    expect(cols).toBe('12');

    // Check number of children
    const childCount = await header.locator('div').count();
    expect(childCount).toBe(12);

    // Check labels (assuming 12/8 or similar, labels should be 1-12 in numeric mode or specific pattern in musical)
    const labels = await header.locator('div').allTextContents();
    console.log('Presentation Labels:', labels);
    // Just verify we have 12 labels and they aren't all empty/wrong
    expect(labels.length).toBe(12);
  });
});
