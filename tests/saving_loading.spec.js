const { test, expect } = require('@playwright/test');
const { gotoStudio } = require('./helpers');
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

  // Opens account dropdown + phrase submenu idempotently
  async function openPhraseMenu(page) {
    // On mobile: open hamburger menu first
    if (await page.locator('#mobileMenuBtn').isVisible()) {
      const menu = page.locator('#headerMenu');
      if (!await menu.evaluate(el => el.classList.contains('open'))) {
        await page.click('#mobileMenuBtn');
        await expect(menu).toHaveClass(/open/, { timeout: 2000 });
      }
    }
    // Open account dropdown (only toggle if not already shown)
    const accountDropdown = page.locator('#accountDropdownMenu');
    if (!await accountDropdown.evaluate(el => el.classList.contains('show'))) {
      await page.click('#accountBtn');
      await expect(accountDropdown).toHaveClass(/show/, { timeout: 3000 });
    }
    // Open phrase submenu (only click if not already open)
    const phraseSubmenu = page.locator('#phraseSubmenu');
    if (!await phraseSubmenu.evaluate(el => el.classList.contains('open'))) {
      await page.click('#phraseMenuBtn');
      await expect(phraseSubmenu).toHaveClass(/open/, { timeout: 3000 });
    }
  }

  async function closeAccountMenu(page) {
    // Close account dropdown if showing
    const accountDropdown = page.locator('#accountDropdownMenu');
    if (await accountDropdown.evaluate(el => el.classList.contains('show'))) {
      await page.click('#accountBtn');
    }
    // On mobile: close hamburger menu
    if (await page.locator('#mobileMenuBtn').isVisible()) {
      const menu = page.locator('#headerMenu');
      if (await menu.evaluate(el => el.classList.contains('open'))) {
        await page.click('#mobileMenuBtn');
        await expect(menu).not.toHaveClass(/open/);
      }
    }
  }

  test('Save and Load Pattern', async ({ page }) => {
    const uniqueName = `Test Pattern ${Date.now()}`;

    // 1. Create a Pattern
    const cell0 = page.locator('.cell').nth(0);
    await cell0.click();
    await page.keyboard.press('1');
    await expect(cell0.locator('.inner')).toHaveText('1');

    // 2. Save Pattern
    await openPhraseMenu(page);
    await page.click('#saveBtn');

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

    // 3. Clear Grid
    await closeAccountMenu(page);
    await page.click('#clearBtn-A');

    // Handle Custom Modal Confirm
    const clearModal = page.locator('#confirmModal');
    await expect(clearModal).toHaveClass(/open/);
    await page.click('#confirmOkBtn');
    await expect(clearModal).not.toHaveClass(/open/);
    await expect(cell0.locator('.inner')).toBeEmpty();

    // 4. Load Pattern. #loadBtn is a permanently display:none legacy element
    // with no click handler at all — the real "load" entry point is
    // #openPhraseBtn's modal (js/controls.js's showOpenPhraseModal()),
    // listing saved patterns to pick from by name.
    await openPhraseMenu(page);
    await page.click('#openPhraseBtn');

    const openModal = page.locator('#openPhraseModal');
    await expect(openModal).toHaveClass(/open/);
    await page.locator('.phrase-list-item', { hasText: uniqueName }).click();

    // Handle "unsaved changes" confirm (since we cleared the grid) — this
    // flow's confirm() call omits a title, so it uses the default 'Panafide'.
    const loadConfirmModal = page.locator('#confirmModal');
    await expect(loadConfirmModal).toHaveClass(/open/);
    await expect(page.locator('#confirmMessage')).toContainText('unsaved changes');
    await page.click('#confirmOkBtn');
    await expect(loadConfirmModal).not.toHaveClass(/open/);

    // 5. Verify Restoration
    await expect(cell0.locator('.inner')).toHaveText('1');
  });

  test('Delete Pattern', async ({ page }) => {
    const uniqueName = `Delete Me ${Date.now()}`;

    // 1. Save dummy pattern
    await openPhraseMenu(page);
    await page.click('#saveBtn');

    // Custom Modal
    await page.fill('#confirmInput', uniqueName);
    await page.click('#confirmOkBtn');
    await expect(page.locator('#confirmModal')).not.toHaveClass(/open/);

    // 2. Click Delete
    await openPhraseMenu(page);
    await page.click('#deleteBtn');

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
