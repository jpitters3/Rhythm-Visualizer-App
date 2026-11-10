// @ts-check
const { test, expect } = require('./fixtures');
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
  // Wait for the profile update to land, or a reload right after can cut it off
  const saved = page.waitForResponse(r => r.url().includes('/rest/v1/profiles') && r.request().method() === 'PATCH');
  await page.locator('label[for="acctAutoSaveToggle"]').click();
  await expect(toggle).not.toBeChecked();
  await saved;
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
    // It's a profile setting, so it survives a reload (and other devices).
    // It arrives with the profile, so wait for that before editing.
    const profileLoaded = page.waitForResponse(r => r.url().includes('/rest/v1/profiles') && r.request().method() === 'GET');
    await page.reload();
    await profileLoaded;
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

// Games borrow the Studio grid and clear it; auto-save must not write that into
// the open phrase (js/autosave.js only saves edits made on the Studio route).
test('a game clearing the grid never overwrites the open phrase', { tag: '@core' }, async ({ page }) => {
  const user = await createTestUser();
  try {
    await signInToStudio(page, user);
    await saveNewPhrase(page, 'Keep');
    await expect(page.locator('#phraseSaveStatus')).toBeHidden({ timeout: 6000 });

    await page.goto('/#games');
    await page.locator('.hg-tile', { hasText: 'Rhythm' }).first().click();
    await expect(page.locator('.rg-progress')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(3500); // past the auto-save delay

    await page.goto('/#studio');
    await page.reload();
    await page.waitForSelector('.measure-row');
    await expect(page.locator('.measure-row .cell').first()).toContainText('1', { timeout: 10000 });
  } finally {
    await deleteTestUser(user.user.id);
  }
});
