// @ts-check
const { test, expect } = require('./fixtures');
const { planAccessChange } = require('../supabase/functions/tekmatix-plus/access.ts');

// Rules behind the tekmatix-plus edge function: Tekmatix client tags and
// attended lessons grant Plus. No browser involved, so run it once.
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'pure logic; one project is enough');
});

const now = new Date('2026-11-02T12:00:00Z');
const days = n => new Date(now.getTime() + n * 86400000).toISOString();
const free = { subscription_tier: 'player', subscription_source: null, subscription_expires_at: null };

test('group grant gives Panafide+ for 8 weeks, private Pro for 6', () => {
  expect(planAccessChange(free, { action: 'grant', program: 'group' }, now)).toEqual({
    subscription_tier: 'player_plus',
    subscription_status: 'active',
    subscription_source: 'tekmatix',
    subscription_expires_at: days(56),
  });
  expect(planAccessChange(free, { action: 'grant', program: 'private' }, now)).toMatchObject({
    subscription_tier: 'pro',
    subscription_expires_at: days(42),
  });
  expect(planAccessChange(free, { action: 'grant', until: days(10) }, now)?.subscription_expires_at).toBe(days(10));
  expect(() => planAccessChange(free, { action: 'grant' }, now)).toThrow();
});

test('a later lesson extends access but never shortens it', () => {
  const client = { subscription_tier: 'player_plus', subscription_source: 'tekmatix', subscription_expires_at: days(20) };
  expect(planAccessChange(client, { action: 'grant', program: 'private' }, now)?.subscription_expires_at).toBe(days(42));

  const longGroup = { ...client, subscription_expires_at: days(50) };
  expect(planAccessChange(longGroup, { action: 'grant', program: 'private' }, now)?.subscription_expires_at).toBe(days(50));
});

test('a private student who joins a group keeps Pro', () => {
  const privateStudent = { subscription_tier: 'pro', subscription_source: 'tekmatix', subscription_expires_at: days(30) };
  expect(planAccessChange(privateStudent, { action: 'grant', program: 'group' }, now)).toMatchObject({
    subscription_tier: 'pro',
    subscription_expires_at: days(56),
  });
  // Once their Pro has lapsed, a group grant gives Panafide+.
  const lapsed = { ...privateStudent, subscription_expires_at: days(-1) };
  expect(planAccessChange(lapsed, { action: 'grant', program: 'group' }, now)?.subscription_tier).toBe('player_plus');
  expect(() => planAccessChange(free, { action: 'grant', program: 'group', tier: 'gold' }, now)).toThrow();
});

test('Stripe payers are never touched', () => {
  const payer = { subscription_tier: 'player_plus', subscription_source: 'stripe', subscription_expires_at: days(20) };
  expect(planAccessChange(payer, { action: 'grant', program: 'group' }, now)).toBeNull();
  expect(planAccessChange(payer, { action: 'revoke' }, now)).toBeNull();

  // A lapsed Stripe member can be granted program access.
  const lapsed = { ...payer, subscription_expires_at: days(-5) };
  expect(planAccessChange(lapsed, { action: 'grant', program: 'group' }, now)?.subscription_source).toBe('tekmatix');
});

test('revoke ends only tag-granted access', () => {
  const client = { subscription_tier: 'player_plus', subscription_source: 'tekmatix', subscription_expires_at: days(20) };
  expect(planAccessChange(client, { action: 'revoke' }, now)).toEqual({
    subscription_status: 'canceled',
    subscription_expires_at: now.toISOString(),
  });
  expect(planAccessChange(free, { action: 'revoke' }, now)).toBeNull();
  const manual = { subscription_tier: 'player_plus', subscription_source: 'mentorship', subscription_expires_at: days(20) };
  expect(planAccessChange(manual, { action: 'revoke' }, now)).toBeNull();
});
