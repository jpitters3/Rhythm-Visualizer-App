// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Pattern Management', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Clear local storage to start fresh for each test? 
    // Or at least ensure no collision. Using unique names is better.
  });

  test('Save and Load Pattern', async ({ page }) => {
    const uniqueName = `Test Pattern ${Date.now()}`;

    // 1. Create a Pattern
    // Click first cell
    const cell0 = page.locator('.cell').nth(0);
    await cell0.click();
    await page.keyboard.press('1');
    await expect(cell0.locator('.inner')).toHaveText('1');

    // 2. Save Pattern
    // Handle Prompt
    page.once('dialog', dialog => {
      expect(dialog.message()).toContain('Save pattern as');
      dialog.accept(uniqueName);
    });

    await page.click('#fileDropdownBtn');
    await page.click('#saveBtn');

    // Wait for save logic (it might verify via alert or UI update)
    // patternSelect should have the new val
    const select = page.locator('#patternSelect');
    await expect(select).toHaveValue(uniqueName);

    // 3. Clear Grid
    // Handle Clear Confirm
    page.once('dialog', dialog => {
      dialog.accept();
    });
    await page.click('#clearBtn');
    await expect(cell0.locator('.inner')).toBeEmpty();

    // 4. Load Pattern
    // Select is already set to uniqueName from save, but let's Ensure
    await select.selectOption(uniqueName);

    // Handle "Unsaved Changes" check (since we cleared, it might be clean, but just in case)
    // Actually, confirm logic for Load might trigger if state is dirty.
    // We just cleared, so it should be clean.

    await page.click('#fileDropdownBtn');
    await page.click('#loadBtn');

    // 5. Verify Restoration
    await expect(cell0.locator('.inner')).toHaveText('1');
  });

  test('Delete Pattern', async ({ page }) => {
    const uniqueName = `Delete Me ${Date.now()}`;

    // 1. Save dummy pattern
    page.once('dialog', dialog => dialog.accept(uniqueName));
    await page.click('#fileDropdownBtn');
    await page.click('#saveBtn');

    // 2. Click Delete
    // Handle Confirm
    page.once('dialog', dialog => {
      expect(dialog.message()).toContain('Delete');
      dialog.accept();
    });

    await page.click('#fileDropdownBtn');
    await page.click('#deleteBtn');

    // 3. Verify Removal
    // The select should no longer have this option
    const options = page.locator('#patternSelect option');
    const texts = await options.allInnerTexts();
    expect(texts).not.toContain(uniqueName);
  });

});
