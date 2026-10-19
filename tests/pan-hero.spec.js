const { test, expect } = require('@playwright/test');
const { gotoStudio, clearGrid, closeMobileControlsIfNeeded } = require('./helpers');

// main.js re-exports gridA/renderAllMeasures (see its own comment on why) —
// importing its actual deployed URL (not the source path, which only
// resolves against Vite's dev server) returns the same live singletons
// already running on the page, since ES module imports are cached by
// resolved URL. evaluateHandle keeps that reference on the page side so
// later page.evaluate calls can use it without ever touching `window`.
async function seedPattern(page) {
  await gotoStudio(page);
  await page.waitForSelector('.measure-row');
  await clearGrid(page, 'A');
  // Restore the handpan panel — clearGrid needed the controls panel open on
  // mobile, which relocates into #panelControlsSlot and hides .handpan-tabs
  // (css/measure-actions.css's .controls-mode rules), and every test here
  // clicks the Pan Hero tab inside it right after seedPattern() returns.
  await closeMobileControlsIfNeeded(page);
  const gridA = await page.evaluateHandle(async () => {
    const entryUrl = document.querySelector('script[type="module"][src*="main"]').src;
    const { gridA, renderAllMeasures } = await import(entryUrl);
    ['1','','3','','Ding','','5','']
      .forEach((v,i)=>{ if(i<gridA.innerLabels.length) gridA.innerLabels[i]=v; });
    renderAllMeasures(gridA);
    return gridA;
  });
  await page.waitForTimeout(150);
  return gridA;
}

// .handpan-tabs [data-pan-hero] is desktop-only — #handpanOptionsBtn
// ("mobile-only" class, index.html) is the real way to reach it on mobile,
// via its own #handpanOptionsMenu [data-pan-hero] duplicate.
async function openPanHero(page) {
  if (await page.locator('#handpanOptionsBtn').isVisible()) {
    await page.click('#handpanOptionsBtn');
    await page.waitForSelector('#handpanOptionsMenu.show');
    await page.click('#handpanOptionsMenu [data-pan-hero]');
  } else {
    await page.click('.handpan-tabs [data-pan-hero]');
  }
}

test('Pan Hero: desktop menu → open, re-parent + pin pan, auto-play', async ({ page, isMobile }) => {
  const gridA = await seedPattern(page);

  await openPanHero(page);
  await page.waitForTimeout(300);

  await expect(page.locator('#panHeroOverlay')).toBeVisible();
  await expect(page.locator('#panHeroPanHost #handpanWrap.pan-hero-pinned')).toHaveCount(1);
  await expect(page.locator('.handpan-panel #handpanWrap')).toHaveCount(0);
  expect(await page.evaluate(g => g.playing, gridA)).toBe(true);

  // Backing store matches the CSS box (DPR-capped). On desktop the canvas is a
  // centred column narrower than the viewport — below the 900px breakpoint
  // (css/pan-hero.css) that's deliberately not true: a full-viewport canvas
  // is cheap enough there, and narrowing it is a desktop-only perf
  // optimization (full-viewport repaint cost on large displays).
  const canvasInfo = await page.evaluate(() => {
    const c = document.getElementById('panHeroCanvas');
    const r = c.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    return {
      matchesBox: c.width === Math.round(Math.round(r.width) * dpr)
        && c.height === Math.round(Math.round(r.height) * dpr),
      narrowerThanViewport: r.width < window.innerWidth,
    };
  });
  expect(canvasInfo.matchesBox).toBe(true);
  expect(canvasInfo.narrowerThanViewport).toBe(!isMobile);
});

test('Pan Hero: Escape closes and fully restores state', async ({ page }) => {
  const gridA = await seedPattern(page);
  const sidePref = await page.evaluate(() => localStorage.getItem('gp_handpanSide'));

  await openPanHero(page);
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  await expect(page.locator('#panHeroOverlay')).toBeHidden();
  await expect(page.locator('.handpan-panel #handpanWrap')).toHaveCount(1);
  await expect(page.locator('#panHeroPanHost #handpanWrap')).toHaveCount(0);
  expect(await page.evaluate(g => g.playing, gridA)).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem('gp_handpanSide'))).toBe(sidePref);
  expect(await page.evaluate(() => document.body.classList.contains('pan-hero-open'))).toBe(false);
});

test('Pan Hero: exit button also closes', async ({ page }) => {
  await seedPattern(page);
  await openPanHero(page);
  await page.waitForTimeout(300);
  await page.click('#panHeroExit');
  await page.waitForTimeout(300);
  await expect(page.locator('#panHeroOverlay')).toBeHidden();
});

test('Pan Hero: mobile options menu opens it and closes the menu', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await gotoStudio(page);
  await page.waitForSelector('.measure-row');
  await page.click('#handpanOptionsBtn');
  await page.waitForSelector('#handpanOptionsMenu.show');
  await page.click('#handpanOptionsMenu [data-pan-hero]');
  await page.waitForTimeout(300);
  await expect(page.locator('#panHeroOverlay')).toBeVisible();
  await expect(page.locator('#handpanOptionsMenu.show')).toHaveCount(0);
});
