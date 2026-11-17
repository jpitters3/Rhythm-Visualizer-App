// @ts-check
const { test, expect } = require('./fixtures');
const { gotoStudio, clearGrid, closeMobileControlsIfNeeded } = require('./helpers');

const rows = (page) => page.locator('#measures .measure-row');
const header = (page, m) => rows(page).nth(m).locator('.measure-header');
const pop = (page) => page.locator('.measure-pop');

async function ensureMeasures(page, n) {
  while (await rows(page).count() < n) await page.click('.addMeasureBtn:visible');
}

async function setNote(page, index, note) {
  await page.evaluate(([i, n]) => {
    window.dispatchEvent(new CustomEvent('notegrid:setNote', { detail: { index: i, note: n } }));
  }, [index, note]);
  // Signed out, the first note brings up a one-time "create an account" notice
  const notice = page.locator('#confirmModal.open', { hasText: "isn't lost" });
  if (await notice.waitFor({ timeout: 1500 }).then(() => true, () => false)) {
    await page.click('#confirmCancelBtn');
    await expect(notice).toBeHidden();
  }
}

async function stepsPerMeasure(page) {
  return rows(page).first().locator('.cell').count();
}

// Synthetic touch pointer events: Playwright has no long-press gesture
async function touch(page, locator, holdMs) {
  const box = await locator.boundingBox();
  const x = box.x + Math.min(20, box.width / 2);
  const y = box.y + box.height / 2;
  await locator.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 7, isPrimary: true, button: 0, clientX: x, clientY: y, bubbles: true });
  await page.waitForTimeout(holdMs);
  await locator.dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 7, isPrimary: true, button: 0, clientX: x, clientY: y, bubbles: true });
}

test.describe('Measure sections', () => {
  test.beforeEach(async ({ page }) => {
    await gotoStudio(page);
    await page.waitForSelector('.measure-row');
    await clearGrid(page, 'A');
    await closeMobileControlsIfNeeded(page);
    await ensureMeasures(page, 3);
  });

  test('Click a measure to colour it; undo removes the colour', { tag: '@core' }, async ({ page }) => {
    await header(page, 1).click();
    await expect(pop(page)).toBeVisible();
    await expect(rows(page).nth(1)).toHaveClass(/measure-selected/);

    await pop(page).locator('.measure-swatch[data-color="blue"]').click();
    await expect(rows(page).nth(1)).toHaveAttribute('data-color', 'blue');
    await expect(rows(page).nth(0)).not.toHaveAttribute('data-color', /.+/);

    await page.keyboard.press('Escape');
    await expect(pop(page)).toBeHidden();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(rows(page).nth(1)).not.toHaveAttribute('data-color', /.+/);
  });

  test('Shift-click colours and names a range; the name shows once', { tag: '@core' }, async ({ page, isMobile }) => {
    test.skip(isMobile, 'Keyboard modifiers are desktop-only');
    await header(page, 0).click();
    await header(page, 2).click({ modifiers: ['Shift'] });
    await expect(pop(page).locator('.measure-pop-title')).toHaveText('3 measures');

    await pop(page).locator('.measure-swatch[data-color="green"]').click();
    await pop(page).locator('.measure-pop-name').fill('Chorus');
    await pop(page).locator('.measure-pop-name').press('Enter');

    for (let m = 0; m < 3; m++) await expect(rows(page).nth(m)).toHaveAttribute('data-color', 'green');
    await expect(page.locator('#measures .measure-section-name')).toHaveCount(1);
    await expect(rows(page).nth(0).locator('.measure-section-name')).toHaveText('Chorus');
  });

  test('The name field is ready to type into; Enter keeps it and closes', { tag: '@core' }, async ({ page, isMobile }) => {
    test.skip(isMobile, 'Touch skips autofocus so the keyboard does not pop up');
    await header(page, 0).click();
    await pop(page).locator('.measure-swatch[data-color="blue"]').click();
    await page.keyboard.type('Intro');
    await page.keyboard.press('Enter');
    await expect(pop(page)).toBeHidden();
    await expect(rows(page).nth(0).locator('.measure-section-name')).toHaveText('Intro');
    await expect(rows(page).nth(0)).toHaveAttribute('data-color', 'blue');

    // Reopening selects the existing name, so typing replaces it
    await header(page, 0).click();
    await page.keyboard.type('Verse');
    await page.keyboard.press('Enter');
    await expect(rows(page).nth(0).locator('.measure-section-name')).toHaveText('Verse');
  });

  test('Ctrl/Cmd-click toggles single measures into the selection', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Keyboard modifiers are desktop-only');
    await header(page, 0).click();
    await header(page, 2).click({ modifiers: ['ControlOrMeta'] });
    await expect(pop(page).locator('.measure-pop-title')).toHaveText('2 measures');
    await pop(page).locator('.measure-swatch[data-color="red"]').click();
    await expect(rows(page).nth(0)).toHaveAttribute('data-color', 'red');
    await expect(rows(page).nth(1)).not.toHaveAttribute('data-color', /.+/);
    await expect(rows(page).nth(2)).toHaveAttribute('data-color', 'red');
  });

  test('Drag a measure above another to reorder it', { tag: '@core' }, async ({ page, isMobile }) => {
    test.skip(isMobile, 'Mouse drag; touch is covered by the long-press test');
    const s = await stepsPerMeasure(page);
    await setNote(page, s, '3'); // first step of measure 2

    await header(page, 1).click();
    await pop(page).locator('.measure-swatch[data-color="purple"]').click();
    await page.keyboard.press('Escape');

    const from = await header(page, 1).boundingBox();
    const to = await rows(page).nth(0).boundingBox();
    await page.mouse.move(from.x + 30, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + 30, from.y - 20, { steps: 4 });
    await expect(page.locator('#measures')).toHaveClass(/measures-reordering/);
    await page.mouse.move(to.x + 30, to.y + 8, { steps: 10 });
    await page.mouse.up();

    await expect(page.locator('#measures')).not.toHaveClass(/measures-reordering/);
    await expect(rows(page).nth(0)).toHaveAttribute('data-color', 'purple');
    await expect(rows(page).nth(0).locator('.cell').first().locator('.inner')).toHaveText('3');
    await expect(rows(page).nth(1)).not.toHaveAttribute('data-color', /.+/);
    await expect(page.locator('.measure-drag-ghost')).toHaveCount(0);

    // One undo puts it back
    await page.keyboard.press('ControlOrMeta+z');
    await expect(rows(page).nth(1)).toHaveAttribute('data-color', 'purple');
  });

  test('A short drag over the next card is enough to swap with it', { tag: '@core' }, async ({ page, isMobile }) => {
    test.skip(isMobile, 'Mouse drag');
    await setNote(page, 0, '4'); // measure 1 is the one we drag
    // Adding measures scrolled the grid down; bring measure 1 out from under the toolbar
    await rows(page).nth(0).evaluate(el => el.scrollIntoView({ block: 'center' }));
    await expect(async () => {
      const a = await rows(page).nth(0).boundingBox();
      await page.waitForTimeout(100);
      const b = await rows(page).nth(0).boundingBox();
      expect(b.y).toBe(a.y); // smooth scrolling has settled
    }).toPass();

    const card = await rows(page).nth(0).boundingBox();
    const grip = await header(page, 0).boundingBox();
    const x = grip.x + 30;
    const y = grip.y + grip.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + card.height * 0.3, { steps: 8 });
    // The neighbour has already moved up into the old slot, before dropping
    await expect(page.locator('#measures .measure-row').nth(1)).toHaveClass(/measure-drag-slot/);
    await page.mouse.up();

    await expect(rows(page).nth(1).locator('.cell').first().locator('.inner')).toHaveText('4');
    await expect(rows(page).nth(0).locator('.cell').nth(0).locator('.inner')).toHaveText('');
  });

  test('Touch: long-press opens the picker; tapping another measure extends the range', { tag: '@core' }, async ({ page }) => {
    await touch(page, header(page, 0), 600);
    await expect(pop(page)).toBeVisible();
    await expect(rows(page).nth(0)).toHaveClass(/measure-selected/);

    // Any part of another card (a cell here) extends while selecting
    await touch(page, rows(page).nth(2).locator('.cell').first(), 50);
    await expect(pop(page).locator('.measure-pop-title')).toHaveText('3 measures');

    await pop(page).locator('.measure-swatch[data-color="orange"]').click();
    for (let m = 0; m < 3; m++) await expect(rows(page).nth(m)).toHaveAttribute('data-color', 'orange');

    // A name typed on touch is kept when the picker is closed by tapping away
    await pop(page).locator('.measure-pop-name').fill('Verse');
    await pop(page).locator('.measure-pop-close').click();
    await expect(pop(page)).toBeHidden();
    await expect(rows(page).nth(0).locator('.measure-section-name')).toHaveText('Verse');
  });

  test('Colours stay with their measure when an earlier measure is deleted', { tag: '@core' }, async ({ page, isMobile }) => {
    test.skip(isMobile, 'Uses desktop click to open the picker');
    await header(page, 2).click();
    await pop(page).locator('.measure-swatch[data-color="red"]').click();
    await page.keyboard.press('Escape');

    await rows(page).nth(0).locator('.cell').first().click();
    await page.click('.delMeasureBtn:visible');
    await page.locator('#confirmModal.open').waitFor({ timeout: 5000 });
    await page.click('#confirmOkBtn');

    await expect(rows(page).nth(1)).toHaveAttribute('data-color', 'red');
    await expect(rows(page).nth(0)).not.toHaveAttribute('data-color', /.+/);
  });

  test('A quick touch tap on a measure header does nothing', async ({ page }) => {
    await touch(page, header(page, 1), 60);
    await expect(pop(page)).toBeHidden();
  });
});
