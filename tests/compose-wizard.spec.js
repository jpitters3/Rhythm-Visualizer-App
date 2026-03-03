const { test, expect } = require('@playwright/test');

test.describe('Guided Composition Wizard (Creation Current)', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to local dev server with #compose hash
    await page.goto('/#compose');
    // Ensure app is loaded by waiting for something
    await page.waitForTimeout(500);
  });

  test('should load Step 1 UI when navigating to #compose', async ({ page }) => {
    // Router should make #view-compose visible
    const composeView = page.locator('#view-compose');
    await expect(composeView).toBeVisible();

    // Should see Step 1 header
    const subtitle = page.locator('#cw-subtitle');
    await expect(subtitle).toHaveText('Step 1: Foundation');

    // Choose Path UI should be visible
    const rhythmBtn = page.locator('#flow-rhythm-btn');
    const melodyBtn = page.locator('#flow-melody-btn');
    await expect(rhythmBtn).toBeVisible();
    await expect(melodyBtn).toBeVisible();
  });

  test('selecting Rhythm First unlocks pattern selection', async ({ page }) => {
    const rhythmBtn = page.locator('#flow-rhythm-btn');
    await rhythmBtn.click();

    // Wait for the list to appear
    const patternListDiv = page.locator('#cw-pattern-selection');
    await expect(patternListDiv).toBeVisible();

    const listTitle = page.locator('#cw-pattern-list-title');
    await expect(listTitle).toHaveText('Select a Rhythm');

    // Should generate a Create New Option
    const createNew = page.getByText('+ Create New Rhythm');
    await expect(createNew).toBeVisible();

    // Clicking Create New should enable next button
    await createNew.click();
    const nextBtn = page.locator('#cw-next-btn');
    await expect(nextBtn).toBeEnabled();
  });

  test('progressing to Step 2 opens the freeplay overlay', async ({ page }) => {
    // 1. Choose Rhythm Flow
    await page.locator('#flow-rhythm-btn').click();

    // 2. Click Create New
    await page.getByText('+ Create New Rhythm').click();

    // 3. Click Next Step
    await page.locator('#cw-next-btn').click();

    // We expect the router to have navigated to #freeplay
    await page.waitForURL('**/#freeplay');

    // We expect the compose view to be hidden
    await expect(page.locator('#view-compose')).toBeHidden();

    // We expect the freeplay view to be visible
    await expect(page.locator('#view-freeplay')).toBeVisible();

    // We expect the overlay header to be visible
    const overlay = page.locator('#cw-freeplay-overlay');
    await expect(overlay).toBeVisible();

    // Check finish button
    const finishBtn = page.locator('#cw-step2-finish');
    await expect(finishBtn).toBeVisible();

    // Go to step 3
    await finishBtn.click();
    await page.waitForURL('**/#compose');
    await expect(page.locator('#cw-subtitle')).toHaveText('Step 3: Polish & Export');
  });
});
