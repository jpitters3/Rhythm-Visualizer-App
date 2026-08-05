const { test, expect } = require('@playwright/test');
require('dotenv').config();

const { createTestUser, deleteTestUser, loginAsTestUser } = require('./utils/auth-helper');
const { waitForPageReady } = require('./utils/page-helper');

test.describe('Coaching Mode', () => {
  let testUser;

  test.beforeEach(async ({ page }) => {
    // Enable Console Logs
    page.on('console', msg => console.log(`BROWSER LOG: ${msg.text()}`));

    // Handle alerts automatically
    page.on('dialog', dialog => {
      console.log(`BROWSER DIALOG: ${dialog.message()}`);
      dialog.accept().catch(() => { });
    });

    testUser = await createTestUser();

    // Grant microphone permission
    await page.context().grantPermissions(['microphone']);

    await waitForPageReady(page);
    await loginAsTestUser(page, testUser);
    // A successful login redirects to #dashboard (js/controls.js) regardless
    // of the page it was triggered from — head back to Studio afterward.
    await page.goto('/#studio');
    await page.waitForSelector('.measure-row');
  });

  test.afterEach(async ({ page }) => {
    if (testUser) {
      await deleteTestUser(testUser.user.id);
    }
  });

  test('Start Coaching Mode and Verify HUD', async ({ page }) => {
    // 1. Ensure pattern has notes (Add a Ding at step 0) via Event
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('notegrid:setNote', {
        detail: { index: 0, note: 'Ding' }
      }));
    });

    // 2. Click Coach Mode button (reveal via account dropdown)
    await page.click('#accountBtn');
    const coachBtn = page.locator('#coachModeBtn');
    await coachBtn.waitFor({ state: 'visible', timeout: 5000 });
    await coachBtn.click();

    // 3. Click "Start" in the coaching sidebar (enterCoachingMode shows Ready state)
    const startCoachBtn = page.locator('#stopCoachingBtn');
    await expect(startCoachBtn).toHaveText('Start', { timeout: 5000 });
    await startCoachBtn.click();

    // 3b. Handle Calibration Prompt if it appears
    // (loadCalibrationProfile() is async/DB so modal may take several seconds)
    const calModal = page.locator('#calOptimizationModal');
    try {
      await calModal.waitFor({ state: 'visible', timeout: 10000 });
      await calModal.locator('#calSkipBtn').click();
      await expect(calModal).not.toBeVisible();
    } catch (e) {
      console.log('TEST: Calibration modal did not appear or was not needed.');
    }

    // 4. Verify Countdown Overlay appears
    const countdown = page.locator('#countdownOverlay');
    await expect(countdown).toBeVisible({ timeout: 10000 });
    await expect(countdown).toContainText(/[1-4]/);

    // 5. Wait for countdown to finish and HUD to appear
    await expect(countdown).toBeHidden({ timeout: 10000 });
    const hud = page.locator('#coachingSidebar');
    await expect(hud).toBeVisible();
    await expect(page.locator('#hudAccuracy')).toContainText('0%');

    // 6. Stop Coaching Session (button becomes "Stop" once session is active)
    await page.locator('#stopCoachingBtn').click();

    // 7. Verify Results Sidebar appears (endCoachingSession keeps HUD open in Ready state)
    const resultsSidebar = page.locator('#coachResultsSidebar');
    await expect(resultsSidebar).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#sidebar-overallScore')).toContainText('%');

    // 8. Verify Save Session Button
    const saveBtn = page.locator('#sidebar-saveSessionBtn');
    await expect(saveBtn).toBeVisible();
  });
});
