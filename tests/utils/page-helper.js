/**
 * Wait for the page to be fully loaded and initialized
 * @param {import('@playwright/test').Page} page - Playwright page object
 */
async function waitForPageReady(page) {
  // Wait for network to be idle
  await page.goto('/', { waitUntil: 'networkidle' });

  // Wait for the grid to be rendered (ensures JS has initialized)
  await page.waitForSelector('.measure-row', { timeout: 10000 });

  // Small delay to ensure all initialization is complete
  await page.waitForTimeout(500);
}

module.exports = { waitForPageReady };
