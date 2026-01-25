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
    await page.click('#clearBtn');
  });

  /* 
   * 1. Measure Actions 
   */
  test('Measure Actions: Add and Delete', async ({ page }) => {
    // Initial state: 1 measure (1 * STEPS cells)
    const getCellCount = async () => await page.locator('.cell').count();
    const initialCells = await getCellCount();
    expect(initialCells).toBeGreaterThan(0);

    // 1. ADD MEASURE
    await page.click('#addMeasureBtn');

    // Verify count doubled (assuming 2 measures)
    const addedCells = await getCellCount();
    expect(addedCells).toBe(initialCells * 2);

    // 2. DELETE MEASURE
    // Click the last cell
    await page.locator('.cell').last().click();

    // Stub confirm to return true automatically
    await page.evaluate(() => window.confirm = () => true);

    await page.click('#delMeasureBtn');

    // Verify count returned to initial
    const finalCells = await getCellCount();
    expect(finalCells).toBe(initialCells);
  });

});
