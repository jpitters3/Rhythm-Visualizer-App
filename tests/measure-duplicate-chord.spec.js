const { test, expect } = require('@playwright/test');
const { gotoStudio, clearGrid } = require('./helpers');

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

  const result = await page.evaluate(async () => {
    const entryUrl = document.querySelector('script[type="module"][src*="main"]').src;
    const { gridA, renderAllMeasures, HistoryManager } = await import(entryUrl);

    gridA.innerLabels[0] = ['1', '', '3', ''];
    renderAllMeasures(gridA);

    HistoryManager.pushState();       // snapshot with chord [1,3]
    gridA.innerLabels[0][0] = '9';    // in-place sub-note edit -> [9,3]
    const afterEdit = JSON.stringify(gridA.innerLabels[0]);

    await HistoryManager.undo();
    const afterUndo = JSON.stringify(gridA.innerLabels[0]);
    return { afterEdit, afterUndo };
  });

  console.log(JSON.stringify(result));
  expect(result.afterEdit).toBe('["9","","3",""]');
  expect(result.afterUndo).toBe('["1","","3",""]'); // undo actually reverts it
});
