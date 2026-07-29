const { test, expect } = require('@playwright/test');
const { gotoStudio } = require('./helpers');

test.describe('Virtual Handpan Tap-to-Play', () => {

  test.beforeEach(async ({ page }) => {
    // .handpan-wrap has a perpetual ambient "breathing" scale animation
    // (css/handpanmap.css) that respects prefers-reduced-motion — without
    // this, Playwright's click stability check never settles on any .hp-dot.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await gotoStudio(page);
    await page.waitForSelector('.cell');
    await page.click('#clearBtn-A');
    await page.locator('#confirmModal.open').waitFor({ timeout: 5000 });
    await page.click('#confirmOkBtn');

    // Writing the very first note as a signed-out guest triggers a one-time
    // "sign in to save your work" modal (controls.js). gotoStudio's locator
    // handler auto-dismisses it, but that dismiss-click lands outside the
    // grid and clears the current selection as a side effect (notegrid.js's
    // "click outside" handler). Burn through it here, before real assertions.
    await page.locator('#measures .cell').first().click();
    await page.keyboard.press('d');
    await page.click('#clearBtn-A');
    await page.locator('#confirmModal.open').waitFor({ timeout: 5000 });
    await page.click('#confirmOkBtn');
  });

  test('Tapping a note plays it, highlights it, and writes it to the selected cell', async ({ page }) => {
    const cell0 = page.locator('#measures .cell').first();
    await cell0.click();
    await expect(cell0).toHaveClass(/selected/);

    const dot1 = page.locator('.hp-dot[data-note="1"]');
    await dot1.click();

    // pulseDot() adds .active synchronously then removes it after a timer —
    // catch it right away rather than waiting.
    await expect(dot1).toHaveClass(/active/);
    await expect(cell0).toHaveText('1');
  });

  test('Compose mode advances the caret after a tap; without it the caret stays put', async ({ page }) => {
    const cell0 = page.locator('#measures .cell').nth(0);
    const cell1 = page.locator('#measures .cell').nth(1);

    // Compose mode OFF (default): writes but does not advance — a second tap
    // overwrites cell0 rather than landing in cell1.
    await cell0.click();
    await page.locator('.hp-dot[data-note="2"]').click();
    await expect(cell0).toHaveText('2');
    await page.locator('.hp-dot[data-note="3"]').click();
    await expect(cell0).toHaveText('3');
    await expect(cell1).toHaveText('');

    // Compose mode ON: writes and advances, so a second tap lands in cell1.
    await page.click('#composeBtn');
    await cell0.click();
    await page.locator('.hp-dot[data-note="1"]').click();
    await expect(cell0).toHaveText('1');
    await page.locator('.hp-dot[data-note="2"]').click();
    await expect(cell1).toHaveText('2');
  });

  test('Alt+click writes without advancing, even in compose mode', async ({ page }) => {
    await page.click('#composeBtn');

    const cell0 = page.locator('#measures .cell').nth(0);
    const cell1 = page.locator('#measures .cell').nth(1);
    await cell0.click();

    await page.locator('.hp-dot[data-note="1"]').click({ modifiers: ['Alt'] });
    await expect(cell0).toHaveText('1');

    // A follow-up (non-alt) tap should still land in cell0, proving the
    // Alt tap above did not advance the caret.
    await page.locator('.hp-dot[data-note="2"]').click();
    await expect(cell0).toHaveText('2');
    await expect(cell1).toHaveText('');
  });

  test('Tapping a note plays and highlights it even with no cell selected', async ({ page }) => {
    // Escape clears the active caret/selection (see keyboard_shortcuts.spec.js)
    await page.locator('#measures .cell').first().click();
    await page.keyboard.press('Escape');

    const dot1 = page.locator('.hp-dot[data-note="1"]');
    await dot1.click();
    await expect(dot1).toHaveClass(/active/);

    // Nothing should have been written anywhere on the grid
    await expect(page.locator('#measures .cell.selected')).toHaveCount(0);
  });
});
