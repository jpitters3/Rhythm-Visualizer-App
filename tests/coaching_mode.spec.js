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
    await expect(coachBtn).toBeVisible();
    await coachBtn.click();

    // 3. Handle Calibration Prompt if it appears
    const calModal = page.locator('#calOptimizationModal');
    try {
      // Use waitFor instead of isVisible for a real wait
      await calModal.waitFor({ state: 'visible', timeout: 3000 });
      await calModal.locator('#calSkipBtn').click();
      await expect(calModal).not.toBeVisible();
    } catch (e) {
      // Modal might not appear if already skipped or calibration exists
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

    // 5. Mock a note detection via Event Bus (CustomEvent)
    await page.evaluate(() => {
      console.log('TEST: Dispatching coaching:evaluate event');

      const evt = new CustomEvent('coaching:evaluate', {
        detail: { note: 'Ding', step: 0, time: Date.now() }
      });
      window.dispatchEvent(evt);
      console.log('TEST: Event dispatched');
    });

    // 6. Verify HUD updates
    // The HUD update might take a frame or two
    await expect(page.locator('#hudCorrect')).toContainText('1', { timeout: 10000 });
    await expect(page.locator('#hudTotal')).toContainText('1');
    await expect(page.locator('#hudAccuracy')).toContainText('%');

    // 7. Stop Coaching Session
    await page.locator('#stopCoachingBtn').click();
    await expect(hud).toBeHidden();

    // 8. Verify Results Modal (Sidebar)
    const resultsSidebar = page.locator('#coachResultsSidebar');
    await expect(resultsSidebar).toBeVisible();
    await expect(page.locator('#sidebar-overallScore')).toContainText('%');

    // 9. Verify Save Session Button
    const saveBtn = page.locator('#saveSessionBtn');
    await expect(saveBtn).toBeVisible();
  });
});
