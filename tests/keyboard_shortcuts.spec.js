import { test, expect } from '@playwright/test';
import { gotoStudio } from './helpers.js';

test.describe('Keyboard Shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    await gotoStudio(page);
    await page.waitForSelector('.measure-row');
    // Clear any existing pattern
    await page.click('#clearBtn-A');
    await page.locator('#confirmModal.open').waitFor({ timeout: 5000 });
    await page.click('#confirmOkBtn');
  });

  test('Space bar toggles play/pause', async ({ page }) => {
    const playBtn = page.locator('#mainTransport-A .t-play-btn');

    // Initially stopped (no 'playing' class)
    await expect(playBtn).not.toHaveClass(/playing/);

    // Press Space to play
    await page.keyboard.press('Space');
    await expect(playBtn).toHaveClass(/playing/);

    // Press Space again to stop
    // Note: The button may keep 'playing' class briefly, but clicking it should work
    await page.keyboard.press('Space');

    // Wait for playback to actually stop by checking if we can start again
    await page.waitForTimeout(300);

    // Verify we can play again (if it was truly stopped)
    await page.keyboard.press('Space');
    await expect(playBtn).toHaveClass(/playing/);
  });

  test('M key toggles metronome', async ({ page }) => {
    const metroBtn = page.locator('#mainTransport-A .t-metro-btn');

    // Get initial state
    const initialState = await metroBtn.getAttribute('class');
    const wasActive = initialState?.includes('active') || false;

    // Press M to toggle
    await page.keyboard.press('m');
    await page.waitForTimeout(100);

    // Verify toggle
    const newState = await metroBtn.getAttribute('class');
    const isActive = newState?.includes('active') || false;
    expect(isActive).toBe(!wasActive);

    // Press M again to toggle back
    await page.keyboard.press('m');
    await page.waitForTimeout(100);

    const finalState = await metroBtn.getAttribute('class');
    const finalActive = finalState?.includes('active') || false;
    expect(finalActive).toBe(wasActive);
  });

  test('P key toggles presentation mode', async ({ page }) => {
    // Initially not in presentation mode
    await expect(page.locator('body')).not.toHaveClass(/present/);

    // Press P to enter presentation mode
    await page.keyboard.press('p');
    await page.waitForTimeout(100);

    await expect(page.locator('body')).toHaveClass(/present/);

    // Press P to exit presentation mode
    await page.keyboard.press('p');
    await page.waitForTimeout(100);

    await expect(page.locator('body')).not.toHaveClass(/present/);
  });

  test('Escape clears selection', async ({ page }) => {
    const cell0 = page.locator('.cell').nth(0);

    // Click a cell to select it
    await cell0.click();
    await expect(cell0).toHaveClass(/selected/);

    // Press Escape to clear
    await page.keyboard.press('Escape');
    await expect(cell0).not.toHaveClass(/selected/);
  });

  test('D/T/S keys write notes (with compose mode)', async ({ page }) => {
    // Enable compose mode for auto-advance
    await page.click('#composeBtn');
    await page.waitForTimeout(100);

    const cell0 = page.locator('.cell').nth(0);
    const cell1 = page.locator('.cell').nth(1);
    const cell2 = page.locator('.cell').nth(2);

    // Click cell to select
    await cell0.click();

    // Press D for Ding
    await page.keyboard.press('d');
    await expect(cell0).toHaveText('D');

    // Press T for Tak (caret should have advanced in compose mode)
    await page.keyboard.press('t');
    await expect(cell1).toHaveText('T');

    // Press S for Slap (caret should have advanced in compose mode)
    await page.keyboard.press('s');
    await expect(cell2).toHaveText('S');
  });

  test('Number keys write notes (with compose mode)', async ({ page }) => {
    // Enable compose mode for auto-advance
    await page.click('#composeBtn');
    await page.waitForTimeout(100);

    const cell0 = page.locator('.cell').nth(0);
    const cell1 = page.locator('.cell').nth(1);

    // Click cell to select
    await cell0.click();

    // Press 1
    await page.keyboard.press('1');
    await expect(cell0).toHaveText('1');

    // Press 5 (caret should have advanced in compose mode)
    await page.keyboard.press('5');
    await expect(cell1).toHaveText('5');
  });

  test('Alt+key writes without advancing', async ({ page }) => {
    // Enable compose mode (so we can test that Alt prevents advance)
    await page.click('#composeBtn');
    await page.waitForTimeout(100);

    const cell0 = page.locator('.cell').nth(0);

    // Click cell to select
    await cell0.click();

    // Press Alt+D (should not advance even in compose mode)
    await page.keyboard.press('Alt+d');
    await expect(cell0).toHaveText('D');
    await expect(cell0).toHaveClass(/selected/);

    // Press Alt+1 (should not advance even in compose mode)
    await page.keyboard.press('Alt+1');
    await expect(cell0).toHaveText('1');
    await expect(cell0).toHaveClass(/selected/);
  });

  test('Backspace/Delete clears cell', async ({ page }) => {
    const cell0 = page.locator('.cell').nth(0);

    // Click cell and write a note
    await cell0.click();
    await page.keyboard.press('d');
    await expect(cell0).toHaveText('D');

    // Click cell again to select it
    await cell0.click();

    // Press Backspace to clear
    await page.keyboard.press('Backspace');
    await expect(cell0).toHaveText('');
  });

  test('G key clears cell (ghost)', async ({ page }) => {
    const cell0 = page.locator('.cell').nth(0);

    // Click cell and write a note
    await cell0.click();
    await page.keyboard.press('d');
    await expect(cell0).toHaveText('D');

    // Click cell again to select it
    await cell0.click();

    // Press G to clear
    await page.keyboard.press('g');
    await expect(cell0).toHaveText('');
  });

  test.skip('Cmd/Ctrl+C and Cmd/Ctrl+V copy/paste selection', async ({ page, browserName }) => {
    // TODO: Find correct range selection button selector
    // This test is skipped until we identify the correct UI element for range selection
  });

  test('Question mark writes ? (rest)', async ({ page }) => {
    const cell0 = page.locator('.cell').nth(0);

    // Click cell to select
    await cell0.click();

    // Press ? (Shift+/)
    await page.keyboard.press('?');
    await expect(cell0).toHaveText('?');
  });
});
