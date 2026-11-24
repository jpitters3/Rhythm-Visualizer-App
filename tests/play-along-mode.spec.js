const { test, expect } = require('./fixtures');
const { gotoStudio, clearGrid, openMobileControlsIfNeeded, closeMobileControlsIfNeeded } = require('./helpers');

// Same seeding approach as tests/pan-hero.spec.js: the live gridA from the
// deployed entry module, kept page-side with evaluateHandle.
async function seedPattern(page) {
  await gotoStudio(page);
  await page.waitForSelector('.measure-row');
  await page.evaluate(() => document.documentElement.setAttribute('data-gp-test-mode', 'true'));
  await clearGrid(page, 'A');
  await closeMobileControlsIfNeeded(page);
  const gridA = await page.evaluateHandle(async () => {
    const entryUrl = document.querySelector('script[type="module"][src*="main"]').src;
    const { gridA, renderAllMeasures } = await import(entryUrl);
    // A chord split across hands, a Tak, single notes and a Ding.
    [['4', '6', '8', ''], 'T', '5', '', 'Ding', 'T', ['', '1', '3', '5'], '']
      .forEach((v, i) => { if (i < gridA.innerLabels.length) gridA.innerLabels[i] = v; });
    renderAllMeasures(gridA);
    return gridA;
  });
  await page.waitForTimeout(150);
  return gridA;
}

async function openPlayAlong(page) {
  const desktopBtn = page.locator('.handpan-tabs [data-play-along]');
  if (await desktopBtn.isVisible()) {
    await desktopBtn.click();
  } else {
    await openMobileControlsIfNeeded(page);
    await page.click('#primaryControlsWrapper [data-play-along]');
  }
}

// Whether a canvas has any painted pixel.
function canvasHasInk(page, id) {
  return page.evaluate(canvasId => {
    const c = document.getElementById(canvasId);
    const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    for (let k = 3; k < data.length; k += 4) if (data[k]) return true;
    return false;
  }, id);
}

test('Play Along: free users get the upgrade prompt', async ({ page }) => {
  await gotoStudio(page);
  await page.waitForSelector('.measure-row');
  await closeMobileControlsIfNeeded(page);
  await openPlayAlong(page);
  await expect(page.locator('#upgradeModal')).toHaveClass(/open/);
  await expect(page.locator('#upgradeModal .upgrade-intro')).toContainText('Play Along');
  await expect(page.locator('#playAlongOverlay')).toHaveCount(0);
});

test('Play Along: opens paused with the pan borrowed, Play and Pause drive playback', async ({ page }) => {
  const gridA = await seedPattern(page);
  await openPlayAlong(page);

  await expect(page.locator('#playAlongOverlay')).toBeVisible();
  await expect(page.locator('#playAlongPanHost #handpanWrap.play-along-pinned')).toHaveCount(1);
  await expect(page.locator('.handpan-panel #handpanWrap')).toHaveCount(0);
  expect(await page.evaluate(g => g.playing, gridA)).toBe(false);
  await expect(page.locator('#playAlongBar')).toHaveText(/^Bar 1 of \d+$/);
  expect(await canvasHasInk(page, 'playAlongStrip')).toBe(true);

  await page.click('#playAlongPlay');
  await expect(page.locator('#playAlongPlay')).toHaveAttribute('aria-label', 'Pause');
  await expect.poll(() => page.evaluate(g => g.playing, gridA)).toBe(true);
  await expect.poll(() => canvasHasInk(page, 'playAlongPanCanvas')).toBe(true);

  await page.click('#playAlongPlay');
  await expect(page.locator('#playAlongPlay')).toHaveAttribute('aria-label', 'Play');
  await expect.poll(() => page.evaluate(g => g.playing, gridA)).toBe(false);
});

test('Play Along: Escape closes and restores the Studio', async ({ page }) => {
  const gridA = await seedPattern(page);
  const sidePref = await page.evaluate(() => localStorage.getItem('gp_handpanSide'));

  await openPlayAlong(page);
  await page.click('#playAlongPlay');
  await expect.poll(() => page.evaluate(g => g.playing, gridA)).toBe(true);
  await page.keyboard.press('Escape');

  await expect(page.locator('#playAlongOverlay')).toBeHidden();
  await expect(page.locator('.handpan-panel #handpanWrap')).toHaveCount(1);
  await expect.poll(() => page.evaluate(g => g.playing, gridA)).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem('gp_handpanSide'))).toBe(sidePref);
  expect(await page.evaluate(() => document.body.classList.contains('play-along-open'))).toBe(false);
});

test('Play Along: the exit button closes it', async ({ page }) => {
  await seedPattern(page);
  await openPlayAlong(page);
  await page.click('#playAlongExit');
  await expect(page.locator('#playAlongOverlay')).toBeHidden();
});

// Four bars, a note on every beat, so seeking has somewhere to go.
async function seedFourBars(page) {
  await seedPattern(page);
  return page.evaluateHandle(async () => {
    const entryUrl = document.querySelector('script[type="module"][src*="main"]').src;
    const { gridA, renderAllMeasures } = await import(entryUrl);
    const n = gridA.stepsPerMeasure * 4;
    gridA.innerLabels = Array.from({ length: n }, (_, i) => (i % gridA.subdivision === 0 ? '4' : ''));
    gridA.innerHands = Array(n).fill(null);
    gridA.innerFlams = Array(n).fill('');
    renderAllMeasures(gridA);
    return gridA;
  });
}

// One bar of strip travel, in CSS px (js/play-along-mode.js stripLayout).
const BAR_PX = g => g.beats * 84;

test('Play Along: dragging the strip seeks by beats, and Play starts there', async ({ page }) => {
  const gridA = await seedFourBars(page);
  await openPlayAlong(page);
  await expect(page.locator('#playAlongBar')).toHaveText('Bar 1 of 4');

  const barPx = await page.evaluate(BAR_PX, gridA);
  const box = await page.locator('#playAlongStrip').boundingBox();
  const x = box.x + box.width / 2;
  await page.mouse.move(x, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(x, box.y + 20 + barPx * 0.55, { steps: 6 });
  await page.mouse.move(x, box.y + 20 + barPx * 1.1, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('#playAlongBar')).toHaveText('Bar 2 of 4');

  await page.click('#playAlongPlay');
  await expect.poll(() => page.evaluate(g => g.playing, gridA)).toBe(true);
  const { step, spm } = await page.evaluate(g => ({ step: g.audioStep, spm: g.stepsPerMeasure }), gridA);
  expect(step).toBeGreaterThanOrEqual(spm);
  expect(step).toBeLessThan(spm * 2 + 2);
  await page.click('#playAlongPlay');
});

test('Play Along: the scroll wheel seeks too', async ({ page, isMobile }) => {
  test.skip(isMobile, 'no wheel on phones');
  const gridA = await seedFourBars(page);
  await openPlayAlong(page);
  const barPx = await page.evaluate(BAR_PX, gridA);
  const box = await page.locator('#playAlongStrip').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -barPx * 2);
  await expect(page.locator('#playAlongBar')).toHaveText('Bar 3 of 4');
  await page.mouse.wheel(0, barPx);
  await expect(page.locator('#playAlongBar')).toHaveText('Bar 2 of 4');
});

test('Play Along: the tempo field and − / + set the BPM, even while playing', async ({ page }) => {
  const gridA = await seedPattern(page);
  await openPlayAlong(page);
  const tempo = page.locator('#playAlongTempo');
  const shown = Number(await tempo.inputValue());

  await page.click('.pa-tempo [data-tempo-step="1"]');
  await expect(tempo).toHaveValue(String(shown + 2));
  await page.click('.pa-tempo [data-tempo-step="-1"]');
  await page.click('.pa-tempo [data-tempo-step="-1"]');
  await expect(tempo).toHaveValue(String(shown - 2));

  await tempo.fill('100');
  await tempo.press('Enter');
  await expect(tempo).toHaveValue('100');
  expect(await page.evaluate(g => g.bpm, gridA)).toBe(100);

  await page.click('#playAlongPlay');
  await expect.poll(() => page.evaluate(g => g.playing, gridA)).toBe(true);
  await page.click('.pa-tempo [data-tempo-step="1"]');
  expect(await page.evaluate(g => g.bpm, gridA)).toBe(102);
  // Pauses for the change, then picks up again on its own.
  await expect.poll(() => page.evaluate(g => g.playing, gridA)).toBe(true);
  await page.click('#playAlongPlay');
});

test('Play Along: fits a phone screen without scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await seedPattern(page);
  await openPlayAlong(page);
  await expect(page.locator('#playAlongOverlay')).toBeVisible();
  const fit = await page.evaluate(() => {
    const o = document.getElementById('playAlongOverlay');
    const play = document.getElementById('playAlongPlay').getBoundingClientRect();
    return { overflow: o.scrollHeight - o.clientHeight, playBottom: play.bottom, vh: window.innerHeight };
  });
  expect(fit.overflow).toBeLessThanOrEqual(1);
  expect(fit.playBottom).toBeLessThanOrEqual(fit.vh);
});
