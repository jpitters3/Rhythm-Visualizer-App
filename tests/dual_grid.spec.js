// @ts-check
const { test, expect } = require('@playwright/test');
const { gotoStudio } = require('./helpers');

test.describe('Dual Grid Functionality', () => {

  test.beforeEach(async ({ page }) => {
    await gotoStudio(page);
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

  test('Synchronized Playback States', async ({ page }) => {
    await page.click('#dualModeBtn');

    const playBtnA = page.locator('#mainTransport-A .t-play-btn');
    const playBtnB = page.locator('#mainTransport-B .t-play-btn');

    // Start A
    await playBtnA.click();
    await expect(playBtnA).toHaveClass(/active/);
    await expect(playBtnB).toHaveClass(/active/);

    // Stop A
    await playBtnA.click();
    await expect(playBtnA).not.toHaveClass(/active/);
    await expect(playBtnB).not.toHaveClass(/active/);
  });

  test('Independent BPM Control', async ({ page }) => {
    await page.click('#dualModeBtn');

    const bpmInputA = page.locator('#mainTransport-A .t-bpm-input');
    const bpmValA = page.locator('#mainTransport-A .t-bpm-val');
    const bpmInputB = page.locator('#mainTransport-B .t-bpm-input');
    const bpmValB = page.locator('#mainTransport-B .t-bpm-val');

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

    // Click inside Grid B to focus it
    await page.locator('#measures-B .cell').first().click();

    // Verify Focus by Action: Typing '1' should affect Grid B, not A
    await page.keyboard.press('1');

    // Grid B cell should have '1' (or corresponding label)
    const cellB = page.locator('#measures-B .cell').first().locator('.inner');
    await expect(cellB).toHaveText('1');

    // Grid A active cell should NOT change (it's empty by default)
    const cellA = page.locator('#measures .cell').first().locator('.inner');
    await expect(cellA).toHaveText('');

    // Click inside Grid A to focus it
    await page.locator('#measures .cell').first().click();

    // Typing '2' should affect Grid A
    await page.keyboard.press('2');
    await expect(cellA).toHaveText('2');

    // Grid B should remain '1'
    await expect(cellB).toHaveText('1');
  });

  test('Independent Clear Logic', async ({ page }) => {
    await page.click('#dualModeBtn');

    // Add something to Grid A via UI
    await page.locator('#measures .cell').first().click();
    await page.keyboard.press('d'); // Ding
    await expect(page.locator('#measures .cell').first()).toHaveClass(/has-label/);

    // Clear Grid B
    await page.click('#clearBtn-B');
    await page.locator('#confirmModal.open').waitFor({ timeout: 5000 });
    await page.click('#confirmOkBtn');
    // Grid A should still have its label
    await expect(page.locator('#measures .cell').first()).toHaveClass(/has-label/);

    // Clear Grid A
    await page.click('#clearBtn-A');
    await page.locator('#confirmModal.open').waitFor({ timeout: 5000 });
    await page.click('#confirmOkBtn');
    await expect(page.locator('#measures .cell').first()).not.toHaveClass(/has-label/);
  });

});
