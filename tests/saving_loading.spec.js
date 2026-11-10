const { test, expect } = require('./fixtures');
const { gotoStudio, openMobileControlsIfNeeded, phraseAction } = require('./helpers');
const { createTestUser, deleteTestUser, loginAsTestUser } = require('./utils/auth-helper');

test.describe('Pattern Management', () => {
  let testUser;

  test.beforeEach(async ({ page }) => {
    await gotoStudio(page);
    testUser = await createTestUser();
    await loginAsTestUser(page, testUser);
    // A successful login redirects to #dashboard (js/controls.js) regardless
    // of the page it was triggered from — head back to Studio afterward.
    await page.goto('/#studio');
    await page.waitForSelector('.measure-row');
  });

  test.afterEach(async () => {
    if (testUser?.user?.id) {
      await deleteTestUser(testUser.user.id);
    }
  });

  async function closeAccountMenu(page) {
    // Close account dropdown if showing
    const accountDropdown = page.locator('#accountDropdownMenu');
    if (await accountDropdown.evaluate(el => el.classList.contains('show'))) {
      await page.click('#accountBtn');
    }
    // On mobile: close hamburger menu
    if (await page.locator('#mobileMenuBtn').isVisible()) {
      const menu = page.locator('#appNav');
      if (await menu.evaluate(el => el.classList.contains('open'))) {
        await page.click('#mobileMenuBtn');
        await expect(menu).not.toHaveClass(/open/);
      }
    }
  }

  test('Save and Load Pattern', { tag: '@smoke' }, async ({ page }) => {
    const uniqueName = `Test Pattern ${Date.now()}`;

    // 1. Create a Pattern
    const cell0 = page.locator('.cell').nth(0);
    await cell0.click();
    // Wait for the cell to actually take the selection before typing — on
    // Mobile Safari a keypress right after the tap can land before it does.
    await expect(cell0).toHaveClass(/selected/);
    await page.keyboard.press('1');
    await expect(cell0.locator('.inner')).toHaveText('1');

    // 2. Save Pattern
    await phraseAction(page, 'Save phrase');

    // Handle Custom Modal Prompt
    const saveModal = page.locator('#confirmModal');
    await expect(saveModal).toHaveClass(/open/);
    await expect(page.locator('#confirmTitle')).toHaveText('Save Phrase');
    await page.fill('#confirmInput', uniqueName);
    await page.click('#confirmOkBtn');
    await expect(saveModal).not.toHaveClass(/open/);

    // patternSelect should have the new val
    const select = page.locator('#patternSelect');
    await expect(select).toHaveValue(uniqueName);

    // 3. Move to a fresh phrase (clearing a saved phrase would auto-save the empty grid)
    await phraseAction(page, 'New phrase');
    await page.fill('#confirmInput', `${uniqueName} B`);
    await page.click('#confirmOkBtn');
    await expect(select).toHaveValue(`${uniqueName} B`);
    await expect(cell0.locator('.inner')).toBeEmpty();

    // 4. Load Pattern via the Open Phrase modal (#loadBtn is a hidden legacy element)
    await phraseAction(page, 'Open Phrase');
    const openModal = page.locator('#openPhraseModal');
    await expect(openModal).toHaveClass(/open/);
    await page.locator('.phrase-list-item')
      .filter({ has: page.getByText(uniqueName, { exact: true }) }).click();
    await expect(select).toHaveValue(uniqueName);

    // 5. Verify Restoration
    await expect(cell0.locator('.inner')).toHaveText('1');
  });

  // Measure settings (beats × subdivision) are phrase-owned data — saved and
  // restored per-phrase via serializePattern()/applyPattern(), same as notes
  // and BPM (js/rhythm-core.js's DEFAULT_BEATS/DEFAULT_SUBDIVISION are only a
  // fixed starting point for a brand-new phrase, never a sticky "last used"
  // global — see the Plan A default-leak fix). .t-beats-select/.t-sub-select
  // live inline in the transport bar on both desktop and mobile (unlike
  // .t-subdiv-btn/.t-tap-btn, which move into a mobile-only submenu), so no
  // device-specific gating is needed to reach them.
  async function setMeasureSettings(page, beats, subdivision) {
    await page.locator('#mainTransport-A .t-beats-select').selectOption(String(beats));
    await page.locator('#mainTransport-A .t-sub-select').selectOption(String(subdivision));
  }

  async function getMeasureSettings(page) {
    return {
      beats: await page.locator('#mainTransport-A .t-beats-select').inputValue(),
      subdivision: await page.locator('#mainTransport-A .t-sub-select').inputValue(),
    };
  }

  async function savePhraseAs(page, name) {
    await phraseAction(page, 'Save phrase');
    const saveModal = page.locator('#confirmModal');
    await expect(saveModal).toHaveClass(/open/);
    await expect(page.locator('#confirmTitle')).toHaveText('Save Phrase');
    await page.fill('#confirmInput', name);
    await page.click('#confirmOkBtn');
    await expect(saveModal).not.toHaveClass(/open/);
    await closeAccountMenu(page);
  }

  async function loadPhrase(page, name) {
    await phraseAction(page, 'Open Phrase');
    const openModal = page.locator('#openPhraseModal');
    await expect(openModal).toHaveClass(/open/);
    await page.locator('.phrase-list-item', { hasText: name }).click();

    // Only appears if the grid has unsaved changes relative to whatever's
    // currently loaded — harmless to skip when it doesn't show.
    const loadConfirmModal = page.locator('#confirmModal.open');
    if (await loadConfirmModal.isVisible().catch(() => false)) {
      await page.click('#confirmOkBtn');
      await expect(loadConfirmModal).not.toBeVisible();
    }
  }

  test('Measure settings (beats × subdivision) persist per-phrase', { tag: '@core' }, async ({ page, isMobile }) => {
    const phrase1Name = `4-Quarter ${Date.now()}`;
    const phrase2Name = `7-Eighth ${Date.now()}`;

    // Phrase 1: 4 beats per measure, quarter notes
    await setMeasureSettings(page, 4, 1);
    await savePhraseAs(page, phrase1Name);

    // Phrase 2: save it as its own phrase BEFORE changing settings, so auto-save
    // (which writes edits to the open phrase) can never put them into phrase 1.
    // The grid stays empty, so no stretch/compress dialog can fire.
    await savePhraseAs(page, phrase2Name);
    await expect(page.locator('#patternSelect')).toHaveValue(phrase2Name);
    await setMeasureSettings(page, 7, 2);
    await savePhraseAs(page, phrase2Name);

    // On mobile, applyPattern() (js/pattern-crud.js normalizeMobileSubdivision)
    // collapses any subdivision > 1 down to quarter notes and scales BPM to
    // compensate, remembering the original in ctx.mobileOriginalSubdivision
    // so a later save can reverse it — so the select itself reads back '1'
    // on mobile even though '2' was saved.
    const expectedSubdivision = isMobile ? '1' : '2';

    // Load phrase 1 back and confirm ITS settings come back, not phrase 2's
    // or the fixed new-phrase default.
    await loadPhrase(page, phrase1Name);
    await expect.poll(() => getMeasureSettings(page)).toEqual({ beats: '4', subdivision: '1' });

    // Load phrase 2 and confirm the same, the other way around.
    await loadPhrase(page, phrase2Name);
    await expect.poll(() => getMeasureSettings(page)).toEqual({ beats: '7', subdivision: expectedSubdivision });
  });

  test('Delete Pattern', { tag: '@core' }, async ({ page }) => {
    const uniqueName = `Delete Me ${Date.now()}`;

    // 1. Save dummy pattern
    await phraseAction(page, 'Save phrase');

    // Custom Modal
    await page.fill('#confirmInput', uniqueName);
    await page.click('#confirmOkBtn');
    await expect(page.locator('#confirmModal')).not.toHaveClass(/open/);

    // 2. Click Delete, once the saved phrase is selected (#deleteBtn enables then)
    await expect(page.locator('#deleteBtn')).toBeEnabled();
    await phraseAction(page, 'Delete phrase');

    // Handle Delete Confirm Modal
    const deleteModal = page.locator('#confirmModal');
    await expect(deleteModal).toHaveClass(/open/);
    await expect(page.locator('#confirmTitle')).toHaveText('Delete Pattern');
    await page.click('#confirmOkBtn');
    await expect(deleteModal).not.toHaveClass(/open/);

    // 3. Verify Removal
    await expect(page.locator('#patternSelect')).not.toContainText(uniqueName);
  });

});
