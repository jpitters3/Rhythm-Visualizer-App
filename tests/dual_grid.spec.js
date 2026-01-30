// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Dual Grid Functionality', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for deferred initialization (safeInit) to finish rendering the grid
    await page.waitForSelector('.measure-row');
  });

  test('Toggle Dual Mode visibility', async ({ page }) => {
    const dualModeBtn = page.locator('#dualModeBtn');
    const measuresB = page.locator('#measures-B');
    const controlsB = page.locator('#controls-B');

    // Initially hidden
    await expect(measuresB).not.toBeVisible();
    await expect(controlsB).not.toBeVisible();

    // Toggle On
    await dualModeBtn.click();
    await expect(dualModeBtn).toHaveClass(/active/);
    await expect(measuresB).toBeVisible();
    await expect(controlsB).toBeVisible();

    // Toggle Off
    await dualModeBtn.click();
    await expect(dualModeBtn).not.toHaveClass(/active/);
    await expect(measuresB).not.toBeVisible();
    await expect(controlsB).not.toBeVisible();
  });

  test('Independent Playback States', async ({ page }) => {
    await page.click('#dualModeBtn');

    const playBtnA = page.locator('#playBtn-A');
    const playBtnB = page.locator('#playBtn-B');

    // Start A
    await playBtnA.click();
    await expect(playBtnA).toHaveClass(/active/);
    await expect(playBtnB).not.toHaveClass(/active/);

    // Start B
    await playBtnB.click();
    await expect(playBtnA).toHaveClass(/active/);
    await expect(playBtnB).toHaveClass(/active/);

    // Stop A
    await playBtnA.click();
    await expect(playBtnA).not.toHaveClass(/active/);
    await expect(playBtnB).toHaveClass(/active/);
  });

  test('Independent BPM Control', async ({ page }) => {
    await page.click('#dualModeBtn');

    const bpmInputA = page.locator('#bpmInput-A');
    const bpmValA = page.locator('#bpmVal-A');
    const bpmInputB = page.locator('#bpmInput-B');
    const bpmValB = page.locator('#bpmVal-B');

    // Change A to 120
    await bpmInputA.fill('120');
    await expect(bpmValA).toHaveText('120');
    await expect(bpmValB).toHaveText('90'); // B should remain at default

    // Change B to 150
    await bpmInputB.fill('150');
    await expect(bpmValA).toHaveText('120');
    await expect(bpmValB).toHaveText('150');
  });

  test('Focus Management (activeGrid)', async ({ page }) => {
    await page.click('#dualModeBtn');

    // Click inside Grid B
    // We need to click a cell in measures-B
    await page.locator('#measures-B .cell').first().click();

    // Verify window.activeGrid is gridB
    const activeGridId = await page.evaluate(() => window.activeGrid.id);
    expect(activeGridId).toBe('B');

    // Click inside Grid A
    await page.locator('#measures .cell').first().click();
    const activeGridIdA = await page.evaluate(() => window.activeGrid.id);
    expect(activeGridIdA).toBe('A');
  });

  test('Independent Clear Logic', async ({ page }) => {
    await page.click('#dualModeBtn');

    // Add something to Grid A
    await page.evaluate(() => {
      window.gridA.innerLabels[0] = 'D';
      window.renderAllMeasures(window.gridA);
    });
    await expect(page.locator('#measures .cell').first()).toHaveClass(/has-label/);

    // Clear Grid B
    await page.click('#clearBtn-B');
    // Grid A should still have its label
    await expect(page.locator('#measures .cell').first()).toHaveClass(/has-label/);

    // Clear Grid A
    await page.click('#clearBtn-A');
    await expect(page.locator('#measures .cell').first()).not.toHaveClass(/has-label/);
  });

});
