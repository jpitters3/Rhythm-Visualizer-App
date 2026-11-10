// @ts-check
const { test, expect } = require('@playwright/test');
const { createTestUser, deleteTestUser } = require('./utils/auth-helper');
const { gotoStudio, phraseAction } = require('./helpers');

// The status beside the phrase title must only say "Saved" when the grid
// matches a confirmed save, and that confirmation fades after a few seconds
// (js/save-status.js). Unsaved states stay visible.
test('phrase save status follows real saves and edits', async ({ page }) => {
  const user = await createTestUser();
  try {
    await gotoStudio(page);
    await page.evaluate(() => document.getElementById('authBtn')?.click());
    await page.locator('#authEmail').fill(user.email);
    await page.click('#authContinueBtn');
    await page.locator('#authPasswordRow').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('#authPass').fill(user.password);
    await page.click('#authLogin');
    await page.locator('#accountBtn').waitFor({ state: 'visible', timeout: 15000 });
    await page.goto('/#studio');
    await page.waitForSelector('.measure-row');

    const status = page.locator('#phraseSaveStatus');
    await page.locator('.measure-row .cell').first().click();
    await page.keyboard.press('1');
    await expect(status).toHaveText('Not saved');

    await phraseAction(page, 'Save phrase');
    await page.fill('#confirmInput', `Status ${Date.now()}`);
    await page.click('#confirmOkBtn');
    await expect(status).toHaveText('Saved', { timeout: 10000 });
    await expect(status).toBeVisible();
    await expect(status).toBeHidden({ timeout: 6000 });

    await page.locator('.measure-row .cell').nth(1).click();
    await page.keyboard.press('2');
    await expect(status).toHaveText('Unsaved changes');

    // Re-saving under the same name asks to overwrite; until that's confirmed it isn't saved.
    await phraseAction(page, 'Save phrase');
    await page.click('#confirmOkBtn');
    await expect(page.locator('#confirmModal.open')).toContainText('Overwrite');
    await expect(status).toHaveText('Unsaved changes');
    await page.click('#confirmOkBtn');
    await expect(status).toHaveText('Saved', { timeout: 10000 });
  } finally {
    await deleteTestUser(user.user.id);
  }
});
