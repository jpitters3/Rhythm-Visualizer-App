// @ts-check
const { test, expect } = require('@playwright/test');
const { createTestUser, deleteTestUser, supabaseAdmin } = require('./utils/auth-helper');
const { gotoStudio } = require('./helpers');

/**
 * Sets subscription fields directly on the profile row.
 * Uses the service role key so RLS is bypassed.
 */
async function setSubscription(userId, { tier, expiresAt, source = 'mentorship', status, extra = {} }) {
  const { error } = await supabaseAdmin
    .from('profiles')
    .update({
      subscription_tier: tier,
      subscription_expires_at: expiresAt ? expiresAt.toISOString() : null,
      subscription_source: source,
      subscription_status: status ?? (tier === 'player_plus' ? 'active' : 'inactive'),
      ...extra,
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
    await expect(page.locator('#logoPlusBadge')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.app-header')).toHaveClass(/app-header--plus/);

    // Gated feature (My Scales) should open without upgrade modal. Two
    // separate post-reload init paths race independently of .measure-row
    // and of each other: js/auth.js's updateAccountUI() toggles the button's
    // display, and js/handpanmap.js's own init attaches its click listener.
    // Clicking before either lands is a race Chromium usually wins and
    // WebKit loses more often — retry instead of guessing which one to wait
    // for individually.
    await expect(async () => {
      await page.evaluate(() => document.getElementById('myScalesBtn')?.click());
      await expect(page.locator('#myScalesModal')).toHaveClass(/open/, { timeout: 1000 });
    }).toPass({ timeout: 5000, intervals: [200, 500, 1000] });
    await expect(page.locator('#upgradeModal')).not.toHaveClass(/open/);
  });

  test('expiring soon: warning banner visible with correct text and renew button', async ({ page }) => {
    const soon = new Date(Date.now() + 5 * 86400000); // 5 days out
    await setSubscription(testUser.user.id, { tier: 'player_plus', expiresAt: soon });
    await reloadOnStudio(page);

    const banner = page.locator('#subscriptionBanner');
    await expect(banner).toBeVisible({ timeout: 5000 });
    await expect(banner).not.toHaveClass(/subscription-banner--expired/);
    await expect(page.locator('#subscriptionBannerTitle')).toContainText('expires in 5 day');

    // Gated features still work while expiring (see the other test for why
    // this retries instead of waiting on one specific precondition).
    await expect(async () => {
      await page.evaluate(() => document.getElementById('myScalesBtn')?.click());
      await expect(page.locator('#myScalesModal')).toHaveClass(/open/, { timeout: 1000 });
    }).toPass({ timeout: 5000, intervals: [200, 500, 1000] });
    await expect(page.locator('#upgradeModal')).not.toHaveClass(/open/);

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
    await expect(page.locator('#logoPlusBadge')).toBeHidden();
    await expect(page.locator('.app-header')).not.toHaveClass(/app-header--plus/);

    // Renew button also opens upgrade modal
    await page.evaluate(() => document.getElementById('upgradeModal')?.classList.remove('open'));
    await page.locator('#subscriptionBannerBtn').click();
    await expect(page.locator('#upgradeModal')).toHaveClass(/open/, { timeout: 5000 });
  });

  test('program access: welcome once, then program wording on the banner', async ({ page }) => {
    const soon = new Date(Date.now() + 5 * 86400000);
    await setSubscription(testUser.user.id, { tier: 'player_plus', expiresAt: soon, source: 'tekmatix' });
    // Checked before reloadOnStudio's second navigation, which WebKit can
    // turn into a full reload, after which the once-only welcome is gone.
    await page.reload({ waitUntil: 'networkidle' });

    const welcome = page.locator('#congratsModal');
    await expect(welcome).toHaveClass(/open/, { timeout: 10000 });
    await expect(welcome.locator('.modal-title')).toContainText('included with your program');
    await page.locator('#startGroovingBtn').click();
    await expect(welcome).not.toHaveClass(/open/);
    await page.goto('/#studio');
    await page.waitForSelector('.measure-row');

    await expect(page.locator('#subscriptionBannerTitle')).toContainText('from your program ends in 5 day');
    await expect(page.locator('#subscriptionBannerSub')).toContainText('continues automatically');

    await expect(page.locator('#subscriptionBannerBtn')).toHaveText('Become a Member');

    // Shown once per user.
    await reloadOnStudio(page);
    await expect(page.locator('#subscriptionBanner')).toBeVisible({ timeout: 10000 });
    await expect(welcome).not.toHaveClass(/open/);
  });

  test('Pro features: Panafide+ sees coming soon, Pro gets in', async ({ page }) => {
    const future = new Date(Date.now() + 30 * 86400000);
    const openAi = () => page.evaluate(() => document.querySelector('[data-action="toggle-ai"]')?.click());
    const upgrade = page.locator('#upgradeModal');

    await setSubscription(testUser.user.id, { tier: 'player_plus', expiresAt: future });
    await reloadOnStudio(page);
    await expect(async () => {
      await openAi();
      await expect(upgrade).toHaveClass(/open/, { timeout: 1000 });
    }).toPass({ timeout: 5000, intervals: [200, 500, 1000] });
    await expect(upgrade.locator('.modal-title')).toContainText('Coming Soon');
    await expect(page.locator('#checkoutBtn')).toBeHidden();

    await setSubscription(testUser.user.id, { tier: 'pro', expiresAt: future });
    await reloadOnStudio(page);
    await openAi();
    await page.waitForTimeout(500);
    await expect(upgrade).not.toHaveClass(/open/);
  });

  // Coach Mode's button is admin-only while it's WIP; this covers the Panafide+
  // gate it will ship with.
  test('Coach Mode: free users get the upgrade prompt, Panafide+ gets in', async ({ page }) => {
    const openCoach = () => page.evaluate(() => document.getElementById('coachModeBtn')?.click());
    const upgrade = page.locator('#upgradeModal');

    await expect(async () => {
      await openCoach();
      await expect(upgrade).toHaveClass(/open/, { timeout: 1000 });
    }).toPass({ timeout: 5000, intervals: [200, 500, 1000] });
    await expect(upgrade.locator('.upgrade-intro')).toContainText('Coach Mode');
    await expect(page.locator('#checkoutBtn')).toBeVisible();

    await setSubscription(testUser.user.id, { tier: 'player_plus', expiresAt: new Date(Date.now() + 30 * 86400000) });
    await reloadOnStudio(page);
    await openCoach();
    await page.waitForTimeout(500);
    await expect(upgrade).not.toHaveClass(/open/);
  });

  test('custom scales: free members get one, Panafide+ gets unlimited', async ({ page }) => {
    const canAddScale = (count) => page.evaluate(async (n) => {
      const entryUrl = document.querySelector('script[type="module"][src*="main"]').src;
      const { canAccess, FEATURE } = await import(new URL('js/gated-feature.js', entryUrl).href);
      return canAccess(FEATURE.CUSTOM_SCALES, { count: n });
    }, count);

    expect(await canAddScale(0)).toBe(true);
    expect(await canAddScale(1)).toBe(false);

    await setSubscription(testUser.user.id, { tier: 'player_plus', expiresAt: new Date(Date.now() + 30 * 86400000) });
    await reloadOnStudio(page);
    await expect.poll(() => canAddScale(5)).toBe(true);
  });

  test('plans: compare tiers from the menu, current plan marked', async ({ page }) => {
    const plans = page.locator('#plansModal');
    await page.evaluate(() => document.getElementById('plansBtn')?.click());
    await expect(plans).toHaveClass(/open/);
    await expect(plans.locator('.plan-card.is-current h3')).toHaveText('Free');
    await expect(plans.locator('.plan-card--featured h3')).toHaveText('Panafide+');
    await expect(plans.locator('.plans-table tbody tr')).not.toHaveCount(0);
    await expect(page.locator('#plansUpgradeBtn')).toBeVisible();
    await page.locator('#closePlansBtn').click();
    await expect(plans).not.toHaveClass(/open/);

    await setSubscription(testUser.user.id, { tier: 'player_plus', expiresAt: new Date(Date.now() + 30 * 86400000) });
    await reloadOnStudio(page);
    await expect(async () => {
      await page.evaluate(() => document.getElementById('plansBtn')?.click());
      await expect(plans.locator('.plan-card.is-current h3')).toHaveText('Panafide+', { timeout: 1000 });
    }).toPass({ timeout: 5000 });
    await expect(page.locator('#plansUpgradeBtn')).toBeHidden();
    await page.locator('#closePlansBtn').click();

    // The highlight follows the member's own plan.
    await setSubscription(testUser.user.id, { tier: 'pro', expiresAt: new Date(Date.now() + 30 * 86400000) });
    await reloadOnStudio(page);
    await expect(async () => {
      await page.evaluate(() => document.getElementById('plansBtn')?.click());
      await expect(plans.locator('.plan-card.is-current h3')).toHaveText('Panafide Pro', { timeout: 1000 });
    }).toPass({ timeout: 5000 });
    await expect(plans.locator('.plan-card--featured h3')).toHaveText('Panafide Pro');
  });

  test('Stripe member: no renewal nag, can open pause and cancel', async ({ page }) => {
    await setSubscription(testUser.user.id, {
      tier: 'player_plus', source: 'stripe', status: 'active',
      expiresAt: new Date(Date.now() + 5 * 86400000), extra: { stripe_customer_id: 'cus_test' },
    });
    await reloadOnStudio(page);

    // Stripe renews by itself, so a near expiry isn't a warning.
    await expect(page.locator('#manageSubBtn')).not.toHaveAttribute('hidden', '', { timeout: 10000 });
    await expect(page.locator('#subscriptionBanner')).toBeHidden();

    const manage = page.locator('#manageSubModal');
    await page.evaluate(() => document.getElementById('manageSubBtn').click());
    await expect(manage).toHaveClass(/open/);
    await expect(page.locator('#manageSubStatus')).toContainText('renews on');
    await expect(manage.locator('[data-sub-action="resume"]')).toBeHidden();
    await expect(manage.locator('[data-sub-action="renew"]')).toBeHidden();

    // Cancelling offers a pause first.
    await manage.getByRole('button', { name: 'Cancel subscription' }).click();
    await expect(manage.locator('[data-sub-view="pause"]')).toBeVisible();
    await manage.locator('[data-pause-months="3"]').click();
    await expect(manage.locator('[data-pause-months="3"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(manage.locator('[data-sub-action="cancel"]')).toBeVisible();
  });

  test('Stripe member who cancelled: told when benefits end, can keep Panafide+', async ({ page }) => {
    const expiresAt = new Date(Date.now() + 5 * 86400000);
    await setSubscription(testUser.user.id, {
      tier: 'player_plus', source: 'stripe', status: 'canceling', expiresAt,
      extra: { stripe_customer_id: 'cus_test' },
    });
    await reloadOnStudio(page);

    await expect(page.locator('#subscriptionBannerTitle')).toHaveText('Your subscription has been cancelled', { timeout: 10000 });
    await page.locator('#subscriptionBannerBtn').click();
    await expect(page.locator('#manageSubModal')).toHaveClass(/open/);
    // The banner button keeps working after the modal is closed.
    await page.locator('#closeManageSubBtn').click();
    await page.locator('#subscriptionBannerBtn').click();
    await expect(page.locator('#manageSubModal')).toHaveClass(/open/);
    await expect(page.locator('#manageSubStatus')).toContainText('Your Panafide+ benefits end on');
    await expect(page.locator('#manageSubModal [data-sub-action="renew"]')).toBeVisible();
    await expect(page.locator('#manageSubModal [data-sub-view-open="pause"]').first()).toBeHidden();
  });

  test('paused Stripe member past paid time: free access, resume instead of a second checkout', async ({ page }) => {
    await setSubscription(testUser.user.id, {
      tier: 'player_plus', source: 'stripe', status: 'paused',
      expiresAt: new Date(Date.now() - 86400000),
      extra: { stripe_customer_id: 'cus_test', subscription_resumes_at: new Date(Date.now() + 40 * 86400000).toISOString() },
    });
    await reloadOnStudio(page);

    await expect(page.locator('#subscriptionBannerTitle')).toHaveText('Panafide+ is paused', { timeout: 10000 });
    await expect(page.locator('#subscriptionBannerBtn')).toHaveText('Resume');

    const plans = page.locator('#plansModal');
    await page.evaluate(() => document.getElementById('plansBtn').click());
    await expect(plans.locator('.plan-card.is-current h3')).toHaveText('Free');
    await expect(page.locator('#plansUpgradeBtn')).toBeHidden();
    await page.locator('#plansManageBtn').click();
    await expect(page.locator('#manageSubModal')).toHaveClass(/open/);
    await expect(page.locator('#manageSubStatus')).toContainText('Your subscription has been paused until');
    await expect(page.locator('#manageSubModal [data-sub-action="resume"]')).toBeVisible();
  });

  test('no banner shown when expiry is more than 14 days away', async ({ page }) => {
    const future = new Date(Date.now() + 20 * 86400000); // 20 days out
    await setSubscription(testUser.user.id, { tier: 'player_plus', expiresAt: future });
    await reloadOnStudio(page);

    await expect(page.locator('#subscriptionBanner')).toBeHidden();
  });
});
