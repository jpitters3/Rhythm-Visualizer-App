// @ts-check
const { test, expect } = require('./fixtures');
const { gotoStudio } = require('./helpers');

// js/notation-guides.js: selected-step highlight, its note on the pan, legend/hint.
test('selected step highlight, pan note and dismissable legend', { tag: '@core' }, async ({ page }) => {
  await gotoStudio(page);
  await page.waitForSelector('.measure-row');
  const legend = page.locator('.measure-row .notation-legend').first();
  await expect(legend).toContainText('Tap a step, then play a note');

  const cell = page.locator('#measures .cell').nth(1);
  await cell.click();
  await expect(cell).toHaveClass(/selected/);
  await page.keyboard.press('3');
  await cell.click();

  await expect(page.locator('.measure-row .step-highlight')).toHaveCount(1);
  await expect(page.locator('.hp-dot.step-note')).toHaveAttribute('data-note', '3');
  await expect(legend).toContainText('Left');

  await legend.getByRole('button', { name: 'Hide this guide' }).click();
  await expect(page.locator('.notation-legend')).toHaveCount(0);
  await page.reload();
  await page.waitForSelector('.measure-row');
  await expect(page.locator('.notation-legend')).toHaveCount(0);
});
