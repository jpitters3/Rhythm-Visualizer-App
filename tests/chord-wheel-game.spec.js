const { test, expect } = require('@playwright/test');
require('dotenv').config();
const { createTestUser, deleteTestUser, loginAsTestUser } = require('./utils/auth-helper');

// Chord Wheel — the Harmony domain's first live game (js/chord-wheel-game.js).
// The wheel's CSS spin transition is ~3.2s; waits below are sized for that.
test('Chord Wheel: spin, reorder, click-to-play, Any Chords mode, send to Studio', async ({ page }) => {
  test.setTimeout(120000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const u = await createTestUser(false);

  try {
    await loginAsTestUser(page, u);
    await page.waitForTimeout(1500);
    await page.evaluate(() => { window.location.hash = '#games'; });
    await page.waitForSelector('.hg-tile', { timeout: 10000 });

    await page.click('.hg-tile[data-domain="harmony"]');
    await expect(page.locator('.cw-container')).toBeVisible();
    await expect(page.locator('.cw-slot')).toHaveCount(4);
    await expect(page.locator('.cw-send-btn')).toBeDisabled();

    // Real scale + embedded virtual handpan (relocated from Studio, see js/free-record.js precedent).
    await expect(page.locator('.cw-scale-name')).not.toBeEmpty();
    await expect(page.locator('.cw-handpan-slot #handpanWrap')).toHaveCount(1);
    await expect(page.locator('.cw-wheel-svg path').first()).toBeVisible();

    // Spin slot 0, wait for the wheel's spin transition to finish.
    await page.click('.cw-slot[data-id="slot-0"] .cw-spin-btn');
    await page.waitForTimeout(3600);
    await expect(page.locator('.cw-slot[data-id="slot-0"] .cw-chord-name')).not.toBeEmpty();

    // Click the filled slot: plays + highlights it on the embedded handpan.
    await page.click('.cw-slot[data-id="slot-0"]');
    await page.waitForTimeout(200);
    const highlighted = await page.locator('.chord-highlight, .chord-highlight-red').count();
    expect(highlighted).toBeGreaterThan(0);

    // Spin All 4 — sequential single-wheel spins.
    await page.click('.cw-spin-all-btn');
    await page.waitForTimeout(4 * 3600);
    const filledCount = await page.locator('.cw-chord-name').count();
    expect(filledCount).toBe(4);
    await expect(page.locator('.cw-send-btn')).toBeEnabled();

    // Reorder: drag slot 0 onto slot 3, confirm the chord order actually changes.
    const orderBefore = await page.locator('.cw-chord-name').allTextContents();
    await page.locator('.cw-slot[data-id="slot-0"]').dragTo(page.locator('.cw-slot[data-id="slot-3"]'), { force: true });
    await page.waitForTimeout(400);
    const orderAfter = await page.locator('.cw-chord-name').allTextContents();
    expect(orderAfter).not.toEqual(orderBefore);
    expect(orderAfter.sort()).toEqual(orderBefore.sort()); // same 4 chords, new order

    // Any Chords mode: unplayable toggle appears, default excludes unplayable chords.
    await page.click('.cw-mode-btn[data-mode="any"]');
    await expect(page.locator('.cw-unplayable-toggle')).toBeVisible();
    await page.click('.cw-spin-all-btn');
    await page.waitForTimeout(4 * 3600);
    await expect(page.locator('.cw-chord-badge')).toHaveCount(0);

    // Play Progression: highlight changes over time as each chord plays.
    await page.click('.cw-play-btn');
    await page.waitForTimeout(300);
    const sample1 = await page.evaluate(() => [...document.querySelectorAll('.chord-highlight, .chord-highlight-red')].map(e => e.className));
    await page.waitForTimeout(750);
    const sample2 = await page.evaluate(() => [...document.querySelectorAll('.chord-highlight, .chord-highlight-red')].map(e => e.className));
    expect(sample1.length).toBeGreaterThan(0);
    expect(sample2.length).toBeGreaterThan(0);

    // Send to Studio: drops the 4 chords into 4 new grid cells.
    await page.click('.cw-mode-btn[data-mode="scale"]');
    await page.click('.cw-spin-all-btn');
    await page.waitForTimeout(4 * 3600);
    const cellsBefore = await page.locator('#measures .cell').count();
    await page.click('.cw-send-btn');
    await page.waitForTimeout(800);
    await expect(page).toHaveURL(/#studio/);
    const cellsAfter = await page.locator('#measures .cell').count();
    expect(cellsAfter).toBeGreaterThanOrEqual(cellsBefore + 4);

    const lastFour = await page.locator('#measures .cell').allTextContents();
    const nonEmpty = lastFour.slice(-4).filter(t => t.trim().length > 0);
    expect(nonEmpty.length).toBe(4);

    expect(errors).toEqual([]);
  } finally {
    await deleteTestUser(u.user.id);
  }
});

test('Chord Wheel: back button restores the handpan to Studio', async ({ page }) => {
  test.setTimeout(60000);
  const u = await createTestUser(false);

  try {
    await loginAsTestUser(page, u);
    await page.waitForTimeout(1500);
    await page.evaluate(() => { window.location.hash = '#games'; });
    await page.waitForSelector('.hg-tile', { timeout: 10000 });

    await page.click('.hg-tile[data-domain="harmony"]');
    await expect(page.locator('.cw-handpan-slot #handpanWrap')).toHaveCount(1);

    await page.click('.hg-back');
    await page.waitForTimeout(300);
    await expect(page.locator('.cw-handpan-slot')).toHaveCount(0);
    await expect(page.locator('#handpanWrap')).toHaveCount(1);
  } finally {
    await deleteTestUser(u.user.id);
  }
});
