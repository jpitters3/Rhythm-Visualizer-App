const { test, expect } = require('@playwright/test');
require('dotenv').config();
const { createTestUser, deleteTestUser, loginAsTestUser } = require('./utils/auth-helper');

// The Handpan Games hub — Phase 0 shell (route #games, 10 domain tiles).
test('Handpan Games hub opens from the practice sidebar', async ({ page }) => {
  test.setTimeout(120000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const u = await createTestUser(false);

  try {
    await loginAsTestUser(page, u);
    await page.waitForTimeout(1500);
    await page.evaluate(() => { window.location.hash = '#studio'; });
    await page.waitForSelector('.measure-row:visible', { timeout: 20000 }).catch(() => {});

    await page.click('#toggleExercisesBtn'); // "Practice" nav link → practice sidebar
    await page.waitForSelector('#practiceSidebar.open', { timeout: 8000 });
    await expect(page.locator('#openHandpanGamesBtn')).toBeVisible();

    await page.click('#openHandpanGamesBtn');
    await page.waitForTimeout(500);

    await expect(page.locator('#view-games.active')).toBeVisible();
    await expect(page.locator('#view-games .hg-tile')).toHaveCount(10);
    await expect(page.locator('#view-games')).toContainText('Rhythm');
    await expect(page.locator('#view-games')).toContainText('Collaboration');
    expect(await page.evaluate(() => location.hash)).toBe('#games');
    expect(errors).toEqual([]);

    await page.click('#view-games .hg-back');
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => location.hash)).not.toBe('#games');
  } finally {
    await deleteTestUser(u.user.id);
  }
});
