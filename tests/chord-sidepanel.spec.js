// @ts-check
const { test, expect } = require('@playwright/test');
const { gotoStudio } = require('./helpers');

// Chords sidepanel (js/chord-sidepanel.js) + full-screen stage (js/chord-stage.js).

async function openChordPanel(page) {
  const desktopBtn = page.locator('.handpan-tabs [data-chord-panel]');
  if (await desktopBtn.isVisible()) {
    await desktopBtn.click();
  } else {
    await page.click('#handpanOptionsBtn');
    await page.click('#handpanOptionsMenu [data-chord-panel]');
  }
  await expect(page.locator('#chordSidebar')).toHaveClass(/open/);
  await expect(page.locator('#chordList .cs-chord-item').first()).toBeVisible();
}

// Stepped HTML5 drag: locator.dragTo() jumps straight to the target, which
// doesn't start a native drag here.
async function drag(page, source, target) {
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  await page.mouse.move(from.x + from.width - 20, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width - 10, from.y + from.height / 2 + 10, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2 + 10, { steps: 10 });
  await page.mouse.up();
}

function slots(page, sectionIndex) {
  return page.locator('#csSections .cs-section').nth(sectionIndex).locator('.cs-slot');
}

test.describe('Chords sidepanel', () => {
  test.beforeEach(async ({ page }) => {
    await gotoStudio(page);
    await page.waitForSelector('.measure-row');
    // Each test starts from a fresh, unsaved song.
    await page.evaluate(() => Object.keys(localStorage)
      .filter(k => k.startsWith('chord_song_v1_'))
      .forEach(k => localStorage.removeItem(k)));
  });

  test('cards show a flat chord shape and highlight the pan', async ({ page, isMobile }) => {
    await openChordPanel(page);
    const item = page.locator('#chordList .cs-chord-item').first();
    await expect(item.locator('.chord-chip')).toBeVisible();
    await expect(item.locator('svg.chord-shape-flat')).toBeVisible();
    expect(await item.locator('.note-dot.active').count()).toBeGreaterThanOrEqual(2);

    if (!isMobile) {
      await item.hover();
      await expect(page.locator('.hp-dot.chord-highlight').first()).toBeAttached();
    }
    await item.click();
    await expect(item).toHaveClass(/pressed/);
    // On touch the highlight stays after a tap (no hover-out to clear it).
    if (isMobile) {
      await expect(item).toHaveClass(/active/);
      await expect(page.locator('.hp-dot.chord-highlight').first()).toBeAttached();
    }
  });

  test('build sections, send to Studio, and run the stage', async ({ page, browserName, isMobile }) => {
    await openChordPanel(page);
    const items = page.locator('#chordList .cs-chord-item');

    // Tap-to-add fills Verse A in order.
    for (let i = 0; i < 3; i++) {
      await items.nth(i).hover();
      await items.nth(i).locator('.cs-chord-add-btn').click();
    }
    await expect(slots(page, 0).locator('.cs-slot-name')).toHaveCount(3);

    // Drag-and-drop (desktop Chromium; HTML5 DnD isn't driven on touch).
    if (!isMobile && browserName === 'chromium') {
      await drag(page, items.nth(3), slots(page, 0).nth(3));
      await expect(slots(page, 0).nth(3)).toHaveClass(/filled/);
      // Moving a slot swaps it with the target.
      const first = await slots(page, 0).nth(0).locator('.cs-slot-name').textContent();
      await drag(page, slots(page, 0).nth(0), slots(page, 0).nth(1));
      await expect(slots(page, 0).nth(1).locator('.cs-slot-name')).toHaveText(first || '');
    }
    const verseCount = await slots(page, 0).locator('.cs-slot-name').count();

    // A second section, which becomes the tap-to-add target; trim to 2 slots.
    await page.click('#csAddSectionBtn');
    const chorus = page.locator('#csSections .cs-section').nth(1);
    await expect(chorus.locator('.cs-section-name')).toHaveValue('Verse B');
    await chorus.locator('.cs-section-name').fill('Chorus');
    // Leave the field: Safari's name-suggestion popup swallows the next outside click.
    await chorus.locator('.cs-section-name').press('Tab');
    await items.nth(4).hover();
    await items.nth(4).locator('.cs-chord-add-btn').click();
    await items.nth(0).hover();
    await items.nth(0).locator('.cs-chord-add-btn').click();
    await chorus.locator('.cs-slot').nth(3).locator('.cs-slot-remove').click({ force: true });
    await chorus.locator('.cs-slot').nth(2).locator('.cs-slot-remove').click({ force: true });
    await expect(chorus.locator('.cs-slot')).toHaveCount(2);
    await expect(chorus.locator('.cs-slot-name')).toHaveCount(2);
    const total = verseCount + 2;

    // Persists per scale across reloads.
    await page.reload();
    await page.waitForSelector('.measure-row');
    await openChordPanel(page);
    await expect(page.locator('#csSections .cs-section')).toHaveCount(2);
    await expect(page.locator('#csSections .cs-section').nth(1).locator('.cs-section-name')).toHaveValue('Chorus');

    // Stage: every chord in one row, grouped by section, NOW/NEXT marked.
    await page.click('#csStageBtn');
    const stage = page.locator('#chordStage');
    await expect(stage).toBeVisible();
    await expect(stage.locator('.cs-stage-card')).toHaveCount(total);
    await expect(stage.locator('.cs-stage-group')).toHaveCount(2);
    await expect(stage.locator('.cs-stage-card').nth(0)).toHaveClass(/is-now/);
    await expect(stage.locator('.cs-stage-card').nth(1)).toHaveClass(/is-next/);
    await page.keyboard.press('ArrowRight');
    await expect(stage.locator('.cs-stage-card').nth(1)).toHaveClass(/is-now/);
    await expect(stage.locator('.cs-stage-card').nth(0)).toHaveClass(/is-past/);
    // Last chord of Verse A → Chorus group is flagged as next.
    await stage.locator('.cs-stage-card').nth(verseCount - 1).click();
    await expect(stage.locator('.cs-stage-group').nth(1)).toHaveClass(/is-next/);

    // The enlarged NOW card stays below its section line.
    const nowCard = stage.locator('.cs-stage-card.is-now');
    await page.waitForTimeout(600); // let the scale transition settle
    const cardTop = (await nowCard.boundingBox()).y;
    const lineTop = (await stage.locator('.cs-stage-group').nth(0).locator('.cs-stage-cards').boundingBox()).y;
    expect(cardTop).toBeGreaterThan(lineTop);

    // Metronome toggles with M; auto-advance moves on to the next chord.
    await page.keyboard.press('m');
    await expect(stage.locator('[data-stage="metro"]')).toHaveClass(/on/);
    await expect(stage.locator('[data-stage="sub"]')).toBeEnabled();
    await stage.locator('[data-stage="bpm"]').fill('120');
    await stage.locator('[data-stage="bpm"]').press('Tab');
    await stage.locator('[data-stage="beats"]').selectOption('2');
    await stage.locator('[data-stage="play"]').click();
    await expect(stage.locator('.cs-stage-card').nth(verseCount)).toHaveClass(/is-now/, { timeout: 5000 });
    await expect(stage.locator('.cs-stage-group').nth(1)).toHaveClass(/is-now/);
    await page.keyboard.press('Escape');
    await expect(stage).toBeHidden();

    // Send to Studio: one measure per chord, chord on each first step.
    await page.click('#csSendBtn');
    await expect(page.locator('#csSendBtn')).toHaveText(/Sent/);
    await expect(page.locator('.cell.multi-mode')).toHaveCount(total);
  });
});
