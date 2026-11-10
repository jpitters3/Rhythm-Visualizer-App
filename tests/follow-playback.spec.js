// @ts-check
const { test, expect } = require('@playwright/test');
const { gotoStudio } = require('./helpers');

// Follow playback (js/grid-autoscroll.js): the grid scrolls with playback while on;
// scrolling it yourself during playback turns following off.
test('follow playback toggle and manual-scroll override', { tag: '@core' }, async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('Mobile'), 'Uses the mobile notation tools row');
  await gotoStudio(page);
  await page.waitForSelector('.measure-row');
  const follow = page.locator('.notation-tools [data-follow-toggle]');
  await expect(follow).toHaveAttribute('aria-pressed', 'true');

  // Enough measures to scroll
  for (let i = 0; i < 5; i++) await page.click('.addMeasureBtn:visible');
  const measures = page.locator('#measures');

  // Manual scroll while playing switches it off
  await page.click('#mainTransport-A .t-play-btn');
  await expect(page.locator('#mainTransport-A .t-play-btn')).toHaveClass(/playing/);
  // A finger scroll (Playwright can't swipe, and mobile WebKit has no wheel)
  await measures.evaluate(el => {
    el.dispatchEvent(new Event('touchmove', { bubbles: true }));
    el.style.scrollBehavior = 'auto'; // land now, not mid smooth-scroll
    el.scrollTop += 200;
  });
  await expect(follow).toHaveAttribute('aria-pressed', 'false');
  const top = await measures.evaluate(el => el.scrollTop);
  await page.waitForTimeout(3000); // playback moves on; the grid stays put
  expect(await measures.evaluate(el => el.scrollTop)).toBe(top);

  // On again: the toggle remembers it, and it sticks across a reload
  await follow.click();
  await expect(follow).toHaveAttribute('aria-pressed', 'true');
  await follow.click();
  await page.click('#mainTransport-A .t-play-btn');
  await page.reload();
  await page.waitForSelector('.measure-row');
  await expect(page.locator('.notation-tools [data-follow-toggle]')).toHaveAttribute('aria-pressed', 'false');
});
