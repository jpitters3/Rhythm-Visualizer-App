// @ts-check
const { test, expect } = require('./fixtures');
const { accessSummary, planAdminChange } = require('../supabase/functions/admin-plus/plan.ts');
const { createTestUser, deleteTestUser, loginAsTestUser } = require('./utils/auth-helper');

const now = new Date('2026-11-24T12:00:00Z');
const days = n => new Date(now.getTime() + n * 86400000).toISOString();
const free = { subscription_tier: 'player', subscription_source: null, subscription_expires_at: null };

test.describe('admin-plus rules', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'pure logic; one project is enough');
  });

  test('grants the chosen tier until the chosen date, as program access', () => {
    expect(planAdminChange(free, { tier: 'pro', expiresAt: days(30) }, now)).toEqual({
      subscription_tier: 'pro',
      subscription_status: 'active',
      subscription_source: 'tekmatix',
      subscription_expires_at: days(30),
    });
  });

  test('can shorten or downgrade an earlier grant', () => {
    const pro = { subscription_tier: 'pro', subscription_source: 'tekmatix', subscription_expires_at: days(60) };
    expect(planAdminChange(pro, { tier: 'player_plus', expiresAt: days(10) }, now)).toMatchObject({
      subscription_tier: 'player_plus',
      subscription_expires_at: days(10),
    });
  });

  test('"none" ends active access now and leaves free members alone', () => {
    const plus = { subscription_tier: 'player_plus', subscription_source: 'tekmatix', subscription_expires_at: days(20) };
    expect(planAdminChange(plus, { tier: 'none' }, now)).toEqual({
      subscription_status: 'canceled',
      subscription_expires_at: now.toISOString(),
    });
    expect(planAdminChange(free, { tier: 'none' }, now)).toBeNull();
  });

  test('never touches a paying Stripe member', () => {
    const payer = { subscription_tier: 'player_plus', subscription_source: 'stripe', subscription_expires_at: days(25) };
    expect(() => planAdminChange(payer, { tier: 'pro', expiresAt: days(90) }, now)).toThrow(/Stripe/);
    expect(accessSummary(payer, now)).toMatchObject({ active: true, stripe: true });
  });

  test('rejects missing, past and far-off dates and unknown tiers', () => {
    expect(() => planAdminChange(free, { tier: 'pro' }, now)).toThrow(/end date/);
    expect(() => planAdminChange(free, { tier: 'pro', expiresAt: days(-1) }, now)).toThrow(/future/);
    expect(() => planAdminChange(free, { tier: 'pro', expiresAt: days(6 * 365) }, now)).toThrow(/5 years/);
    // @ts-expect-error: testing a bad value
    expect(() => planAdminChange(free, { tier: 'gold', expiresAt: days(5) }, now)).toThrow(/tier/);
  });
});

test.describe('Clients page: Panafide access', () => {
  let admin;

  test.beforeEach(async ({ page }) => {
    admin = await createTestUser(true);
    const client = (id, name, email, programs) => ({
      id, name, email, programs, photo: null, phone: null,
      nextAppointment: null, lastAppointment: null, summary: null, videoUrl: null,
      profileUrl: 'https://example.com',
    });
    await page.route('**/functions/v1/tekmatix-clients', route => route.fulfill({
      json: {
        clients: [
          client('c1', 'Ada Student', 'ada@example.com', ['group']),
          client('c2', 'Ben Payer', 'ben@example.com', ['mentorship']),
          client('c3', 'Cy Newcomer', 'cy@example.com', ['group']),
        ],
      },
    }));
    await loginAsTestUser(page, admin);
  });

  test.afterEach(async () => {
    if (admin) await deleteTestUser(admin.user.id);
  });

  test('shows each client’s access and lets an admin set tier and end date', async ({ page }) => {
    const saves = [];
    await page.route('**/functions/v1/admin-plus', async route => {
      const body = route.request().postDataJSON();
      if (body.action === 'lookup') {
        return route.fulfill({
          json: {
            accounts: {
              'ada@example.com': { username: 'ada', tier: 'player', expiresAt: null, source: null, active: false, stripe: false },
              'ben@example.com': { username: 'ben', tier: 'player_plus', expiresAt: null, source: 'stripe', active: true, stripe: true },
              'cy@example.com': null,
            },
          },
        });
      }
      saves.push(body);
      return route.fulfill({
        json: { account: { username: 'ada', tier: body.tier, expiresAt: body.expiresAt, source: 'tekmatix', active: true, stripe: false } },
      });
    });

    await page.goto('/#clients');
    const ada = page.locator('.cl-card[data-client="c1"]');
    await expect(ada.locator('.cl-access-status')).toHaveText('Free');
    await expect(page.locator('.cl-card[data-client="c2"] .cl-access-status')).toContainText('pays via Stripe');
    await expect(page.locator('.cl-card[data-client="c2"] [data-access]')).toHaveCount(0);
    await expect(page.locator('.cl-card[data-client="c3"] .cl-access-status')).toContainText('No account for cy@example.com');

    await ada.locator('[data-access]').click();
    const dialog = page.locator('.cl-access-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.cl-access-who')).toHaveText('Ada Student · @ada');
    // A group client starts on the group's usual access: Panafide+ for 8 weeks.
    await expect(dialog.locator('input[value="player_plus"]')).toBeChecked();

    await dialog.locator('label', { hasText: 'Panafide Pro' }).click();
    await dialog.locator('[data-weeks="12"]').click();
    const picked = await dialog.locator('#clAccessUntil').inputValue();
    await dialog.locator('button[type="submit"]').click();

    await expect(dialog).toBeHidden();
    expect(saves).toHaveLength(1);
    expect(saves[0]).toMatchObject({ action: 'set', email: 'ada@example.com', tier: 'pro' });
    // End of the picked day, in the admin's timezone.
    const [y, m, d] = picked.split('-').map(Number);
    expect(saves[0].expiresAt).toBe(new Date(y, m - 1, d, 23, 59, 59).toISOString());
    await expect(ada.locator('.cl-access-status')).toContainText('Panafide Pro until');
  });

  test('shows the server’s reason when a save is refused, and "No access" hides the date', async ({ page }) => {
    await page.route('**/functions/v1/admin-plus', async route => {
      const body = route.request().postDataJSON();
      if (body.action === 'lookup') {
        return route.fulfill({
          json: { accounts: { 'ada@example.com': { username: 'ada', tier: 'pro', expiresAt: '2027-01-01T04:59:59.000Z', source: 'tekmatix', active: true, stripe: false } } },
        });
      }
      return route.fulfill({ status: 409, json: { error: 'This member pays through Stripe; manage it in Stripe instead.' } });
    });

    await page.goto('/#clients');
    const ada = page.locator('.cl-card[data-client="c1"]');
    await expect(ada.locator('.cl-access-status')).toContainText('Panafide Pro until');
    await ada.locator('[data-access]').click();
    const dialog = page.locator('.cl-access-dialog');
    await expect(dialog.locator('input[value="pro"]')).toBeChecked();

    await dialog.locator('label', { hasText: 'No access' }).click();
    await expect(dialog.locator('.cl-until')).toBeHidden();
    await dialog.locator('button[type="submit"]').click();
    await expect(dialog.locator('.cl-access-error')).toHaveText(/pays through Stripe/);
    await expect(dialog).toBeVisible();
  });
});
