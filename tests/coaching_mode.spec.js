const { test, expect } = require('@playwright/test');
require('dotenv').config();

const { createTestUser, deleteTestUser } = require('./utils/auth-helper');
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

    // Mock getUserMedia
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = async () => {
        return {
          getTracks: () => [{ stop: () => { } }]
        };
      };
    });

    await waitForPageReady(page);

    // Sign In
    const accountBtn = page.locator('#accountBtn');
    if (await accountBtn.isVisible()) {
      const text = await accountBtn.innerText();
      if (text.includes('Sign In') || text.includes('Register')) {
        await accountBtn.click();
        await page.fill('#authEmail', testUser.email);
        await page.fill('#authPass', testUser.password);
        await page.click('#authLogin');
        await expect(page.locator('#authHint')).toContainText('Signed in!', { timeout: 10000 });
        await page.waitForTimeout(1000);
      }
    }
  });

  test.afterEach(async ({ page }) => {
    if (testUser) {
      await deleteTestUser(testUser.user.id);
    }
  });

  test('Start Coaching Mode and Verify HUD', async ({ page }) => {
    // 1. Ensure pattern has notes (Add a Ding at step 0)
    await page.locator('.cell').first().click();
    await page.keyboard.press('d');
    // 2. Click Coach Mode button
    const coachBtn = page.locator('#coachModeBtn');
    await expect(coachBtn).toBeVisible();
    await coachBtn.click();

    // 3. Verify Countdown Overlay appears
    const countdown = page.locator('#countdownOverlay');
    await expect(countdown).toBeVisible();
    await expect(countdown).toContainText(/[1-4]/);

    // 4. Wait for countdown to finish and HUD to appear
    await expect(countdown).toBeHidden({ timeout: 6000 });
    const hud = page.locator('#coachingHUD');
    await expect(hud).toBeVisible();
    await expect(page.locator('#hudAccuracy')).toContainText('0%');

    // 5. Mock a note detection via Event Bus (CustomEvent)
    await page.evaluate(() => {
      console.log('TEST: Dispatching coaching:evaluate event');
      // Ensure activeGrid exists and has transcriptionIndex set
      if (!window.activeGrid) {
        console.log('TEST: window.activeGrid missing, mocking...');
        window.activeGrid = { transcriptionIndex: 0, mode: '16', bpm: 90 };
      } else {
        console.log('TEST: window.activeGrid exists, setting transcriptionIndex');
        window.activeGrid.transcriptionIndex = 0;
      }

      console.log('TEST: activeGrid state:', JSON.stringify(window.activeGrid));

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
    await expect(page.locator('#hudAccuracy')).not.toContainText('0%');

    // 7. Stop Coaching Session
    await page.locator('#stopCoachingBtn').click();
    await expect(hud).toBeHidden();

    // 8. Verify Results Modal
    const resultsModal = page.locator('#coachingResultsModal');
    await expect(resultsModal).toBeVisible();
    await expect(page.locator('#overallScore')).not.toContainText('0%');

    // 9. Verify Save Session Button
    const saveBtn = page.locator('#saveSessionBtn');
    await expect(saveBtn).toBeVisible();
  });
});
