// @ts-check
// The Library route (js/library.js): browsing, searching, opening, renaming
// and deleting saved phrases.
const { test, expect } = require('@playwright/test');
const { createTestUser, deleteTestUser, loginAsTestUser, supabaseAdmin } = require('./utils/auth-helper');
const { seedPattern, deleteUserContent } = require('./utils/seed-helper');
const { navigateTo } = require('./helpers');

test.describe('Library', () => {
  let user;
  const ts = Date.now();
  const morning = `Morning Groove ${ts}`;
  const evening = `Evening Flow ${ts}`;

  test.beforeEach(async ({ page }) => {
    test.setTimeout(90000);
    user = await createTestUser();
    await seedPattern(user.user.id, morning);
    await seedPattern(user.user.id, evening, {
      labels: ['2', '', '', '', '', '', '', ''], hands: [], flams: [], beats: 4, subdivision: 2, measures: 1, bpm: 100,
    });
    await loginAsTestUser(page, user);
    await navigateTo(page, 'library');
    await expect(page.locator('#view-library')).toBeVisible();
  });

  test.afterEach(async () => {
    if (user) {
      await deleteUserContent(user.user.id);
      await deleteTestUser(user.user.id);
    }
  });

  const card = (page, name) =>
    page.locator('#libraryGrid .library-card', { has: page.locator('.library-card-title', { hasText: name }) });

  test('lists saved phrases, search filters them, and opening one loads it in the Studio', { tag: '@core' }, async ({ page }) => {
    // The Library's first load competes with the burst of requests the app
    // fires right after sign-in; under a loaded test run it can pass 5s.
    await expect(card(page, morning)).toBeVisible({ timeout: 15000 });
    await expect(card(page, evening)).toBeVisible();

    await page.fill('#librarySearch', 'Morning Groove');
    await expect(card(page, morning)).toBeVisible();
    await expect(card(page, evening)).toHaveCount(0);
    await page.fill('#librarySearch', '');
    await expect(card(page, evening)).toBeVisible();

    await card(page, evening).click();
    await page.waitForURL('**/#studio');
    await expect(page.locator('#patternSelect')).toHaveValue(evening);
    await expect(page.locator('#measures .cell').first().locator('.inner')).toHaveText('2');
  });

  test('renaming and deleting a phrase from its menu', { tag: '@core' }, async ({ page }) => {
    const renamed = `${morning} renamed`;

    // Rename/Delete use the browser's native prompt/confirm (js/library.js).
    page.once('dialog', d => d.accept(renamed));
    await card(page, morning).locator('.lib-menu-btn').click();
    await page.locator('#libContextMenu .lib-context-item', { hasText: 'Rename' }).click();
    await expect(card(page, renamed)).toBeVisible();
    await expect(page.locator('#libraryGrid .library-card-title', { hasText: new RegExp(`^${morning}$`) })).toHaveCount(0);

    page.once('dialog', d => d.accept());
    await card(page, renamed).locator('.lib-menu-btn').click();
    await page.locator('#libContextMenu .lib-context-item', { hasText: 'Delete' }).click();
    await expect(card(page, renamed)).toHaveCount(0);
    await expect(card(page, evening)).toBeVisible();

    const { data } = await supabaseAdmin.from('patterns').select('name').eq('user_id', user.user.id);
    expect((data || []).map(p => p.name)).toEqual([evening]);
  });
});

// Regression: a slow load for one tab used to finish after a switch to another
// tab and overwrite its grid (js/library.js renderSeq). Delaying the phrase list
// makes the race deterministic. Full suite only; not @core.
test('switching tabs while a slow load is in flight shows the new tab\'s items', async ({ page }) => {
  test.setTimeout(90000);
  const user = await createTestUser();
  const ts = Date.now();
  const phrase = `Slow Phrase ${ts}`;
  const title = `Fast Song ${ts}`;
  await seedPattern(user.user.id, phrase);
  await supabaseAdmin.from('compositions').insert({ user_id: user.user.id, title });
  try {
    await loginAsTestUser(page, user);
    await page.route(/rest\/v1\/patterns\?select=name%2Cdata%2Cupdated_at/, async route => {
      await new Promise(r => setTimeout(r, 3000));
      await route.continue();
    });
    await navigateTo(page, 'library');
    await page.click('.library-tab[data-tab="compositions"]');
    const grid = page.locator('#libraryGrid');
    await expect(grid.locator('.library-card', { hasText: title })).toBeVisible({ timeout: 15000 });
    // Past the delayed phrases response, the grid must still show compositions.
    await page.waitForTimeout(4000);
    await expect(grid.locator('.library-card', { hasText: title })).toBeVisible();
    await expect(grid.locator('.library-card', { hasText: phrase })).toHaveCount(0);
  } finally {
    await deleteUserContent(user.user.id);
    await deleteTestUser(user.user.id);
  }
});
