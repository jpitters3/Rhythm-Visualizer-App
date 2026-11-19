// @ts-check
const { test, expect } = require('./fixtures');
const { createTestUser, deleteTestUser, supabaseAdmin } = require('./utils/auth-helper');
const { gotoStudio, openMobileControlsIfNeeded, phraseAction } = require('./helpers');

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
  const name = `${prefix} ${Date.now()}`;
  await page.locator('.measure-row .cell').first().click();
  await page.keyboard.press('1');
  await expect(page.locator('#phraseSaveStatus')).toHaveText('Not saved');
  await phraseAction(page, 'Save phrase');
  await page.fill('#confirmInput', name);
  await page.click('#confirmOkBtn');
  await expect(page.locator('#phraseSaveStatus')).toHaveText('Saved', { timeout: 10000 });
  return name;
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
// Both Rhythm games clear and reshape the grid; neither may touch the open phrase.
for (const [gameId, ready] of [['create-rhythm', '.rg-progress'], ['rhythm-ear', '.re-panel']]) {
  test(`a game clearing the grid never overwrites the open phrase (${gameId})`, { tag: '@core' }, async ({ page }) => {
    const user = await createTestUser();
    try {
      await signInToStudio(page, user);
      await saveNewPhrase(page, 'Keep');
      await expect(page.locator('#phraseSaveStatus')).toBeHidden({ timeout: 6000 });

      await page.goto('/#games');
      await page.locator('.hg-tile', { hasText: 'Rhythm' }).first().click();
      await page.click(`.hg-tile[data-game="${gameId}"]`); // Rhythm opens a choice of games
      await expect(page.locator(ready)).toBeVisible({ timeout: 10000 });
      await page.waitForTimeout(3500); // past the auto-save delay

      await page.goto('/#studio');
      await page.reload();
      await page.waitForSelector('.measure-row');
      await expect(page.locator('.measure-row .cell').first()).toContainText('1', { timeout: 10000 });
    } finally {
      await deleteTestUser(user.user.id);
    }
  });
}

// What's sent to the Studio is named after where it came from (a Chords panel
// song's title, "Heard Dm C"…). A saved phrase of the same name used to be
// opened with the new content, and auto-save wrote over it. Now it's always a
// new phrase.
test('Send to Studio saves a new phrase, never over one of the same name', { tag: '@core' }, async ({ page }) => {
  const user = await createTestUser();
  try {
    const beautiful = { version: 'v1.0', beats: 4, subdivision: 2, bpm: 90, steps: 8, measures: 1, labels: ['3', '', '4', '', '5', '', '6', ''], hands: Array(8).fill(null) };
    const { error } = await supabaseAdmin.from('patterns').insert({ user_id: user.user.id, name: 'Beautiful', data: beautiful, source: 'manual' });
    if (error) throw error;
    await signInToStudio(page, user);

    const desktopBtn = page.locator('.handpan-tabs [data-chord-panel]');
    if (await desktopBtn.isVisible()) await desktopBtn.click();
    else {
      await openMobileControlsIfNeeded(page);
      await page.click('#primaryControlsWrapper [data-chord-panel]');
    }
    await page.fill('#csSongTitle', 'Beautiful');
    const chord = page.locator('#chordList .cs-chord-item').first();
    await chord.hover();
    await chord.locator('.cs-chord-add-btn').click();
    await page.click('#csSendBtn');
    await expect(page.locator('#csSendBtn')).toHaveText(/Sent/, { timeout: 10000 });
    await expect(page.locator('#patternSelect')).toHaveValue('Beautiful (2)', { timeout: 10000 });
    // A Studio edit, then past the auto-save delay: it goes to the new phrase
    await page.keyboard.press('Escape');
    await page.locator('.measure-row .cell').nth(1).click();
    await page.keyboard.press('7');
    await page.waitForTimeout(3500);

    const { data: rows } = await supabaseAdmin.from('patterns').select('name, data').eq('user_id', user.user.id);
    expect(rows.find(r => r.name === 'Beautiful').data).toEqual(beautiful); // untouched
    expect(rows.find(r => r.name === 'Beautiful (2)').data.labels[1]).toBe('7');
  } finally {
    await deleteTestUser(user.user.id);
  }
});

// Loading a whole phrase while the Studio shows (Transcribe, Free Record, an
// exercise, Import) changed the grid under the open phrase's name, and
// auto-save wrote it over that phrase. Import is the one reachable without audio.
test('importing a phrase never auto-saves over the open one', { tag: '@core' }, async ({ page }) => {
  const user = await createTestUser();
  try {
    await signInToStudio(page, user);
    const kept = await saveNewPhrase(page, 'Keep');
    await expect(page.locator('#phraseSaveStatus')).toBeHidden({ timeout: 6000 });

    await page.evaluate(() => document.getElementById('importBtn').click());
    const imported = { version: 'v1.0', beats: 3, subdivision: 1, bpm: 100, steps: 3, measures: 1, labels: ['5', '', ''], hands: [null, null, null] };
    await page.fill('#confirmInput', JSON.stringify(imported));
    await page.click('#confirmOkBtn');
    await page.click('#confirmCancelBtn'); // "Save this pattern?" No
    await page.waitForTimeout(3500); // past the auto-save delay

    const { data: rows } = await supabaseAdmin.from('patterns').select('name, data').eq('user_id', user.user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe(kept);
    expect(rows[0].data.labels[0]).toBe('1'); // untouched
    expect(rows[0].data.beats).not.toBe(3);
  } finally {
    await deleteTestUser(user.user.id);
  }
});
