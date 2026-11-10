const { test, expect } = require('./fixtures');
const { gotoStudio, clearGrid, closeMobileControlsIfNeeded } = require('./helpers');

// Regression: a chord/multi cell's label is an array. Duplicating a measure
// (measure-actions.js duplicateSelection) and history snapshots (pattern-crud.js
// serializePattern) used slice() — a shallow copy — so the copy shared the same
// array and an in-place sub-note edit mutated the original / broke undo.

test('duplicating a measure copies chords by value', async ({ page }) => {
  await gotoStudio(page);
  await page.waitForSelector('.measure-row');
  await clearGrid(page, 'A');

  const result = await page.evaluate(async () => {
    // main.js re-exports these (see its own comment on why) — importing its
    // actual deployed URL, not the source path (which only resolves against
    // Vite's dev server), returns the same live singletons already running
    // on the page, since ES module imports are cached by resolved URL.
    const entryUrl = document.querySelector('script[type="module"][src*="main"]').src;
    const { gridA, renderAllMeasures, duplicateSelection, setRange } = await import(entryUrl);

    const spm = gridA.stepsPerMeasure;
    gridA.innerLabels[0] = ['1', '', '3', '']; // chord at step 0 of measure 1
    renderAllMeasures(gridA);

    setRange(0, spm - 1, gridA);                // select measure 1
    await duplicateSelection(gridA);             // -> measure 2 is a copy

    const orig = gridA.innerLabels[0];
    const dup = gridA.innerLabels[spm];        // same position in measure 2

    const sameRef = orig === dup;

    // edit the DUPLICATE's chord in place (what setInnerLabel does per sub-note)
    dup[0] = '9';

    return {
      sameRef,
      dupAfter: JSON.stringify(dup),
      origAfter: JSON.stringify(orig),
    };
  });

  console.log(JSON.stringify(result));
  expect(result.sameRef, 'duplicated chord must be a distinct array').toBe(false);
  expect(result.origAfter).toBe('["1","","3",""]'); // untouched
  expect(result.dupAfter).toBe('["9","","3",""]');
});

test('undo restores a chord sub-note edit', async ({ page }) => {
  await gotoStudio(page);
  await page.waitForSelector('.measure-row');
  await clearGrid(page, 'A');
  await closeMobileControlsIfNeeded(page);

  // Through the UI, not app internals: a production build only exports
  // HistoryManager from the entry chunk by accident of code splitting.
  // Each typed note pushes an undo snapshot, then edits the chord in place.
  const cell = page.locator('.cell').nth(0);
  const subDots = cell.locator('.sub-dot');
  await cell.dblclick();
  await subDots.nth(0).click();
  await page.keyboard.press('1');
  await subDots.nth(2).click();
  await page.keyboard.press('3');
  await subDots.nth(0).click();
  await page.keyboard.press('9');
  await expect(subDots.nth(0)).toHaveText('9');

  await page.keyboard.press('ControlOrMeta+z');
  await expect(subDots.nth(0)).toHaveText('1'); // undo actually reverts it
  await expect(subDots.nth(2)).toHaveText('3');
});
