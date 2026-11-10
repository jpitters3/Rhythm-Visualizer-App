// @ts-check
const { test, expect } = require('./fixtures');
const { gotoStudio, openMobileControlsIfNeeded } = require('./helpers');

// Free play (js/free-play.js): just the pan; the grid hides and takes no notes.
test('free play hides the grid and never writes to it', { tag: '@core' }, async ({ page }) => {
  await gotoStudio(page);
  await page.waitForSelector('.measure-row');

  // A selected step would normally receive the next pan tap
  await page.locator('#measures .cell').first().click();
  await openMobileControlsIfNeeded(page);
  await page.click('.ctl-btn[data-free-play]');
  await expect(page.locator('body')).toHaveClass(/free-play/);
  await expect(page.locator('#measures')).toBeHidden();
  await expect(page.locator('.free-play-exit')).toBeVisible();

  await page.locator('.hp-dot[data-note="3"]').click({ force: true });
  await page.locator('.hp-dot[data-note="5"]').click({ force: true });

  await page.click('.free-play-exit');
  await expect(page.locator('body')).not.toHaveClass(/free-play/);
  await expect(page.locator('#measures')).toBeVisible();
  await expect(page.locator('#measures .cell .inner').first()).toHaveText('');

  // Leaving the Studio ends free play
  await openMobileControlsIfNeeded(page);
  await page.click('.ctl-btn[data-free-play]');
  await expect(page.locator('body')).toHaveClass(/free-play/);
  await page.evaluate(() => { location.hash = '#library'; });
  await expect(page.locator('body')).not.toHaveClass(/free-play/);
});
