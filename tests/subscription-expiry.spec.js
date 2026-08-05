// @ts-check
const { test, expect } = require('@playwright/test');
const { createTestUser, deleteTestUser, supabaseAdmin } = require('./utils/auth-helper');
const { gotoStudio } = require('./helpers');

/**
 * Sets subscription fields directly on the profile row.
 * Uses the service role key so RLS is bypassed.
 */
async function setSubscription(userId, { tier, expiresAt, source = 'mentorship' }) {
  const { error } = await supabaseAdmin
    .from('profiles')
    .update({
      subscription_tier: tier,
      subscription_expires_at: expiresAt ? expiresAt.toISOString() : null,
      subscription_source: source,
      subscription_status: tier === 'player_plus' ? 'active' : 'inactive',
    })
    .eq('user_id', userId);

  if (error) throw new Error(`Failed to set subscription: ${error.message}`);
}

/**
 * Reloads and lands back on Studio. js/dashboard.js's initDashboard() force-
 * navigates any already-authenticated page load to #dashboard regardless of
 * the URL hash, so a plain reload while signed in always bounces there first
 * — an explicit second navigation back to #studio is required afterward.
 */
async function reloadOnStudio(page) {
  await page.reload({ waitUntil: 'networkidle' });
  await page.goto('/#studio');
  await page.waitForSelector('.measure-row');
}

async function signIn(page, user) {
  await page.locator('#authEmail').fill(user.email);
  await page.click('#authContinueBtn');
  await page.locator('#authPasswordRow').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('#authPass').fill(user.password);
  await page.click('#authLogin');
  await expect(page.locator('#authModal')).not.toHaveClass(/open/, { timeout: 15000 });
  await page.locator('#navAccountWrapper').waitFor({ state: 'visible', timeout: 15000 });
}

test.describe('Subscription Expiry', () => {
  let testUser;

  test.beforeEach(async ({ page }) => {
    testUser = await createTestUser();
    await gotoStudio(page);
    await page.waitForSelector('.measure-row');

    // Sign in first so the profile row is created
    await page.evaluate(() => document.getElementById('authBtn')?.click());
    await expect(page.locator('#authModal')).toHaveClass(/open/, { timeout: 5000 });
    await signIn(page, testUser);

    // Wait for profile to be created (app logs "No profile found, creating default...")
    await page.waitForTimeout(1000);

    // A successful login redirects to #dashboard (js/controls.js) — each test
    // then reloads and expects the studio grid, so head back to studio now
    // that we're authenticated (subsequent reloads preserve the #studio hash).
    await page.goto('/#studio');
    await page.waitForSelector('.measure-row');
  });

  test.afterEach(async () => {
    if (testUser) await deleteTestUser(testUser.user.id);
  });

  test('active subscription: no banner, gated features accessible', async ({ page }) => {
    const future = new Date(Date.now() + 30 * 86400000); // 30 days out
    await setSubscription(testUser.user.id, { tier: 'player_plus', expiresAt: future });
    await reloadOnStudio(page);

    // No subscription banner (30 days > 14 day threshold)
    await expect(page.locator('#subscriptionBanner')).toBeHidden();

    // Gated feature (My Scales) should open without upgrade modal
    await page.evaluate(() => document.getElementById('myScalesBtn')?.click());
    await expect(page.locator('#upgradeModal')).not.toHaveClass(/open/);
    await expect(page.locator('#myScalesModal')).toHaveClass(/open/, { timeout: 5000 });
  });

  test('expiring soon: warning banner visible with correct text and renew button', async ({ page }) => {
    const soon = new Date(Date.now() + 5 * 86400000); // 5 days out
    await setSubscription(testUser.user.id, { tier: 'player_plus', expiresAt: soon });
    await reloadOnStudio(page);

    const banner = page.locator('#subscriptionBanner');
    await expect(banner).toBeVisible({ timeout: 5000 });
    await expect(banner).not.toHaveClass(/subscription-banner--expired/);
    await expect(page.locator('#subscriptionBannerTitle')).toContainText('expires in 5 day');

    // Gated features still work while expiring
    await page.evaluate(() => document.getElementById('myScalesBtn')?.click());
    await expect(page.locator('#upgradeModal')).not.toHaveClass(/open/);
    await expect(page.locator('#myScalesModal')).toHaveClass(/open/, { timeout: 5000 });

    // Renew button opens upgrade modal
    await page.keyboard.press('Escape');
    await page.locator('#subscriptionBannerBtn').click();
    await expect(page.locator('#upgradeModal')).toHaveClass(/open/, { timeout: 5000 });
  });

  test('expired subscription: expired banner visible and gated features blocked', async ({ page }) => {
    const past = new Date(Date.now() - 86400000); // 1 day ago
    await setSubscription(testUser.user.id, { tier: 'player_plus', expiresAt: past });
    await reloadOnStudio(page);

    // Expired banner shown in red state
    const banner = page.locator('#subscriptionBanner');
    await expect(banner).toBeVisible({ timeout: 5000 });
    await expect(banner).toHaveClass(/subscription-banner--expired/);
    await expect(page.locator('#subscriptionBannerTitle')).toContainText('expired');

    // Renew button also opens upgrade modal
    await page.evaluate(() => document.getElementById('upgradeModal')?.classList.remove('open'));
    await page.locator('#subscriptionBannerBtn').click();
    await expect(page.locator('#upgradeModal')).toHaveClass(/open/, { timeout: 5000 });
  });

  test('no banner shown when expiry is more than 14 days away', async ({ page }) => {
    const future = new Date(Date.now() + 20 * 86400000); // 20 days out
    await setSubscription(testUser.user.id, { tier: 'player_plus', expiresAt: future });
    await reloadOnStudio(page);

    await expect(page.locator('#subscriptionBanner')).toBeHidden();
  });
});
