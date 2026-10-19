const { test, expect } = require('@playwright/test');
require('dotenv').config();
const { createTestUser, deleteTestUser, loginAsTestUser } = require('./utils/auth-helper');

// Create Your Own Rhythm — the Rhythm domain's live game (js/create-rhythm-game.js).
// Relocates the REAL Studio grid/transport into its own screen (same portal
// pattern as js/chord-wheel-game.js's handpan), so most assertions read the
// actual #measures/#mainTransport-A elements rather than game-specific markup.
//
// Fake mic device + auto-accepted permission prompt, scoped to this file, so
// the clap-capture flow (js/clap-detector.js) resolves deterministically in
// any environment (CI included) without needing a real microphone.
test.use({
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  },
  permissions: ['microphone'],
});

// WebKit doesn't support the 'microphone' permission string at all —
// test.use({ permissions }) above throws "Unknown permission: microphone"
// when creating the context, before any test body even runs.
test.beforeEach(({ browserName }) => {
  test.skip(browserName === 'webkit', "WebKit doesn't support programmatic microphone permission in Playwright");
});

async function openGame(page) {
  await page.waitForTimeout(1500);
  await page.evaluate(() => { window.location.hash = '#games'; });
  await page.waitForSelector('.hg-tile', { timeout: 10000 });
  await page.click('.hg-tile[data-domain="rhythm"]');
  await expect(page.locator('.rg-container')).toBeVisible();
}

// Polls .rg-instruction's text for a substring instead of a fixed delay —
// the wizard's step transitions are driven by the real metronome/tick
// scheduler (js/noteplayer.js), whose timing can vary slightly under load.
async function waitForInstruction(page, substring, timeout = 25000) {
  await page.waitForFunction(
    (needle) => (document.querySelector('.rg-instruction')?.textContent || '').includes(needle),
    substring,
    { timeout }
  );
}

test('Create Your Own Rhythm: relocates the Studio grid/transport and sets up a fresh 8-beat numeric phrase', async ({ page }) => {
  test.setTimeout(60000);
  const u = await createTestUser(false);

  try {
    await loginAsTestUser(page, u);
    await openGame(page);

    await expect(page.locator('.rg-progress-step')).toHaveCount(5);
    await expect(page.locator('.rg-cta-primary')).toContainText('Start');

    // The real Studio grid and transport bar, relocated in (not duplicated).
    await expect(page.locator('.rg-grid-slot #measures')).toHaveCount(1);
    await expect(page.locator('.rg-transport-slot #mainTransport-A')).toHaveCount(1);
    await expect(page.locator('#measures .cell')).toHaveCount(8);

    // Numeric label notation ("1" not "1&"), forced for this game.
    await expect(page.locator('.labels > div').first()).toHaveText('1');
    const labelPref = await page.evaluate(() => localStorage.getItem('labelNotation'));
    expect(labelPref).toBe('numeric');
  } finally {
    await deleteTestUser(u.user.id);
  }
});

test('Create Your Own Rhythm: manual tap toggles Ding/ghost, never selects the cell, and surfaces Continue immediately', async ({ page }) => {
  test.setTimeout(60000);
  const u = await createTestUser(false);

  try {
    await loginAsTestUser(page, u);
    await openGame(page);

    await expect(page.locator('[data-action="continue"]')).toHaveCount(0);

    const cell = page.locator('#measures .cell[data-index="2"]');
    await cell.click();
    await expect(cell).toHaveClass(/label-ding/);
    await expect(cell).not.toHaveClass(/selected/);

    // Continue appears as soon as there's content — no need to clap/listen.
    await expect(page.locator('[data-action="continue"]')).toBeVisible({ timeout: 2000 });
    await expect(page.locator('[data-action="start"]')).toBeVisible(); // still available alongside it

    // Second tap toggles back to a ghost note.
    await cell.click();
    await expect(cell).not.toHaveClass(/label-ding/);
    await expect(cell).toHaveClass(/ghost/);

    await cell.click();
    await expect(cell).toHaveClass(/label-ding/);

    // Continue jumps straight to Review without any metronome/listening wait.
    await page.click('[data-action="continue"]');
    await expect(page.locator('.rg-progress-current .rg-progress-label')).toHaveText('Review');
    await expect(page.locator('[data-action="reset"]')).toBeVisible();
  } finally {
    await deleteTestUser(u.user.id);
  }
});

test('Create Your Own Rhythm: clap capture — count-in plays, listening auto-stops after one measure', async ({ page }) => {
  test.setTimeout(60000);
  const u = await createTestUser(false);

  try {
    await loginAsTestUser(page, u);
    await openGame(page);

    await page.click('[data-action="start"]');
    await expect(page.locator('.rg-progress-current .rg-progress-label')).toHaveText('Clap');
    await expect(page.locator('#countdownOverlay')).toBeVisible({ timeout: 5000 });

    // 8-beat count-in + 8-beat listening at 90bpm ≈ 10.7s total.
    await waitForInstruction(page, 'Press', 20000);
    await expect(page.locator('[data-action="reset"]')).toBeVisible();

    // Metronome/mic are fully stopped once Review is reached.
    await expect(page.locator('#mainTransport-A .t-play-btn')).toHaveText('►');
  } finally {
    await deleteTestUser(u.user.id);
  }
});

test('Create Your Own Rhythm: Reset clears the rhythm and returns to the intro step', async ({ page }) => {
  test.setTimeout(60000);
  const u = await createTestUser(false);

  try {
    await loginAsTestUser(page, u);
    await openGame(page);

    const cell = page.locator('#measures .cell[data-index="1"]');
    await cell.click();
    await expect(cell).toHaveClass(/label-ding/);
    await page.click('[data-action="continue"]');
    await expect(page.locator('[data-action="reset"]')).toBeVisible();

    await page.click('[data-action="reset"]');
    await expect(page.locator('.rg-progress-current .rg-progress-label')).toHaveText('Clap');
    await expect(cell).not.toHaveClass(/label-ding/);
    await expect(page.locator('#measures .cell')).toHaveCount(8); // structure (8 beats) unchanged, only content cleared
  } finally {
    await deleteTestUser(u.user.id);
  }
});

test('Create Your Own Rhythm: Done! auto-saves as "My Rhythm", celebrates, and lands in Studio', async ({ page }) => {
  test.setTimeout(60000);
  const u = await createTestUser(false);

  try {
    await loginAsTestUser(page, u);
    await openGame(page);

    await page.locator('#measures .cell[data-index="0"]').click();
    await page.click('[data-action="continue"]'); // -> review
    await page.click('[data-action="continue"]'); // -> play-on-handpan
    await expect(page.locator('.rg-instruction')).toContainText('right hand');
    await page.click('.rg-cta-primary'); // -> choose
    await expect(page.locator('.rg-instruction')).toContainText('Happy with your rhythm');

    await page.click('[data-action="done"]');
    await expect(page.locator('.toast')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.toast')).toContainText('Great job');

    await expect(page).toHaveURL(/#studio/, { timeout: 5000 });
    await expect(page.locator('#currentPhraseName')).toHaveText('My Rhythm');
  } finally {
    await deleteTestUser(u.user.id);
  }
});

test('Create Your Own Rhythm: Add Chords duplicates to 4 measures and hands off to a Chord Wheel preview that substitutes beat 1', async ({ page }) => {
  test.setTimeout(90000);
  const u = await createTestUser(false);

  try {
    await loginAsTestUser(page, u);
    await openGame(page);

    await page.locator('#measures .cell[data-index="0"]').click();
    await page.click('[data-action="continue"]'); // -> review
    await page.click('[data-action="continue"]'); // -> play-on-handpan
    await page.click('.rg-cta-primary'); // -> choose
    await page.click('[data-action="chords"]');

    // Lands in Chord Wheel, rhythm already duplicated to 4 measures, already
    // auto-saved (no name prompt), and the rhythm-only mini preview is shown.
    await expect(page.locator('.cw-container')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#measures .cell')).toHaveCount(32);
    await expect(page.locator('#currentPhraseName')).toHaveText('My Rhythm');
    await expect(page.locator('.cw-rhythm-preview')).toBeVisible();
    await expect(page.locator('.cw-rhythm-row')).toHaveCount(4);
    await expect(page.locator('.cw-rhythm-preview')).not.toHaveClass(/cw-rhythm-preview-ready/);

    // Unready preview click is a no-op (still in Chord Wheel).
    await page.click('.cw-rhythm-preview');
    await page.waitForTimeout(300);
    await expect(page.locator('.cw-container')).toBeVisible();

    // Spinning a slot updates that measure's preview cell live.
    await page.click('.cw-spin-btn[data-slot="0"]');
    await page.waitForFunction(
      () => !!document.querySelector('.cw-rhythm-row')?.querySelector('.cw-rhythm-chord')?.textContent.trim(),
      null,
      { timeout: 6000 }
    );

    // Remaining slots: the shared wheel can only spin one at a time
    // (js/chord-wheel-game.js's wheelSpinning guard), so spin them via
    // Spin All rather than racing individual slot clicks against it.
    await page.click('.cw-spin-all-btn');
    await page.waitForFunction(
      () => document.querySelectorAll('.cw-chord-name').length === 4,
      null,
      { timeout: 20000 }
    );
    await expect(page.locator('.cw-rhythm-preview')).toHaveClass(/cw-rhythm-preview-ready/);

    // Clicking the now-ready preview is the Send to Studio shortcut.
    await page.click('.cw-rhythm-preview');
    await expect(page).toHaveURL(/#studio/, { timeout: 5000 });
    await expect(page.locator('#measures .cell')).toHaveCount(32); // not resized, unlike the normal Chord Wheel flow

    // Each measure's first beat now holds a chord, not the clapped Ding.
    for (const beatIndex of [0, 8, 16, 24]) {
      await expect(page.locator(`#measures .cell[data-index="${beatIndex}"]`)).not.toHaveClass(/label-ding/);
    }
  } finally {
    await deleteTestUser(u.user.id);
  }
});

test('Create Your Own Rhythm: Back button restores the grid/transport to Studio', async ({ page }) => {
  test.setTimeout(60000);
  const u = await createTestUser(false);

  try {
    await loginAsTestUser(page, u);
    await openGame(page);

    await expect(page.locator('.rg-grid-slot #measures')).toHaveCount(1);

    await page.click('.rg-container .hg-back');
    await page.waitForTimeout(300);
    await expect(page.locator('.rg-grid-slot')).toHaveCount(0);

    await page.evaluate(() => { window.location.hash = '#studio'; });
    await page.waitForSelector('#measures:visible', { timeout: 10000 }).catch(() => {});
    await expect(page.locator('#measures')).toBeVisible();
    await expect(page.locator('#mainTransport-A')).toBeVisible();
  } finally {
    await deleteTestUser(u.user.id);
  }
});
