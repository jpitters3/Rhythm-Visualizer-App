const { test, expect } = require('@playwright/test');
require('dotenv').config();
const { createTestUser, deleteTestUser, loginAsTestUser } = require('./utils/auth-helper');

// Chord Wheel — the Harmony domain's first live game (js/chord-wheel-game.js).
// Waits below poll actual DOM state instead of a fixed delay, since the
// wheel's ~3.2s CSS spin transition can run slower under load than its
// nominal duration (dropped frames, a backgrounded tab, etc.).

async function openGame(page) {
  await page.waitForTimeout(1500);
  await page.evaluate(() => { window.location.hash = '#games'; });
  await page.waitForSelector('.hg-tile', { timeout: 10000 });
  await page.click('.hg-tile[data-domain="harmony"]');
  await expect(page.locator('.cw-container')).toBeVisible();
}

async function waitForSlotFilled(page, slotIndex, timeout = 10000) {
  await page.waitForFunction(
    (i) => !!document.querySelector(`.cw-slot[data-id="slot-${i}"] .cw-chord-name`),
    slotIndex,
    { timeout }
  );
}

async function waitForAllSlotsFilled(page, timeout = 20000) {
  await page.waitForFunction(
    () => document.querySelectorAll('.cw-chord-name').length === 4,
    null,
    { timeout }
  );
}

test('Chord Wheel: spin, reorder, click-to-play, Any Chords mode, send to Studio', async ({ page }) => {
  test.setTimeout(150000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const u = await createTestUser(false);

  try {
    await loginAsTestUser(page, u);
    await openGame(page);

    await expect(page.locator('.cw-slot')).toHaveCount(4);
    await expect(page.locator('.cw-send-btn')).toBeDisabled();

    // Real scale (relocated <select>, same one Studio uses) + embedded virtual
    // handpan (relocated from Studio, see js/free-record.js precedent).
    await expect(page.locator('.cw-scale-select-slot #scaleSelect')).toHaveCount(1);
    await expect(page.locator('.cw-handpan-slot #handpanWrap')).toHaveCount(1);
    await expect(page.locator('.cw-wheel-svg path').first()).toBeVisible();

    // Idle state: the hint is visible and slot 1 is marked as the spin target.
    await expect(page.locator('.cw-wheel-hint')).toBeVisible();
    await expect(page.locator('.cw-slot[data-id="slot-0"]')).toHaveClass(/cw-slot-target/);

    // Tap the wheel itself (not a per-slot button) — targets slot 1, plays +
    // highlights on landing, and the hint disappears once a slot is filled.
    await page.click('.cw-wheel-wrap');
    await waitForSlotFilled(page, 0);
    await expect(page.locator('.cw-wheel-hint')).toBeHidden();
    await expect(page.locator('.chord-highlight, .chord-highlight-red').first()).toBeVisible();
    await expect(page.locator('.cw-slot[data-id="slot-1"]')).toHaveClass(/cw-slot-target/);

    // Click the filled slot: plays + highlights it again on demand.
    await page.click('.cw-slot[data-id="slot-0"]');
    await page.waitForTimeout(200);
    expect(await page.locator('.chord-highlight, .chord-highlight-red').count()).toBeGreaterThan(0);

    // Spin All 4 — sequential single-wheel spins.
    await page.click('.cw-spin-all-btn');
    await waitForAllSlotsFilled(page);
    await expect(page.locator('.cw-send-btn')).toBeEnabled();

    // Reorder: drag slot 0 onto slot 3, confirm the chord order actually changes.
    const orderBefore = await page.locator('.cw-chord-name').allTextContents();
    await page.locator('.cw-slot[data-id="slot-0"]').dragTo(page.locator('.cw-slot[data-id="slot-3"]'), { force: true });
    await page.waitForTimeout(400);
    const orderAfter = await page.locator('.cw-chord-name').allTextContents();
    expect(orderAfter).not.toEqual(orderBefore);
    expect(orderAfter.sort()).toEqual(orderBefore.sort()); // same 4 chords, new order

    // Any Chords mode: unplayable toggle appears, default excludes unplayable chords.
    await page.click('.cw-mode-btn[data-mode="any"]');
    await expect(page.locator('.cw-unplayable-toggle')).toBeVisible();
    await page.click('.cw-spin-all-btn');
    await waitForAllSlotsFilled(page);
    await expect(page.locator('.cw-chord-badge')).toHaveCount(0);

    // Including unplayable chords surfaces the muted badge and blocks Send to Studio.
    await page.check('#cwIncludeUnplayable');
    for (let i = 0; i < 6 && (await page.locator('.cw-chord-badge').count()) === 0; i++) {
      await page.click('.cw-spin-all-btn');
      await waitForAllSlotsFilled(page);
    }
    if (await page.locator('.cw-chord-badge').count() > 0) {
      await expect(page.locator('.cw-send-btn')).toBeDisabled();
    }
    await page.uncheck('#cwIncludeUnplayable');

    // Play Progression: highlight changes over time as each chord plays.
    await page.click('.cw-mode-btn[data-mode="scale"]');
    await page.click('.cw-spin-all-btn');
    await waitForAllSlotsFilled(page);
    await page.click('.cw-play-btn');
    await page.waitForTimeout(300);
    const sample1 = await page.evaluate(() => document.querySelectorAll('.chord-highlight, .chord-highlight-red').length);
    await page.waitForTimeout(750);
    const sample2 = await page.evaluate(() => document.querySelectorAll('.chord-highlight, .chord-highlight-red').length);
    expect(sample1).toBeGreaterThan(0);
    expect(sample2).toBeGreaterThan(0);

    // Expected phrase name: "Chords <abbr> <abbr>..." — abbreviated like the
    // wheel (root letter + "m" for minor), inversions appended as "I"/"II".
    const expectedAbbrevs = await page.locator('.cw-slot').evaluateAll((slots) => slots.map((slot) => {
      const full = slot.querySelector('.cw-chord-name').textContent.trim();
      const [root, quality] = full.split(' ');
      const abbr = quality === 'Minor' ? `${root}m` : root;
      const inv = slot.querySelector('.cw-chord-inversion')?.textContent.trim();
      return inv ? `${abbr} ${inv}` : abbr;
    }));
    const expectedPhraseName = `Chords ${expectedAbbrevs.join(' ')}`;

    // Send to Studio: clears the grid to exactly one measure per chord, each
    // chord on the first beat of its measure, the rest of the measure empty.
    await page.click('.cw-send-btn');
    await page.waitForTimeout(800);
    await expect(page).toHaveURL(/#studio/);
    await expect(page.locator('.measure-row')).toHaveCount(4);

    for (const measure of await page.locator('.measure-row').all()) {
      const cellTexts = await measure.locator('.cell').allTextContents();
      expect(cellTexts[0].trim().length).toBeGreaterThan(0);
      expect(cellTexts.slice(1).every(t => t.trim().length === 0)).toBe(true);
    }

    // The handpan and scale select must come back to Studio's own panel —
    // sendToStudio() navigates away, not just the Back button. The Games
    // view's markup isn't torn down on navigation (just hidden), so
    // .cw-handpan-slot itself still exists — it just shouldn't hold the
    // handpan anymore.
    await expect(page.locator('.cw-handpan-slot #handpanWrap')).toHaveCount(0);
    await expect(page.locator('#handpanWrap')).toBeVisible();
    await expect(page.locator('.cw-scale-select-slot #scaleSelect')).toHaveCount(0);
    await expect(page.locator('#scaleSelect')).toHaveCount(1);

    // Phrase name reflects the sent chords, and pre-populates the Save modal.
    await expect(page.locator('#currentPhraseName')).toHaveText(expectedPhraseName);
    await page.click('#accountBtn');
    await page.waitForSelector('#accountDropdownMenu.show', { timeout: 3000 });
    await page.click('#phraseMenuBtn');
    await page.waitForSelector('#phraseSubmenu.open', { timeout: 3000 });
    await page.click('#saveBtn');
    await expect(page.locator('#confirmInput')).toHaveValue(expectedPhraseName);
    await page.click('#confirmCancelBtn');

    expect(errors).toEqual([]);
  } finally {
    await deleteTestUser(u.user.id);
  }
});

test('Chord Wheel: Send to Studio prompts for unsaved Studio changes (cancel/discard)', async ({ page }) => {
  test.setTimeout(60000);
  const u = await createTestUser(false);

  try {
    await loginAsTestUser(page, u);
    await page.waitForTimeout(1500);

    // Dirty the Studio grid first so guardBeforeReplacingGrid() has something
    // to prompt about (js/lesson-settings.js, reused by sendToStudio()).
    await page.evaluate(() => { window.location.hash = '#studio'; });
    await page.waitForSelector('.measure-row:visible', { timeout: 20000 }).catch(() => {});
    await page.evaluate(() => document.querySelectorAll('.tour-overlay').forEach(el => el.remove()));
    await page.locator('#measures .cell').nth(0).click();
    await page.keyboard.press('1');
    await expect(page.locator('#measures .cell').nth(0)).toContainText('1');

    await openGame(page);
    await page.click('.cw-spin-all-btn');
    await waitForAllSlotsFilled(page);

    // Cancel: stays in the game, grid untouched.
    await page.click('.cw-send-btn');
    const promptMessage = page.locator('#confirmMessage');
    await expect(promptMessage).toContainText('unsaved changes');
    await page.click('#confirmCancelBtn');
    await page.waitForTimeout(300);
    await expect(page.locator('.cw-container')).toBeVisible();

    // Discard: proceeds, grid now holds the progression in Studio.
    await page.click('.cw-send-btn');
    await expect(promptMessage).toBeVisible();
    await page.click('#confirmOkBtn');
    await page.waitForTimeout(800);
    await expect(page).toHaveURL(/#studio/);
    await expect(page.locator('.measure-row')).toHaveCount(4);
  } finally {
    await deleteTestUser(u.user.id);
  }
});

test('Chord Wheel: back button restores the handpan and scale select to Studio', async ({ page }) => {
  test.setTimeout(60000);
  const u = await createTestUser(false);

  try {
    await loginAsTestUser(page, u);
    await openGame(page);

    await expect(page.locator('.cw-handpan-slot #handpanWrap')).toHaveCount(1);
    await expect(page.locator('.cw-scale-select-slot #scaleSelect')).toHaveCount(1);

    await page.click('.hg-back');
    await page.waitForTimeout(300);
    await expect(page.locator('.cw-handpan-slot')).toHaveCount(0);
    await expect(page.locator('#handpanWrap')).toHaveCount(1);
    await expect(page.locator('#scaleSelect')).toHaveCount(1);
  } finally {
    await deleteTestUser(u.user.id);
  }
});

test('Chord Wheel: switching scale resets the board and repopulates the wheel', async ({ page }) => {
  test.setTimeout(60000);
  const u = await createTestUser(false);

  try {
    await loginAsTestUser(page, u);
    await openGame(page);

    await page.click('.cw-wheel-wrap');
    await waitForSlotFilled(page, 0);

    const currentValue = await page.locator('#scaleSelect').inputValue();
    const options = await page.locator('#scaleSelect option').evaluateAll(
      opts => opts.map(o => o.value).filter(v => v && !v.startsWith('custom:'))
    );
    const otherOption = options.find(v => v !== currentValue);
    test.skip(!otherOption, 'Not enough built-in scales available to test switching');

    await page.selectOption('#scaleSelect', otherOption);
    await page.waitForTimeout(600);

    // Slots reset and the hint comes back since the board is empty again.
    await expect(page.locator('.cw-slot[data-id="slot-0"] .cw-chord-empty')).toBeVisible();
    await expect(page.locator('.cw-wheel-hint')).toBeVisible();
  } finally {
    await deleteTestUser(u.user.id);
  }
});

test('Chord Wheel: chords panel lists inversions separately, toggles the wheel pool, and persists', async ({ page }) => {
  test.setTimeout(120000);
  const u = await createTestUser(false);

  try {
    await loginAsTestUser(page, u);
    await openGame(page);

    await page.click('.cw-chords-toggle-btn');
    await expect(page.locator('.cw-chords-panel')).toBeVisible();

    const labels = await page.locator('.cw-chord-preview-btn').allTextContents();
    expect(labels.length).toBeGreaterThan(0);

    // Clicking a chord's name previews it without touching its checkbox.
    const firstRow = page.locator('.cw-chord-toggle-row').first();
    const checkedBefore = await firstRow.locator('input').isChecked();
    await firstRow.locator('.cw-chord-preview-btn').click();
    await page.waitForTimeout(150);
    expect(await firstRow.locator('input').isChecked()).toBe(checkedBefore);
    expect(await page.locator('.chord-highlight, .chord-highlight-red').count()).toBeGreaterThan(0);

    // Disable the first listed chord; it must never appear from a spin.
    const disabledLabel = labels[0];
    await firstRow.locator('input').uncheck();

    let sawDisabled = false;
    for (let i = 0; i < 10 && !sawDisabled; i++) {
      await page.click('.cw-slot[data-id="slot-0"] .cw-spin-btn');
      await waitForSlotFilled(page, 0);
      // Direct DOM read (not locator.textContent()) — a root-position chord
      // has no .cw-chord-inversion element, and auto-waiting on a selector
      // that never appears would stall each non-matching iteration.
      const rendered = await page.evaluate(() => {
        const slot = document.querySelector('.cw-slot[data-id="slot-0"]');
        const name = slot.querySelector('.cw-chord-name')?.textContent || '';
        const inv = slot.querySelector('.cw-chord-inversion')?.textContent;
        return inv ? `${name} (${inv})` : name;
      });
      if (rendered === disabledLabel) sawDisabled = true;
    }
    expect(sawDisabled).toBe(false);

    // Persists across a full reload, scoped to this user+scale.
    await page.reload();
    await page.waitForTimeout(1500);
    await openGame(page);
    await page.click('.cw-chords-toggle-btn');
    await expect(page.locator('.cw-chord-toggle-row').first().locator('input')).not.toBeChecked();
  } finally {
    await deleteTestUser(u.user.id);
  }
});

test('Chord Wheel: returning to #games after Send to Studio shows a fresh hub, not a stale game', async ({ page }) => {
  test.setTimeout(60000);
  const u = await createTestUser(false);

  try {
    await loginAsTestUser(page, u);
    await openGame(page);

    await page.click('.cw-spin-all-btn');
    await waitForAllSlotsFilled(page);
    await page.click('.cw-send-btn');
    await page.waitForTimeout(800);
    await expect(page).toHaveURL(/#studio/);

    // Returning via direct navigation (not the game's own Back button) must
    // show the hub again, not the leftover game screen with no handpan.
    await page.evaluate(() => { window.location.hash = '#games'; });
    await page.waitForTimeout(500);
    await expect(page.locator('.hg-grid')).toBeVisible();

    await page.click('.hg-tile[data-domain="harmony"]');
    await expect(page.locator('.cw-container')).toBeVisible();
    await expect(page.locator('.cw-handpan-slot #handpanWrap')).toHaveCount(1);
  } finally {
    await deleteTestUser(u.user.id);
  }
});
