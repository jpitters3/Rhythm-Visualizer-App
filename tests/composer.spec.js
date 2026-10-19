// @ts-check
// The Song Composer panel (js/song-composer.js): building a composition out of
// saved phrases and note sections, and reaching it again from the Library.
const { test, expect } = require('@playwright/test');
const { createTestUser, deleteTestUser, loginAsTestUser, supabaseAdmin } = require('./utils/auth-helper');
const { DEMO_PATTERN, seedPattern, deleteUserContent } = require('./utils/seed-helper');
const { navigateTo, openNavPanel } = require('./helpers');

test.describe('Song Composer', () => {
  let user;
  const ts = Date.now();
  const phraseName = `Verse Groove ${ts}`;

  test.beforeEach(async ({ page }) => {
    test.setTimeout(90000);
    user = await createTestUser();
    await seedPattern(user.user.id, phraseName);
    await loginAsTestUser(page, user);
    await navigateTo(page, 'studio');
  });

  test.afterEach(async () => {
    if (user) {
      await deleteUserContent(user.user.id);
      await deleteTestUser(user.user.id);
    }
  });

  test('creating a composition and adding a saved phrase and a note persists it', { tag: '@core' }, async ({ page }) => {
    const title = `My Song ${ts}`;
    await openNavPanel(page, '#toggleComposerBtn', '#composerSidebar');

    await page.click('#newCompositionBtn');
    await expect(page.locator('#confirmModal')).toHaveClass(/open/);
    await page.fill('#confirmInput', title);
    await page.click('#confirmOkBtn');

    const comp = page.locator('.composition-item.expanded', { hasText: title });
    await expect(comp).toBeVisible();

    await comp.locator('[data-action="add-phrase"]').click();
    await page.locator(`.phrase-picker-item[data-name="${phraseName}"]`).click();
    await expect(comp.locator('.section-item[data-type="phrase"]')).toContainText(phraseName);

    await comp.locator('[data-action="add-note"]').click();
    await expect(comp.locator('.section-item[data-type="note"]')).toHaveCount(1);

    const { data: rows } = await supabaseAdmin
      .from('compositions')
      .select('title, composition_sections(type, phrase_name, position)')
      .eq('user_id', user.user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe(title);
    const sections = rows[0].composition_sections.sort((a, b) => a.position - b.position);
    expect(sections.map(s => s.type)).toEqual(['phrase', 'note']);
    expect(sections[0].phrase_name).toBe(phraseName);

    // Reopening the panel after a reload shows the saved composition.
    await page.reload({ waitUntil: 'networkidle' });
    await navigateTo(page, 'studio');
    await openNavPanel(page, '#toggleComposerBtn', '#composerSidebar');
    // The restored session can trigger a second fetch right after the panel
    // opens, briefly swapping the list for "Loading…" — retry the expand in
    // case the first click lands on the list being replaced.
    const reloaded = page.locator('.composition-item', { hasText: title });
    await expect(async () => {
      if (!(await reloaded.evaluate(el => el.classList.contains('expanded')))) {
        await reloaded.locator('.composition-title').click();
      }
      await expect(reloaded.locator('.section-item')).toHaveCount(2, { timeout: 2000 });
    }).toPass({ timeout: 15000 });
  });

  test('a composition shows in the Library and opens back into the Composer', { tag: '@core' }, async ({ page }) => {
    const title = `Library Song ${ts}`;
    const { data: comp, error } = await supabaseAdmin
      .from('compositions').insert({ user_id: user.user.id, title }).select().single();
    if (error) throw error;
    await supabaseAdmin.from('composition_sections').insert({
      composition_id: comp.id, position: 0, type: 'phrase', title: phraseName,
      phrase_name: phraseName, pattern_snapshot: DEMO_PATTERN,
    });

    await navigateTo(page, 'library');
    await page.click('.library-tab[data-tab="compositions"]');
    const card = page.locator('#libraryGrid .library-card', { hasText: title });
    await expect(card).toBeVisible();

    await card.click();
    await page.waitForURL('**/#studio');
    await expect(page.locator('#composerSidebar')).toHaveClass(/open/);
    const item = page.locator(`.composition-item.expanded[data-id="${comp.id}"]`);
    await expect(item).toBeVisible();
    await expect(item.locator('.section-item[data-type="phrase"]')).toContainText(phraseName);
  });
});
