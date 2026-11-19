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
}

test('Rhythm by Ear: opens on Level 1; All levels lists every level with its rules', async ({ page }) => {
  test.setTimeout(60000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const u = await createTestUser(false);

  try {
    await loginAsTestUser(page, u);
    await openGame(page);

    await expect(page.locator('.re-status-level')).toHaveText('Level 1');
    await expect(page.locator('.re-status-round')).toHaveText('Round 1 of 3');
    await expect(page.locator('.re-round-chip')).toHaveCount(3); // only 3 distinct rhythms fit One Ding level 1
    await expect(page.locator('.re-level-card')).toHaveCount(0);
    await expect(page.locator('.re-play')).not.toContainText('odd beats only'); // current level's rules aren't listed
    await expect(page.locator('.re-hero')).toContainText('not part of the rhythm');
    await expect(page.locator('.re-grid-slot #measures')).toHaveCount(1);
    await expect(page.locator('#measures .cell')).toHaveCount(8);
    await expect(page.locator('#measures .cell[data-index="0"]')).toHaveClass(/label-ding/);

    await page.click('.re-status .re-levels-btn');
    await expect(page.locator('.re-category')).toHaveCount(3);
    await expect(page.locator('.re-level-card')).toHaveCount(21);
    await expect(page.locator('.re-level-card').first()).toContainText('odd beats only');
    await expect(page.locator('.re-level-card[data-cat="0"][data-level="3"] .re-level-named')).toContainText('Tresillo');
    await expect(page.locator('.re-level-card[data-cat="2"][data-level="1"] .re-level-named')).toContainText('Son clave');

    // Back returns to the round in progress; a card jumps to that level.
    await page.click('[data-action="resume"]');
    await expect(page.locator('.re-status-level')).toHaveText('Level 1');
    await page.click('.re-status .re-levels-btn');
    await page.click('.re-level-card[data-cat="0"][data-level="3"]');
    await expect(page.locator('.re-status-level')).toHaveText('Level 4');
    await expect(page.locator('.re-status-cat')).toHaveText('One Ding');
    await expect(page.locator('.re-status-round')).toHaveText('Round 1 of 4');
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
    await expect(page.locator('[data-action="hint"]')).toHaveText('💡 Hint (−20)');
  } finally {
    await deleteTestUser(u.user.id);
  }
});

test('Rhythm by Ear: panel order is Listen, Tempo, grid, Play mine, Check, Hint, Metronome', async ({ page }) => {
  test.setTimeout(60000);
  const u = await createTestUser(false);

  try {
    await loginAsTestUser(page, u);
    await openGame(page);

    const order = await page.evaluate(() => {
      const items = [
        ['listen', '[data-action="listen"]'], ['tempo', '.re-tempo'], ['grid', '#measures'],
        ['mine', '[data-action="play-mine"]'], ['check', '[data-action="check"]'],
        ['hint', '[data-action="hint"]'], ['metronome', '.re-switch'],
      ];
      return items
        .map(([name, sel]) => [name, document.querySelector('.re-panel ' + sel).getBoundingClientRect().top])
        .sort((a, b) => a[1] - b[1])
        .map(([name]) => name);
    });
    // Hint and Metronome share a row, so only their relative order to Check matters.
    expect(order.slice(0, 5)).toEqual(['listen', 'tempo', 'grid', 'mine', 'check']);
    expect(order.slice(5).sort()).toEqual(['hint', 'metronome']);

    // Levels & library comes before the level and score.
    const btnTop = await page.locator('.re-status .re-levels-btn').evaluate(el => el.getBoundingClientRect().top);
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

    // Only the Ding is in place; level 1 always has one more accent.
    await page.click('[data-action="check"]');
    await expect(page.locator('.re-feedback-wrong')).toContainText('1 beat is off');
    await expect(page.locator('#measures .cell.re-wrong')).toHaveCount(1);

    // Show answer fills the grid; Next moves to round 2.
    await page.click('[data-action="reveal"]');
    await expect(page.locator('#measures .cell.label-t, #measures .cell.label-s')).toHaveCount(1);
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
    expect(tries).toBeGreaterThan(1); // the accent is never pre-filled
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

test('Rhythm by Ear: four rounds end in a summary with the first-try score', async ({ page }) => {
  test.setTimeout(60000);
  const u = await createTestUser(false);

  try {
    await loginAsTestUser(page, u);
    await openGame(page);
    await page.click('.re-status .re-levels-btn');
    await page.click('.re-level-card[data-cat="0"][data-level="6"]');

    for (let r = 0; r < 4; r++) {
      await page.click('[data-action="check"]');
      await page.click('[data-action="reveal"]');
      await page.click('[data-action="next"]');
    }
    await expect(page.locator('.re-summary-score')).toHaveText('0 / 400');
    await expect(page.locator('.re-breakdown-row')).toHaveCount(4);
    await expect(page.locator('.re-breakdown-row').first()).toContainText('answer shown');
    await expect(page.locator('.re-status-round')).toHaveText('Complete');
    await expect(page.locator('.re-verdict')).toHaveText('Room for improvement.');
    await expect(page.locator('[data-action="next-level"]')).toContainText('Two Dings · Level 1'); // last level rolls into the next category

    await page.click('.re-status .re-levels-btn');
    await expect(page.locator('.re-level-card[data-cat="0"][data-level="6"] .re-level-best')).toHaveText('Best 0/400');
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

    // One Ding level 4: only the Tresillo fits, so round 1 is always it.
    await page.click('.re-status .re-levels-btn');
    await page.click('.re-level-card[data-cat="0"][data-level="3"]');
    await expect(page.locator('.re-rhythm-name')).toHaveCount(0); // never named before it's solved
    await page.click('[data-action="check"]');
    await page.click('[data-action="reveal"]');
    await expect(page.locator('.re-rhythm-title')).toHaveText('Tresillo');
    for (const i of [0, 3, 6]) {
      await expect(page.locator(`#measures .cell[data-index="${i}"]`)).toHaveClass(/has-label/);
    }

    await page.click('.re-status .re-levels-btn');
    await page.click('.re-level-card[data-cat="2"][data-level="1"]');
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
    await page.click('.re-status .re-levels-btn');
    await page.click('.re-level-card[data-cat="1"][data-level="0"]');
    await expect(page.locator('[data-action="listen"]')).toBeEnabled();
    await page.waitForTimeout(1500); // a still-running phrase would have moved the cue by now
    await expect(page.locator('.re-cue')).toHaveAttribute('data-phase', 'idle');
  } finally {
    await deleteTestUser(u.user.id);
  }
});

test('Rhythm by Ear: Listen scrolls the grid into view when it is off screen', async ({ page }) => {
  test.setTimeout(60000);
  const u = await createTestUser(false);

  try {
    await loginAsTestUser(page, u);
    await openGame(page);

    // Start with the Listen button on screen but the grid pushed below it.
    await page.evaluate(() => { document.querySelector('.re-hero').open = true; });
    await page.evaluate(() => document.querySelector('[data-action="listen"]').scrollIntoView({ block: 'start' }));
    const gridVisible = () => page.evaluate(() => {
      const r = document.querySelector('.re-grid-slot').getBoundingClientRect();
      return r.bottom > 0 && r.top < innerHeight;
    });
    if (await gridVisible()) {
      // Viewport tall enough that it is already visible: Listen must not scroll.
      const before = (await page.locator('.re-grid-slot').boundingBox()).y;
      await page.click('[data-action="listen"]');
      await page.waitForTimeout(600);
      const after = (await page.locator('.re-grid-slot').boundingBox()).y;
      expect(Math.abs(after - before)).toBeLessThan(2);
    } else {
      await page.click('[data-action="listen"]');
      await expect.poll(gridVisible, { timeout: 3000 }).toBe(true);
    }
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
    await page.click('.re-status .re-levels-btn');
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
    await page.click('.re-status .re-levels-btn');
    await expect(page.locator('[data-tab="library"]')).toHaveAttribute('aria-selected', 'true');

    // Back to a level: the tempo from before the library returns.
    await page.click('[data-tab="levels"]');
    await page.click('.re-level-card[data-cat="0"][data-level="1"]');
    await expect(bpm).toHaveText('120');
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
    await page.click('.re-status .re-levels-btn');
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

test('Rhythm by Ear: tempo − / + step the tempo by 5', async ({ page }) => {
  test.setTimeout(60000);
  const u = await createTestUser(false);

  try {
    await loginAsTestUser(page, u);
    await openGame(page);

    const value = page.locator('.re-tempo-value');
    await expect(value).toHaveText('120');
    await page.click('[data-action="faster"]');
    await expect(value).toHaveText('125');
    await page.click('[data-action="slower"]');
    await page.click('[data-action="slower"]');
    await expect(value).toHaveText('115');
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
