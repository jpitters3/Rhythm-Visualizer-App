// @ts-check
const { test, expect } = require('@playwright/test');
const { createTestUser, deleteTestUser } = require('./utils/auth-helper');
const { gotoStudio, phraseAction } = require('./helpers');

// The status beside the phrase title (js/save-status.js) and auto-save (js/autosave.js).
// "Saved" only appears after a confirmed save, then fades.

async function signInToStudio(page, user) {
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
}

// Turns auto-save off through account settings (stored on the profile)
async function turnOffAutoSave(page) {
  await page.locator('#accountBtn').click({ force: true });
  await page.locator('#openAccountAuthBtn').click();
  await expect(page.locator('#accountSettingsSidebar')).toHaveClass(/open/, { timeout: 5000 });
  const toggle = page.locator('#acctAutoSaveToggle');
  await expect(toggle).toBeChecked();
  await page.locator('label[for="acctAutoSaveToggle"]').click();
  await expect(toggle).not.toBeChecked();
  await page.locator('#accountSettingsBackdrop').click({ force: true });
}

async function saveNewPhrase(page, prefix) {
  await page.locator('.measure-row .cell').first().click();
  await page.keyboard.press('1');
  await expect(page.locator('#phraseSaveStatus')).toHaveText('Not saved');
  await phraseAction(page, 'Save phrase');
  await page.fill('#confirmInput', `${prefix} ${Date.now()}`);
  await page.click('#confirmOkBtn');
  await expect(page.locator('#phraseSaveStatus')).toHaveText('Saved', { timeout: 10000 });
}

test('with auto-save off, Save saves the open phrase without a prompt', async ({ page }) => {
  const user = await createTestUser();
  try {
    await signInToStudio(page, user);
    await turnOffAutoSave(page);
    // It's a profile setting, so it survives a reload (and other devices)
    await page.reload();
    await page.waitForSelector('.measure-row');
    const status = page.locator('#phraseSaveStatus');
    await saveNewPhrase(page, 'Status');
    await expect(status).toBeHidden({ timeout: 6000 });

    await page.locator('.measure-row .cell').nth(1).click();
    await page.keyboard.press('2');
    await expect(status).toHaveText('Unsaved changes');
    await page.click('#quickSaveBtn');
    await expect(status).toHaveText('Saved', { timeout: 10000 });
    await expect(page.locator('#confirmModal.open')).toHaveCount(0);
    await expect(status).toBeHidden({ timeout: 6000 });
  } finally {
    await deleteTestUser(user.user.id);
  }
});

test('with auto-save on, edits save themselves with no unsaved badge', async ({ page }) => {
  const user = await createTestUser();
  try {
    await signInToStudio(page, user);
    const status = page.locator('#phraseSaveStatus');
    await saveNewPhrase(page, 'Auto');
    await expect(status).toBeHidden({ timeout: 6000 }); // so the next "Saved" is the auto-save

    await page.locator('.measure-row .cell').nth(1).click();
    await page.keyboard.press('2');
    await expect(status).not.toHaveText('Unsaved changes');
    await expect(page.locator('#quickSaveBtn')).not.toHaveClass(/visible/);
    await expect(status).toBeVisible({ timeout: 10000 });
    await expect(status).toHaveText('Saved');

    await page.reload();
    await page.waitForSelector('.measure-row');
    await expect(page.locator('.measure-row .cell').nth(1)).toContainText('2', { timeout: 10000 });
  } finally {
    await deleteTestUser(user.user.id);
  }
});
