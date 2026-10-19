// @ts-check
const { test, expect } = require('@playwright/test');
const { gotoStudio, clearGrid } = require('./helpers');

test.describe('Measure Actions', () => {

  test.beforeEach(async ({ page }) => {
    await gotoStudio(page);
    await page.waitForSelector('.measure-row');

    await clearGrid(page, 'A');
  });

  /* 
   * 1. Measure Actions 
   */
  test('Measure Actions: Add and Delete', { tag: '@core' }, async ({ page }) => {
    // Initial state
    const getCellCount = async () => await page.locator('#measures .cell').count();

    // Wait for initial render
    await page.waitForSelector('#measures .cell');
    const initialCells = await getCellCount();
    expect(initialCells).toBeGreaterThan(0);

    // 1. ADD MEASURE
    // #addMeasureBtn (index.html) is inside .measure-group.desktop-only — a
    // second, class-only "addMeasureBtn hp-corner-btn" duplicate (no id)
    // sits in the handpan panel's corner for mobile. Both are wired by the
    // shared .addMeasureBtn class (js/measure-actions.js), so target
    // whichever is actually visible instead of the desktop-only id.
    await page.click('.addMeasureBtn:visible');

    // Wait for the new measure to appear
    const stepsPerMeasure = await page.locator('.measure-row').first().locator('.cell').count();
    const expectedCount = initialCells + stepsPerMeasure;
    await expect(page.locator('#measures .cell')).toHaveCount(expectedCount);

    // 2. DELETE MEASURE
    // Ensure the element is visible and click it
    const lastCell = page.locator('#measures .cell').last();
    await lastCell.scrollIntoViewIfNeeded();
    await lastCell.click();

    await page.click('.delMeasureBtn:visible');
    await page.locator('#confirmModal.open').waitFor({ timeout: 5000 });
    await page.click('#confirmOkBtn');

    // Verify count returned to initial
    await expect(page.locator('#measures .cell')).toHaveCount(initialCells);
  });

});
