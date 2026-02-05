// @ts-check
const { test, expect } = require('@playwright/test');

test('Capture Console Logs', async ({ page }) => {
  const logs = [];
  page.on('console', msg => logs.push(`[CONSOLE] ${msg.type()}: ${msg.text()}`));
  page.on('pageerror', err => logs.push(`[PAGE_ERROR] ${err.stack || err.message}`));

  try {
    await page.goto('http://localhost:8000');
    // Wait a bit for scripts to execute
    await page.waitForTimeout(2000);
  } catch (e) {
    logs.push(`[NAV_ERROR] ${e.message}`);
  }

  console.log('--- BROWSER LOGS START ---');
  console.log(logs.join('\n'));
  console.log('--- BROWSER LOGS END ---');

  // Also check if critical elements are missing
  const activeGrid = await page.locator('#activeGrid').count(); // This is 0, we know
  const measures = await page.locator('.measure-row').count();
  const cells = await page.locator('.cell').count();
  console.log(`[DOM] .measure-row count: ${measures}`);
  console.log(`[DOM] .cell count: ${cells}`);

  const templateExists = await page.locator('#transport-template').count();
  console.log(`[DOM] #transport-template exists: ${templateExists}`);

  const transportChildren = await page.evaluate(() => {
    const el = document.getElementById('mainTransport-A');
    return el ? el.children.length : 'null';
  });
  console.log(`[DOM] #mainTransport-A children: ${transportChildren}`);

  const hasTransportUI = await page.evaluate(() => typeof window.TransportUI);
  console.log(`[JS] window.TransportUI type: ${hasTransportUI}`);

  // Check visibility
  const gridVisible = await page.locator('#measures').isVisible();
  console.log(`[VISIBILITY] #measures: ${gridVisible}`);

  // Interactivity check
  const playBtn = page.locator('.t-play-btn').first();
  await playBtn.click();
  await page.waitForTimeout(100);
  const isPlaying = await playBtn.getAttribute('class');
  console.log(`[INTERACTIVITY] Play button class: ${isPlaying}`);

  // Computed styles
  const gridStyles = await page.locator('#measures').evaluate(el => {
    const s = window.getComputedStyle(el);
    return { display: s.display, visibility: s.visibility, opacity: s.opacity, height: s.height, width: s.width, color: s.color };
  });
  console.log(`[STYLE] #measures:`, JSON.stringify(gridStyles));

  const cellStyles = await page.locator('.cell').first().evaluate(el => {
    const s = window.getComputedStyle(el);
    return { display: s.display, visibility: s.visibility, opacity: s.opacity, width: s.width, height: s.height, bg: s.backgroundColor };
  });
  console.log(`[STYLE] .cell (first):`, JSON.stringify(cellStyles));

  const patternOptions = await page.locator('#patternSelect option').count();
  console.log(`[DOM] #patternSelect options: ${patternOptions}`);
});

test.beforeEach(async ({ page }) => {
  page.on('requestfailed', request => {
    console.log(`[NETWORK] Failed: ${request.url()} - ${request.failure().errorText}`);
  });
});
