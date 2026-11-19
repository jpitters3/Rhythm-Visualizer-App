const { test, expect } = require('./fixtures');
require('dotenv').config();
const { createTestUser, deleteTestUser, loginAsTestUser } = require('./utils/auth-helper');

// Rhythm by Ear (js/rhythm-ear-game.js): hear a hidden phrase, rebuild it on
// the relocated Studio grid. Phrase rules are unit-tested separately.

async function openGame(page) {
  await page.waitForTimeout(1500);
  await page.evaluate(() => { window.location.hash = '#games'; });
  await page.waitForSelector('.hg-tile', { timeout: 10000 });
  await page.click('.hg-tile[data-domain="rhythm"]');
  await page.click('.hg-tile[data-game="rhythm-ear"]');
  await expect(page.locator('.re-container')).toBeVisible();
  // How to play opens by itself the first time.
  await expect(page.locator('.re-howto')).toBeVisible();
  await page.click('[data-action="howto-close"]');
  await expect(page.locator('.re-howto')).toBeHidden();
}

test('Rhythm by Ear: opens on Level 1; All levels lists every level without its rules', async ({ page }) => {
  test.setTimeout(60000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const u = await createTestUser(false);

  try {
    await loginAsTestUser(page, u);
    await openGame(page);

    await expect(page.locator('.re-status-level')).toHaveText('Level 1');
    await expect(page.locator('.re-status-round')).toHaveText('Round 1 of 3');
    await expect(page.locator('.re-round-chip')).toHaveCount(3);
    await expect(page.locator('.re-level-card')).toHaveCount(0);
    await expect(page.locator('.hg-header')).toBeHidden(); // play mode: no page header
    await page.click('[data-action="howto"]');
    await expect(page.locator('.re-howto')).toContainText('not part of the rhythm');
    await expect(page.locator('.re-howto')).toContainText('Ding → Tak → Slap → empty');
    await page.click('[data-action="howto-close"]');
    await expect(page.locator('.re-grid-slot #measures')).toHaveCount(1);
    await expect(page.locator('#measures .cell')).toHaveCount(8);
    await expect(page.locator('#measures .cell[data-index="0"]')).toHaveClass(/label-ding/);

    await page.click('.re-topbar [data-action="levels"]');
    await expect(page.locator('.re-category')).toHaveCount(2);
    await expect(page.locator('.re-level-card')).toHaveCount(17);
    await expect(page.locator('.hg-header')).toBeVisible();
    // Just the number and Play: no rules, no rhythm names.
    await expect(page.locator('.re-level-card').first()).toHaveText(/^\s*Level 1\s*Play →\s*$/);
    await expect(page.locator('.re-level-card[data-cat="1"][data-level="0"] .re-level-name')).toHaveText('Level 11');

    // Back returns to the round in progress; a card jumps to that level.
    await page.click('[data-action="resume"]');
    await expect(page.locator('.re-status-level')).toHaveText('Level 1');
    await page.click('.re-topbar [data-action="levels"]');
    await page.click('.re-level-card[data-cat="0"][data-level="3"]');
    await expect(page.locator('.re-status-level')).toHaveText('Level 4');
    await expect(page.locator('.re-status-cat')).toHaveText('One Measure');
    await expect(page.locator('.re-status-round')).toHaveText('Round 1 of 3');
    expect(errors).toEqual([]);
  } finally {
    await deleteTestUser(u.user.id);
  }
});

test('Rhythm by Ear: Hint lights the grid as the rhythm plays; the count-in is labelled', async ({ page }) => {
  test.setTimeout(60000);
  const u = await createTestUser(false);

  try {
    await loginAsTestUser(page, u);
    await openGame(page);
    const lit = page.locator('#measures .cell.re-beat-on');

    // Without Hint, nothing on the grid lights up during the rhythm.
    await page.click('[data-action="listen"]');
    await expect(page.locator('.re-cue')).toContainText('not part of the rhythm', { timeout: 5000 });
    await expect(page.locator('.re-cue')).toContainText('Rhythm playing', { timeout: 8000 });
    await expect(lit).toHaveCount(0);
    await expect(page.locator('[data-action="listen"]')).toBeEnabled({ timeout: 10000 });

    await page.click('[data-action="hint"]');
    await expect(page.locator('[data-action="hint"]')).toHaveText('💡 Hint on');
    await page.click('[data-action="hint"]');
    await expect(page.locator('[data-action="hint"]')).toHaveText('💡 Hint'); // already charged: no price shown
    await page.click('[data-action="hint"]');
    await expect(page.locator('[data-action="listen"]')).toHaveClass(/re-flash/); // nudges toward Listen
    await page.click('[data-action="listen"]');
    await expect(page.locator('.re-cue')).toContainText('Rhythm playing', { timeout: 8000 });
    await expect(lit).toHaveCount(1);
    await expect(page.locator('[data-action="listen"]')).toBeEnabled({ timeout: 10000 });
    await expect(lit).toHaveCount(0);

    // Hint resets on the next round.
    await page.click('[data-action="check"]');
    await page.click('[data-action="reveal"]');
    await page.click('[data-action="next"]');
    await expect(page.locator('[data-action="hint"]')).toHaveText('💡 Hint −20');
  } finally {
    await deleteTestUser(u.user.id);
  }
});

test('Rhythm by Ear: panel rows are Listen, grid, Play mine + Check, Hint + Tempo + Metronome', async ({ page }) => {
  test.setTimeout(60000);
  const u = await createTestUser(false);

  try {
    await loginAsTestUser(page, u);
    await openGame(page);

    const rows = await page.evaluate(() => {
      const mid = (sel) => {
        const r = document.querySelector('.re-panel ' + sel).getBoundingClientRect();
        return r.top + r.height / 2;
      };
      return [
        [mid('[data-action="listen"]')],
        [mid('#measures')],
        [mid('[data-action="play-mine"]'), mid('[data-action="check"]')],
        [mid('[data-action="hint"]'), mid('.re-tempo-chip'), mid('.re-switch')],
      ];
    });
    rows.forEach(row => row.forEach(y => expect(Math.abs(y - row[0])).toBeLessThan(4))); // side by side
    for (let i = 1; i < rows.length; i++) expect(rows[i][0]).toBeGreaterThan(rows[i - 1][0]);

    // Levels & library (top bar) comes before the level and score.
    const btnTop = await page.locator('.re-topbar [data-action="levels"]').evaluate(el => el.getBoundingClientRect().top);
    const levelTop = await page.locator('.re-status-level').evaluate(el => el.getBoundingClientRect().top);
    expect(btnTop).toBeLessThan(levelTop);

    // The metronome is a switch.
    const sw = page.locator('.re-switch input[role="switch"]');
    await expect(sw).toBeChecked();
    await page.click('.re-switch');
    await expect(sw).not.toBeChecked();
  } finally {
    await deleteTestUser(u.user.id);
  }
});

test('Rhythm by Ear: no transport bar; ▶ Play mine plays your grid at once, each cell lighting up', async ({ page }) => {
  test.setTimeout(60000);
  const u = await createTestUser(false);

  try {
    await loginAsTestUser(page, u);
    await openGame(page);
    await expect(page.locator('.re-container #mainTransport-A')).toHaveCount(0);

    const mine = page.locator('[data-action="play-mine"]');
    await expect(mine).toHaveText('▶ Play mine');
    await mine.click();
    await expect(mine).toHaveText('■ Stop');
    // No count-in: straight into your version.
    await expect(page.locator('.re-cue')).toContainText('Playing your version', { timeout: 1500 });
    await expect(page.locator('.re-cue')).not.toContainText('Count-in');
    await expect(page.locator('#measures .cell.re-beat-on')).toHaveCount(1);

    // Stop clears the highlight; the Check flow is untouched.
    await page.click('[data-action="play-mine"]');
    await expect(mine).toHaveText('▶ Play mine');
    await expect(page.locator('#measures .cell.re-beat-on')).toHaveCount(0);
  } finally {
    await deleteTestUser(u.user.id);
  }
});

test('Rhythm by Ear: tapping cycles Ding → Tak → Slap → empty, and Check marks wrong beats', async ({ page }) => {
  test.setTimeout(60000);
  const u = await createTestUser(false);

  try {
    await loginAsTestUser(page, u);
    await openGame(page);

    const cell = page.locator('#measures .cell[data-index="1"]');
    await cell.click();
    await expect(cell).toHaveClass(/label-ding/);
    await cell.click();
    await expect(cell).toHaveClass(/label-t/);
    await cell.click();
    await expect(cell).toHaveClass(/label-s/);
    await cell.click();
    await expect(cell).toHaveClass(/ghost/);
    await expect(cell).not.toHaveClass(/selected/);

    // Only beat 1 is in place; level 1 always has one more Ding.
    await page.click('[data-action="check"]');
    await expect(page.locator('.re-cue.re-feedback-wrong')).toContainText('1 beat off');
    await expect(page.locator('#measures .cell.re-wrong')).toHaveCount(1);

    // Show answer fills the grid; Next moves to round 2.
    await page.click('[data-action="reveal"]');
    await expect(page.locator('#measures .cell.label-ding')).toHaveCount(2);
    await expect(page.locator('#measures .cell.label-t, #measures .cell.label-s')).toHaveCount(0);
    await page.click('[data-action="next"]');
    await expect(page.locator('.re-status-round')).toHaveText('Round 2 of 3');
  } finally {
    await deleteTestUser(u.user.id);
  }
});

// Solves the round using Check's per-beat marks: each wrong beat is clicked
// once (Ding → Tak → Slap → empty) and re-checked until nothing is wrong.
async function solveRound(page) {
  for (let i = 0; i < 6; i++) {
    await page.click('[data-action="check"]');
    if (await page.locator('.re-feedback-right').count()) return i + 1;
    const wrong = await page.locator('#measures .cell.re-wrong').evaluateAll(cells => cells.map(c => c.dataset.index));
    for (const idx of wrong) await page.click(`#measures .cell[data-index="${idx}"]`);
  }
  throw new Error('round not solved');
}

test('Rhythm by Ear: a correct Check chimes, scores the round, and adds to the total', async ({ page }) => {
  test.setTimeout(60000);
  const u = await createTestUser(false);

  try {
    await loginAsTestUser(page, u);
    await openGame(page);
    const warnings = [];
    page.on('console', m => { if (m.text().includes('success sound')) warnings.push(m.text()); });
    const chime = page.waitForResponse(r => r.url().includes('success.mp3'));

    const tries = await solveRound(page);
    expect((await chime).status()).toBe(200);
    await page.waitForTimeout(500); // decode
    expect(warnings).toEqual([]);
    expect(tries).toBeGreaterThan(1); // only beat 1 is pre-filled
    await expect(page.locator('.re-points')).toContainText(`${tries} tries`);
    const points = Number((await page.locator('.re-points').textContent()).match(/\+(\d+)/)[1]);
    expect(points).toBeGreaterThan(0);
    expect(points).toBeLessThanOrEqual(100);
    await expect(page.locator('.re-round-chip').first()).toContainText(String(points));
    await expect(page.locator('.re-total-value')).toHaveText(String(points));
  } finally {
    await deleteTestUser(u.user.id);
  }
});

test('Rhythm by Ear: three rounds end in a summary; the last one-measure level leads to Level 11', async ({ page }) => {
  test.setTimeout(60000);
  const u = await createTestUser(false);

  try {
    await loginAsTestUser(page, u);
    await openGame(page);
    await page.click('.re-topbar [data-action="levels"]');
    await page.click('.re-level-card[data-cat="0"][data-level="9"]');

    for (let r = 0; r < 3; r++) {
      await page.click('[data-action="check"]');
      await page.click('[data-action="reveal"]');
      await page.click('[data-action="next"]');
    }
    await expect(page.locator('.re-summary-score')).toHaveText('0 / 300');
    await expect(page.locator('.re-breakdown-row')).toHaveCount(3);
    await expect(page.locator('.re-breakdown-row').first()).toContainText('answer shown');
    await expect(page.locator('.re-status-round')).toHaveText('Complete');
    await expect(page.locator('.re-verdict')).toHaveText('Room for improvement.');
    await expect(page.locator('[data-action="next-level"]')).toContainText('Level 11'); // rolls into Two Measures

    await page.click('.re-topbar [data-action="levels"]');
    await expect(page.locator('.re-level-card[data-cat="0"][data-level="9"] .re-level-best')).toHaveText('Best 0/300');
    await page.click('[data-action="resume"]');
    await page.click('[data-action="next-level"]');
    await expect(page.locator('.re-status-cat')).toHaveText('Two Measures');
    await expect(page.locator('.re-status-level')).toHaveText('Level 11');
  } finally {
    await deleteTestUser(u.user.id);
  }
});

test('Rhythm by Ear: named rhythms are revealed by name; Two Measures uses 16 beats', async ({ page }) => {
  test.setTimeout(60000);
  const u = await createTestUser(false);

  try {
    await loginAsTestUser(page, u);
    await openGame(page);

    // Level 4: only the Tresillo fits, so round 1 is always it.
    await page.click('.re-topbar [data-action="levels"]');
    await page.click('.re-level-card[data-cat="0"][data-level="3"]');
    await expect(page.locator('.re-rhythm-name')).toHaveCount(0); // never named before it's solved
    await page.click('[data-action="check"]');
    await page.click('[data-action="reveal"]');
    await expect(page.locator('.re-rhythm-title')).toHaveText('Tresillo');
    for (const i of [0, 3, 6]) {
      await expect(page.locator(`#measures .cell[data-index="${i}"]`)).toHaveClass(/has-label/);
    }

    await page.click('.re-topbar [data-action="levels"]');
    await page.click('.re-level-card[data-cat="1"][data-level="1"]');
    await expect(page.locator('.re-status-cat')).toHaveText('Two Measures');
    await expect(page.locator('#measures .cell')).toHaveCount(16);
    await page.click('[data-action="check"]');
    await page.click('[data-action="reveal"]');
    await expect(page.locator('.re-rhythm-title')).toHaveText(/clave|Bossa nova|Gahu|Shiko|Soukous/);
  } finally {
    await deleteTestUser(u.user.id);
  }
});

test('Rhythm by Ear: switching level stops the phrase that is playing', async ({ page }) => {
  test.setTimeout(60000);
  const u = await createTestUser(false);

  try {
    await loginAsTestUser(page, u);
    await openGame(page);

    await page.click('[data-action="listen"]');
    await expect(page.locator('.re-cue')).toContainText('Count-in', { timeout: 5000 });
    await page.click('.re-topbar [data-action="levels"]');
    await page.click('.re-level-card[data-cat="1"][data-level="0"]');
    await expect(page.locator('[data-action="listen"]')).toBeEnabled();
    await page.waitForTimeout(1500); // a still-running phrase would have moved the cue by now
    await expect(page.locator('.re-cue')).toHaveAttribute('data-phase', 'idle');
  } finally {
    await deleteTestUser(u.user.id);
  }
});

test('Rhythm by Ear: the game fits on screen, one or two measures, and the summary keeps the panel height', async ({ page }) => {
  test.setTimeout(90000);
  const u = await createTestUser(false);

  try {
    await loginAsTestUser(page, u);
    await openGame(page);
    const overflow = () => page.evaluate(() => {
      const v = document.getElementById('view-games');
      return v.scrollHeight - v.clientHeight;
    });

    await page.click('[data-action="check"]'); // tallest state: the "Not quite" verdict
    expect(await overflow()).toBeLessThanOrEqual(1);

    await page.click('.re-topbar [data-action="levels"]');
    await page.click('.re-level-card[data-cat="1"][data-level="1"]');
    expect(await overflow()).toBeLessThanOrEqual(1);
    await page.click('[data-action="check"]');
    expect(await overflow()).toBeLessThanOrEqual(1);
    await page.click('[data-action="reveal"]');
    expect(await overflow()).toBeLessThanOrEqual(1);

    for (let r = 0; r < 2; r++) {
      await page.click('[data-action="next"]');
      await page.click('[data-action="check"]');
      await page.click('[data-action="reveal"]');
    }
    const panelHeight = () => page.locator('.re-panel').evaluate(el => el.getBoundingClientRect().height);
    const before = await panelHeight();
    await page.click('[data-action="next"]'); // Finish
    await expect(page.locator('.re-summary')).toBeVisible();
    expect(Math.abs(await panelHeight() - before)).toBeLessThan(2);
    await page.click('[data-action="next-level"]');
    await expect(page.locator('.re-summary')).toBeHidden();
    expect(await page.evaluate(() => document.getElementById('view-games').scrollTop)).toBe(0);
  } finally {
    await deleteTestUser(u.user.id);
  }
});

test('Rhythm Library: lists every named rhythm; Learn shows the name up front', async ({ page }) => {
  test.setTimeout(60000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const u = await createTestUser(false);

  try {
    await loginAsTestUser(page, u);
    await openGame(page);
    await page.click('.re-topbar [data-action="levels"]');
    await page.click('[data-tab="library"]');

    await expect(page.locator('[data-library-set]')).toHaveCount(2);
    await expect(page.locator('.re-rhythm-card')).toHaveCount(12);
    await expect(page.locator('.re-rhythm-card[data-rhythm="Son clave"]')).toContainText('3-2 key pattern');
    // Tresillo's pattern: Ding on 1, Tak on 4 and 7.
    const kinds = await page.locator('.re-rhythm-card[data-rhythm="Tresillo"] .re-pattern-cell').evaluateAll(cells => cells.map(c => c.dataset.kind).join(''));
    expect(kinds).toBe('dtt');

    // 🔊 toggles a preview without leaving the library.
    const hear = page.locator('.re-rhythm-card[data-rhythm="Tresillo"] [data-action="preview"]');
    await hear.click();
    await expect(hear).toHaveText('■ Stop');
    const card = page.locator('.re-rhythm-card[data-rhythm="Tresillo"]');
    await expect(card.locator('.re-cue')).toContainText('not part of the rhythm', { timeout: 5000 });
    await expect(card.locator('.re-pattern-cell.re-beat-on')).toHaveCount(1, { timeout: 5000 }); // cells light up as they play
    await expect(card.locator('.re-cue')).toContainText('Rhythm playing');
    await hear.click();
    await expect(hear).toHaveText('🔊 Hear it');
    await expect(card.locator('.re-pattern-cell.re-beat-on')).toHaveCount(0);
    await expect(card.locator('.re-cue')).toHaveAttribute('data-phase', 'idle');

    await page.click('.re-rhythm-card[data-rhythm="Tresillo"] [data-action="learn"]');
    await expect(page.locator('.re-status-cat')).toHaveText('Rhythm Library');
    await expect(page.locator('.re-status-level')).toHaveText('Tresillo');
    await expect(page.locator('.re-status-round')).toHaveText('Round 1 of 1');
    await expect(page.locator('.re-rhythm-title')).toHaveText('Tresillo'); // shown before solving
    await expect(page.locator('#measures .cell')).toHaveCount(8);
    const bpm = page.locator('.re-tempo-value');
    await expect(bpm).toHaveText('160'); // library rhythms play at LIBRARY_BPM

    await page.click('[data-action="check"]');
    await page.click('[data-action="reveal"]');
    for (const [i, cls] of [[0, /label-ding/], [3, /label-t/], [6, /label-t/]]) {
      await expect(page.locator(`#measures .cell[data-index="${i}"]`)).toHaveClass(cls);
    }
    await page.click('[data-action="next"]');
    await expect(page.locator('[data-action="next-level"]')).toContainText('Learn the Habanera');
    await expect(page.locator('[data-action="replay"]')).toContainText('Practise again');

    // The menu reopens on the library tab after a library run.
    await page.click('.re-topbar [data-action="levels"]');
    await expect(page.locator('[data-tab="library"]')).toHaveAttribute('aria-selected', 'true');

    // Back to a level: the tempo from before the library returns.
    await page.click('[data-tab="levels"]');
    await page.click('.re-level-card[data-cat="0"][data-level="1"]');
    await expect(bpm).toHaveText('160'); // same as LIBRARY_BPM today; restoreTempo still runs

    // The library's hidden cards have cue lines too; the game's own cue must
    // still move past "Get ready…".
    await page.click('[data-action="listen"]');
    await expect(page.locator('.re-play .re-cue')).toContainText('Count-in', { timeout: 5000 });
    await expect(page.locator('.re-play .re-cue')).toContainText('Rhythm playing', { timeout: 8000 });
    expect(errors).toEqual([]);
  } finally {
    await deleteTestUser(u.user.id);
  }
});

test('Rhythm Library: Play all runs each rhythm in the set once, names hidden until solved', async ({ page }) => {
  test.setTimeout(90000);
  const u = await createTestUser(false);

  try {
    await loginAsTestUser(page, u);
    await openGame(page);
    await page.click('.re-topbar [data-action="levels"]');
    await page.click('[data-tab="library"]');
    await page.click('[data-set="1"]'); // two-measure rhythms

    await expect(page.locator('.re-status-level')).toHaveText('Two-measure rhythms');
    await expect(page.locator('.re-status-round')).toHaveText('Round 1 of 6');
    await expect(page.locator('#measures .cell')).toHaveCount(16);

    const seen = [];
    for (let r = 0; r < 6; r++) {
      await expect(page.locator('.re-rhythm-name')).toHaveCount(0);
      await page.click('[data-action="check"]');
      await page.click('[data-action="reveal"]');
      seen.push(await page.locator('.re-rhythm-title').textContent());
      await page.click('[data-action="next"]');
    }
    expect(new Set(seen).size).toBe(6);
    await expect(page.locator('.re-summary-score')).toHaveText('0 / 600');
  } finally {
    await deleteTestUser(u.user.id);
  }
});

test('Rhythm by Ear: a fast double tap steps two labels and never opens multi-mode', async ({ page }) => {
  test.setTimeout(60000);
  const u = await createTestUser(false);

  try {
    await loginAsTestUser(page, u);
    await openGame(page);

    const cell = page.locator('#measures .cell[data-index="2"]');
    await cell.dblclick();
    await expect(cell).toHaveClass(/label-t/); // empty -> Ding -> Tak
    await expect(cell).not.toHaveClass(/multi-mode/);
    await expect(page.locator('#measures .cell.multi-mode')).toHaveCount(0);
    await cell.dblclick();
    await expect(cell).toHaveClass(/ghost/); // Tak -> Slap -> empty
  } finally {
    await deleteTestUser(u.user.id);
  }
});

test('Rhythm by Ear: tempo − / + step by 5, ♩ Test previews it, and it is remembered', async ({ page }) => {
  test.setTimeout(60000);
  const u = await createTestUser(false);

  try {
    await loginAsTestUser(page, u);
    await openGame(page);

    const value = page.locator('.re-tempo-value');
    await expect(value).toHaveText('160');
    const chip = page.locator('[data-action="tempo-open"]');
    await expect(page.locator('.re-tempo-pop')).toBeHidden();
    await chip.click();
    await expect(page.locator('.re-tempo-pop')).toBeVisible();
    await page.click('[data-action="faster"]');
    await expect(value).toHaveText('165');
    await page.click('[data-action="slower"]');
    await page.click('[data-action="slower"]');
    await expect(value).toHaveText('155');
    await expect(chip).toHaveText('♩ 155');

    // ♩ Test clicks at the tempo until toggled off; Listen stops it too.
    const testBtn = page.locator('[data-action="tempo-test"]');
    await testBtn.click();
    await expect(testBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(testBtn).toHaveText('■ Stop');
    await testBtn.click();
    await expect(testBtn).toHaveAttribute('aria-pressed', 'false');
    await testBtn.click();
    // A tap outside closes the popover and stops the click, and still counts.
    await page.click('[data-action="listen"]');
    await expect(page.locator('.re-tempo-pop')).toBeHidden();
    await expect(page.locator('[data-action="listen"]')).toHaveText(/Playing/);
    await expect(testBtn).toHaveAttribute('aria-pressed', 'false');

    // The tempo is remembered next time the game opens.
    await page.click('.re-container .hg-back');
    await page.click('.hg-tile[data-domain="rhythm"]');
    await page.click('.hg-tile[data-game="rhythm-ear"]');
    await page.click('#confirmOkBtn'); // the grid the game borrowed counts as unsaved Studio changes
    await expect(page.locator('.re-tempo-value')).toHaveText('155');
  } finally {
    await deleteTestUser(u.user.id);
  }
});

test('Rhythm by Ear: Back restores the grid/transport to Studio', async ({ page }) => {
  test.setTimeout(60000);
  const u = await createTestUser(false);

  try {
    await loginAsTestUser(page, u);
    await openGame(page);
    await page.click('.re-container .hg-back');
    await expect(page.locator('.re-container')).toHaveCount(0);

    await page.evaluate(() => { window.location.hash = '#studio'; });
    await expect(page.locator('#measures')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#mainTransport-A')).toBeVisible();
  } finally {
    await deleteTestUser(u.user.id);
  }
});
