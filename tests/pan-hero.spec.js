const { test, expect } = require('@playwright/test');
const { gotoStudio } = require('./helpers');

async function seedPattern(page) {
  await gotoStudio(page);
  await page.waitForSelector('.measure-row');
  await page.click('#clearBtn-A');
  await page.locator('#confirmModal.open').waitFor({ timeout: 5000 });
  await page.click('#confirmOkBtn');
  await page.addScriptTag({ type: 'module', content: `
    import { gridA } from '/js/grid-context.js';
    import { renderAllMeasures } from '/js/notegrid.js';
    ['1','','3','','Ding','','5','']
      .forEach((v,i)=>{ if(i<gridA.innerLabels.length) gridA.innerLabels[i]=v; });
    renderAllMeasures(gridA);
    window.__gridA = gridA;
  `});
  await page.waitForTimeout(150);
}

test('Pan Hero: desktop menu → open, re-parent + pin pan, auto-play', async ({ page }) => {
  await seedPattern(page);

  await page.click('.handpan-tabs [data-pan-hero]');
  await page.waitForTimeout(300);

  await expect(page.locator('#panHeroOverlay')).toBeVisible();
  await expect(page.locator('#panHeroPanHost #handpanWrap.pan-hero-pinned')).toHaveCount(1);
  await expect(page.locator('.handpan-panel #handpanWrap')).toHaveCount(0);
  expect(await page.evaluate(() => window.__gridA.playing)).toBe(true);

  // canvas is sized to the viewport (DPR-scaled backing store)
  const okCanvas = await page.evaluate(() => {
    const c = document.getElementById('panHeroCanvas');
    const dpr = window.devicePixelRatio || 1;
    return c.width === Math.round(innerWidth * dpr) && c.height === Math.round(innerHeight * dpr);
  });
  expect(okCanvas).toBe(true);
});

test('Pan Hero: Escape closes and fully restores state', async ({ page }) => {
  await seedPattern(page);
  const sidePref = await page.evaluate(() => localStorage.getItem('gp_handpanSide'));

  await page.click('.handpan-tabs [data-pan-hero]');
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  await expect(page.locator('#panHeroOverlay')).toBeHidden();
  await expect(page.locator('.handpan-panel #handpanWrap')).toHaveCount(1);
  await expect(page.locator('#panHeroPanHost #handpanWrap')).toHaveCount(0);
  expect(await page.evaluate(() => window.__gridA.playing)).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem('gp_handpanSide'))).toBe(sidePref);
  expect(await page.evaluate(() => document.body.classList.contains('pan-hero-open'))).toBe(false);
});

test('Pan Hero: exit button also closes', async ({ page }) => {
  await seedPattern(page);
  await page.click('.handpan-tabs [data-pan-hero]');
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
