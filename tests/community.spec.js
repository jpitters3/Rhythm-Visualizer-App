const { test, expect } = require('@playwright/test');
const { createClient } = require('@supabase/supabase-js');
const { createTestUser, deleteTestUser, supabaseAdmin } = require('./utils/auth-helper');
const { waitForPageReady } = require('./utils/page-helper');

// Supabase Setup
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

test.describe('Community Features', () => {
  let testUser;

  test.beforeEach(async ({ page }) => {
    // Debug console logs (keep for now)
    page.on('console', msg => console.log(`[Browser Console]: ${msg.text()}`));
    page.on('pageerror', err => console.log(`[Browser Error]: ${err.message}`));

    // 1. Create unique test user
    try {
      testUser = await createTestUser();
    } catch (e) {
      console.error("Skipping auth test due to missing credentials/admin keys");
      test.skip();
      return;
    }

    // 2. Navigate and wait for page to be fully loaded
    await waitForPageReady(page);

    // 3. Login
    // Check Desktop vs Mobile login button. #accountBtn only becomes visible
    // once already signed in — a fresh guest sees #authBtn instead (desktop)
    // or the flattened hamburger menu (mobile).
    const accountBtn = page.locator('#accountBtn');
    const authBtn = page.locator('#authBtn');
    const mobileMenuBtn = page.locator('#mobileMenuBtn');

    if (await accountBtn.isVisible()) {
      // Desktop/Tablet, already signed in: clicking opens the dropdown.
      await accountBtn.click();
    } else if (await authBtn.isVisible()) {
      // Desktop/Tablet guest: #authBtn opens the auth modal directly.
      await authBtn.click();
    } else if (await mobileMenuBtn.isVisible()) {
      // Mobile: nav is hidden behind the hamburger menu — open it first.
      await mobileMenuBtn.click();
      await page.waitForTimeout(500); // Wait for menu animation
      // Now #authBtn inside the menu should be visible and clickable
      await page.click('#authBtn');
    }

    await expect(page.locator('#authModal')).toHaveClass(/open/);

    await page.fill('#authEmail', testUser.email);
    await page.click('#authContinueBtn');
    await page.locator('#authPasswordRow').waitFor({ state: 'visible', timeout: 10000 });
    await page.fill('#authPass', testUser.password);
    await page.click('#authLogin');

    // Wait for success with longer timeout
    await expect(page.locator('#authHint')).toContainText('Signed in!', { timeout: 10000 });
    await expect(page.locator('#authModal')).not.toHaveClass(/open/);

    // 4. Seed Profile immediately to ensure it exists for all tests
    // Use admin client to bypass RLS and ensure FK satisfaction
    try {
      await supabaseAdmin.from('profiles').insert({
        user_id: testUser.user.id,
        username: testUser.email.split('@')[0],
        first_name: 'Test',
        last_name: 'User'
      });
    } catch (e) {
      console.warn('Profile seed in beforeEach failed (may exist):', e);
    }
  });

  test.afterEach(async ({ page }) => {
    // Clear browser session to prevent test interference
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());

    // Delete test user from Supabase
    if (testUser) {
      await deleteTestUser(testUser.user.id);
    }
  });

  test('Create and Delete a Community Post', async ({ page }) => {
    // 1. Open Community Modal
    // Wait for JS initialization
    // Community is a route (#view-community), not a modal — #communityBtn
    // and #feedModal never existed in the app. Navigate directly, matching
    // how every other route-based test in this suite gets to a view.
    await page.goto('/#community');
    await expect(page.locator('#view-community')).toBeVisible({ timeout: 10000 });

    // 2. Switch to Discussion Tab
    await page.click('#navDiscussionBtn'); // Ensure tab is active

    // 3. Wait for Feed to Load
    const feed = page.locator('#postsFeed');
    await expect(feed).toBeVisible();

    // 4. Create Post
    const postContent = `Test Post ${Date.now()}`;
    await page.fill('#newPostContent', postContent);
    await page.click('#publishPostBtn');

    // 5. Verify Post Appears
    // Wait for feed update (it fetches after post)
    await expect(page.locator('.post-text').filter({ hasText: postContent })).toBeVisible({ timeout: 10000 });

    // 6. Delete Post
    const postCard = page.locator('.post-card').filter({ hasText: postContent }).first();

    const deleteBtn = postCard.locator('[data-action="delete-post"]');
    await deleteBtn.click();

    // Handle custom confirm modal (app uses #confirmModal, not native dialog)
    await page.locator('#confirmModal.open').waitFor({ timeout: 5000 });
    await page.click('#confirmOkBtn');

    // 7. Verify Removal
    await expect(postCard).not.toBeVisible({ timeout: 10000 });
  });

  test('Feed renders existing posts', async ({ page }) => {
    // 1. Seed a post via API
    const timestamp = Date.now();
    const content = `Seeded Post ${timestamp}`;

    // Profile is already seeded in beforeEach!

    // Use admin client to seed post (bypassing RLS need for auth client)
    const { data: post, error } = await supabaseAdmin
      .from('community_posts')
      .insert({
        user_id: testUser.user.id,
        content: content
      })
      .select()
      .single();

    if (error) throw new Error(`Seeding failed: ${error.message}`);

    // 2. Open Community
    // Wait for JS initialization
    // Community is a route (#view-community), not a modal — #communityBtn
    // and #feedModal never existed in the app. Navigate directly, matching
    // how every other route-based test in this suite gets to a view.
    await page.goto('/#community');
    await expect(page.locator('#view-community')).toBeVisible({ timeout: 10000 });
    await page.click('#navDiscussionBtn');

    // 3. Verify it appears
    const postCard = page.locator('.post-card').filter({ hasText: content });
    await expect(postCard).toBeVisible({ timeout: 10000 });

    // Cleanup happens in afterEach (User deletion cascades? Or we delete manually?)
    // Usually cascading delete on user_id, but explicit delete is safer.
    await supabase.from('community_posts').delete().eq('id', post.id);
  });

});
