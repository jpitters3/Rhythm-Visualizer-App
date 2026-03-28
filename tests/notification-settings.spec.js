/**
 * tests/notification-settings.spec.js
 *
 * Verifies that notification preferences (in-app + email toggles) can be
 * toggled in the Account Settings sidebar and are persisted to the DB.
 *
 * Covered cases:
 *   1. Sidebar opens and shows notification toggle rows for the user's role
 *   2. Toggling a preference off is saved to notification_preferences table
 *   3. After a page refresh the saved preference is reflected in the UI
 */

const { test, expect } = require('@playwright/test');
require('dotenv').config();

const { createTestUser, deleteTestUser, loginAsTestUser, supabaseAdmin } = require('./utils/auth-helper');
const { waitForPageReady } = require('./utils/page-helper');

// ── helpers ───────────────────────────────────────────────────────────────────

async function createStudentUser() {
  const user = await createTestUser(false);
  const { error } = await supabaseAdmin
    .from('profiles')
    .upsert({ user_id: user.user.id, role: 'student', username: user.email.split('@')[0] });
  if (error) throw new Error(`Failed to create student profile: ${error.message}`);
  return user;
}

async function openAccountSettings(page) {
  await page.locator('#accountBtn').click({ force: true });
  await page.locator('#openAccountAuthBtn').waitFor({ state: 'visible', timeout: 5000 });
  await page.locator('#openAccountAuthBtn').click();
  await expect(page.locator('#accountSettingsSidebar')).toHaveClass(/open/, { timeout: 5000 });
}

async function getPrefsFromDB(userId) {
  const { data } = await supabaseAdmin
    .from('notification_preferences')
    .select('notif_type, in_app, email')
    .eq('user_id', userId);
  return data ?? [];
}

// ── tests ─────────────────────────────────────────────────────────────────────

test.describe('Notification settings', () => {
  let studentUser;

  test.beforeEach(async () => {
    studentUser = await createStudentUser();
  });

  test.afterEach(async () => {
    if (studentUser) await deleteTestUser(studentUser.user.id);
  });

  test('sidebar shows notification toggles for student role', async ({ page }) => {
    test.setTimeout(60_000);

    await waitForPageReady(page);
    await loginAsTestUser(page, studentUser);
    await page.waitForTimeout(1000);
    await openAccountSettings(page);

    const body = page.locator('#accountSettingsBody');

    // Student should see these three notification types
    await expect(body.locator('.acct-notif-row-label', { hasText: 'New assignment' })).toBeVisible();
    await expect(body.locator('.acct-notif-row-label', { hasText: 'Assignment sent back' })).toBeVisible();
    await expect(body.locator('.acct-notif-row-label', { hasText: 'Assignment complete' })).toBeVisible();

    // Each row has two toggles (in-app + email), all on by default
    const toggles = body.locator('.notif-toggle input[type="checkbox"]');
    const count = await toggles.count();
    expect(count).toBe(6); // 3 types × 2 channels

    for (let i = 0; i < count; i++) {
      await expect(toggles.nth(i)).toBeChecked();
    }
  });

  test('toggling a preference off persists to the database', async ({ page }) => {
    test.setTimeout(60_000);

    await waitForPageReady(page);
    await loginAsTestUser(page, studentUser);
    await page.waitForTimeout(1000);
    await openAccountSettings(page);

    // Toggle email off for new_assignment (input is visually hidden; click the label)
    const emailToggle = page.locator(
      '#accountSettingsBody input[data-type="new_assignment"][data-channel="email"]'
    );
    const emailLabel = emailToggle.locator('xpath=ancestor::label');
    await expect(emailToggle).toBeChecked();
    await emailLabel.click();
    await expect(emailToggle).not.toBeChecked();

    // Give the async upsert time to complete
    await page.waitForTimeout(1500);

    const prefs = await getPrefsFromDB(studentUser.user.id);
    const pref = prefs.find(p => p.notif_type === 'new_assignment');
    expect(pref).toBeDefined();
    expect(pref.email).toBe(false);
    expect(pref.in_app).toBe(true); // only email was toggled
  });

  test('saved preferences are reflected after a page refresh', async ({ page }) => {
    test.setTimeout(90_000);

    await waitForPageReady(page);
    await loginAsTestUser(page, studentUser);
    await page.waitForTimeout(1000);
    await openAccountSettings(page);

    // Toggle in-app off for assignment_complete (input is visually hidden; click the label)
    const inAppToggle = page.locator(
      '#accountSettingsBody input[data-type="assignment_complete"][data-channel="in_app"]'
    );
    const inAppLabel = inAppToggle.locator('xpath=ancestor::label');
    await inAppLabel.click();
    await expect(inAppToggle).not.toBeChecked();
    await page.waitForTimeout(1500);

    // Refresh and log back in
    await page.reload();
    await waitForPageReady(page);
    await loginAsTestUser(page, studentUser);
    await page.waitForTimeout(1500);
    await openAccountSettings(page);

    // Toggle should still be off
    const inAppToggleAfter = page.locator(
      '#accountSettingsBody input[data-type="assignment_complete"][data-channel="in_app"]'
    );
    await expect(inAppToggleAfter).not.toBeChecked();
  });
});
