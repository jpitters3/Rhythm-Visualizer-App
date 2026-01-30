// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Measure Actions', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');

    // Clear any previous state
    page.once('dialog', dialog => dialog.accept());
    // Ensure menu closed
    if (await page.locator('#mobileMenuBtn').isVisible()) {
      const menu = page.locator('#headerMenu');
      if (await menu.evaluate(el => el.classList.contains('open'))) {
        await page.click('#mobileMenuBtn');
      }
    }
    await page.click('#clearBtn-A');
  });

  /* 
   * 1. Measure Actions 
   */
  test('Measure Actions: Add and Delete', async ({ page }) => {
    // Initial state
    const getCellCount = async () => await page.locator('#measures .cell').count();

    // Wait for initial render
    await page.waitForSelector('#measures .cell');
    const initialCells = await getCellCount();
    expect(initialCells).toBeGreaterThan(0);

    // 1. ADD MEASURE
    await page.click('#addMeasureBtn');

    // Wait for the new measure to appear
    const stepsPerMeasure = await page.evaluate(() => getStepCountPerMeasure(window.gridA));
    const expectedCount = initialCells + stepsPerMeasure;
    await expect(page.locator('#measures .cell')).toHaveCount(expectedCount);

    // 2. DELETE MEASURE
    // Ensure the element is visible and click it
    const lastCell = page.locator('#measures .cell').last();
    await lastCell.scrollIntoViewIfNeeded();
    await lastCell.click();

    // Stub confirm to return true automatically
    await page.evaluate(() => window.confirm = () => true);

    await page.click('#delMeasureBtn');

    // Verify count returned to initial
    await expect(page.locator('#measures .cell')).toHaveCount(initialCells);
  });

});
