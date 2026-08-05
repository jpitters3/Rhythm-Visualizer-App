// @ts-check
const { test, expect } = require('@playwright/test');
const { gotoStudio } = require('./helpers');
const { createTestUser, deleteTestUser, loginAsTestUser } = require('./utils/auth-helper');

// #phraseMenuBtn/#phraseSubmenu (Save/Import/Export/Share) live inside
// #navAccountWrapper, which is display:none until signed in — this has been
// true since the app's original routing redesign, not a recent regression.
// Reaching this menu at all requires being authenticated first.
async function openPhraseMenu(page) {
  if (await page.locator('#mobileMenuBtn').isVisible()) {
    const menu = page.locator('#headerMenu');
    if (!await menu.evaluate(el => el.classList.contains('open'))) {
      await page.click('#mobileMenuBtn');
    }
  }
  const accountDropdown = page.locator('#accountDropdownMenu');
  if (!await accountDropdown.evaluate(el => el.classList.contains('show'))) {
    await page.click('#accountBtn');
  }
  const phraseSubmenu = page.locator('#phraseSubmenu');
  if (!await phraseSubmenu.evaluate(el => el.classList.contains('open'))) {
    await page.click('#phraseMenuBtn');
  }
}

// #importBtn now lives inside the "Admin Tools" submenu (js/admin.js's
// adminMenuBtn/adminSubmenu toggle) rather than the Phrase submenu —
// Import JSON is admin-only.
async function openAdminSubmenu(page) {
  if (await page.locator('#mobileMenuBtn').isVisible()) {
    const menu = page.locator('#headerMenu');
    if (!await menu.evaluate(el => el.classList.contains('open'))) {
      await page.click('#mobileMenuBtn');
    }
  }
  const accountDropdown = page.locator('#accountDropdownMenu');
  if (!await accountDropdown.evaluate(el => el.classList.contains('show'))) {
    await page.click('#accountBtn');
  }
  const adminSubmenu = page.locator('#adminSubmenu');
  if (!await adminSubmenu.evaluate(el => el.classList.contains('open'))) {
    await page.click('#adminMenuBtn');
  }
}

test.describe('Undo/Redo Features', () => {

  test.beforeEach(async ({ page }) => {
    await gotoStudio(page);
    await page.waitForSelector('.measure-row');
  });

  test('Undo/Redo Note Entry', async ({ page }) => {
    // 1. Initial State: grid empty
    // (Assuming default empty grid or we clear it)
    await page.click('#clearBtn-A');
    await page.locator('#confirmModal.open').waitFor({ timeout: 5000 });
    await page.click('#confirmOkBtn');

    // 2. Add a note (Click first cell)
    const cell0 = page.locator('.cell').nth(0);
    await cell0.click();
    // Assuming click sets caret, verify we can write note?
    // Actually, simple click selects. We need to type '1' or similar.
    await page.keyboard.press('1');

    // Verify Label '1'
    await expect(cell0.locator('.inner')).toHaveText('1');

    // 3. Undo
    await page.keyboard.press('Meta+z'); // Cmd+Z
    await expect(cell0.locator('.inner')).toBeEmpty();

    // 4. Redo
    await page.keyboard.press('Meta+Shift+z'); // Cmd+Shift+Z
    await expect(cell0.locator('.inner')).toHaveText('1');
  });

  // The Phrase menu (Save/Import/Export/Share) is only reachable once signed
  // in — these two need a real logged-in user to reach it at all.
  test.describe('authenticated', () => {
    let testUser;

    test.beforeEach(async ({ page }) => {
      testUser = await createTestUser(true); // Import JSON is now admin-only
      await loginAsTestUser(page, testUser);
      // A successful login redirects to #dashboard (js/controls.js) — head
      // back to Studio since these tests edit the grid.
      await page.goto('/#studio');
      await page.waitForSelector('.measure-row');
    });

    test.afterEach(async () => {
      if (testUser) await deleteTestUser(testUser.user.id);
    });

    test('Data Loss Prevention', async ({ page }) => {
      // 1. Clean state
      await page.click('#clearBtn-A');
      await page.locator('#confirmModal.open').waitFor({ timeout: 5000 });
      await page.click('#confirmOkBtn');

      // 2. Make change
      await page.locator('.cell').nth(0).click();
      await page.keyboard.press('1');

      // 3. Verify Dirty State via Import Prompt
      // App uses custom #confirmModal (not native browser dialog)
      await openAdminSubmenu(page);
      await page.click('#importBtn');

      // Should show "Unsaved Changes" custom confirm modal
      await page.locator('#confirmModal.open').waitFor({ timeout: 5000 });
      const confirmMsg = await page.locator('#confirmMessage').textContent();
      expect(confirmMsg.toLowerCase()).toContain('unsaved');
      await page.click('#confirmCancelBtn'); // Cancel import

      // 4. Undo and Verify Clean State
      await page.keyboard.press('Escape'); // ensure no modals block
      await page.keyboard.press('Meta+z');

      // Now clicking Import should show "Import Pattern" prompt directly
      await openAdminSubmenu(page);
      await page.click('#importBtn');

      // Should go straight to "Import Pattern" prompt (no unsaved changes warning)
      await page.locator('#confirmModal.open').waitFor({ timeout: 5000 });
      const promptTitle = await page.locator('#confirmTitle').textContent();
      expect(promptTitle).toContain('Import Pattern');
      await page.click('#confirmCancelBtn'); // Cancel without importing
    });

    /*
     * Share Pattern — authenticated flow. The Phrase menu (and so #shareBtn)
     * is unreachable as a guest at all, so this no longer tests "clicking
     * Share while signed out" (see openPhraseMenu's comment above); it now
     * covers the real success path — name prompt → share link modal.
     */
    test('Share Pattern: generates a link', async ({ page }) => {
      // Give the pattern some content so there's something to share.
      await page.locator('.cell').nth(0).click();
      await page.keyboard.press('1');

      await openPhraseMenu(page);
      await page.click('#shareBtn');

      // "Share pattern name:" custom prompt modal
      await page.locator('#confirmModal.open').waitFor({ timeout: 5000 });
      await page.fill('#confirmInput', `Test Share ${Date.now()}`);
      await page.click('#confirmOkBtn');

      // Share link modal opens with a populated, copyable URL
      const shareLinkModal = page.locator('#shareLinkModal');
      await expect(shareLinkModal).toHaveClass(/open/, { timeout: 10000 });
      const shareLinkInput = page.locator('#shareLinkInput');
      await expect(shareLinkInput).toHaveValue(/\?share=/);

      await page.click('#shareLinkCloseBtn');
    });
  });

});
