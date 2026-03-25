// @ts-check
const { test, expect } = require('@playwright/test');
const { createTestUser, deleteTestUser, supabaseAdmin } = require('./utils/auth-helper');
const { waitForPageReady } = require('./utils/page-helper');

test.describe('Course Marketplace', () => {
  let testUser;
  let ownerUser;
  let seededCourseId;

  test.beforeEach(async ({ page }) => {
    // 1. Create unique test users
    testUser = await createTestUser();
    ownerUser = await createTestUser();

    // 2. Navigate and wait for page to be fully loaded
    await waitForPageReady(page);

    // 3. Login
    await loginUser(page, testUser.email, testUser.password);
  });

  test.afterEach(async ({ page }) => {
    // Cleanup seeded course
    if (seededCourseId) {
      await supabaseAdmin.from('courses').delete().eq('id', seededCourseId);
    }

    // Clear session and delete users
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
    if (testUser) {
      await deleteTestUser(testUser.user.id);
    }
    if (ownerUser) {
      await deleteTestUser(ownerUser.user.id);
    }
  });

  test('Unlock a free course from the Marketplace', async ({ page }) => {
    // 1. Seed a new free course via Admin client
    const courseTitle = `Test Marketplace Course ${Date.now()}`;
    const { data: course, error } = await supabaseAdmin
      .from('courses')
      .insert([{
        title: courseTitle,
        description: 'A free course for testing the marketplace.',
        price: 0,
        is_paid: false,
        is_published: true,
        owner_id: ownerUser.user.id // Owned by someone else
      }])
      .select()
      .single();

    if (error) throw error;
    seededCourseId = course.id;

    // 2. Open Course Sidebar
    const sidebar = await openCoursesSidebar(page);
    await expect(sidebar).toBeVisible();

    // 3. Click on the Marketplace button
    // The button has data-action="open-marketplace"
    const openMarketBtn = page.locator('[data-action="open-marketplace"]');
    await expect(openMarketBtn).toBeVisible();
    await openMarketBtn.click();

    // 4. Verify Marketplace Modal is open and shows the course
    const marketModal = page.locator('#marketplaceModal');
    await expect(marketModal).toHaveClass(/open/);

    const courseCard = page.locator(`.market-card:has-text("${courseTitle}")`);
    await expect(courseCard).toBeVisible();

    // 5. "Get" the course
    const getBtn = courseCard.locator('button[data-action="unlock-course"]');
    await expect(getBtn).toContainText('Get Course');

    await getBtn.click();

    // Dismiss "Course activated! Let's start learning." custom alert
    await page.locator('#confirmModal.open').waitFor({ timeout: 10000 });
    await page.click('#confirmOkBtn');

    // 6. Verify Marketplace closed (closeMarketplace() called after alert dismissed)
    await expect(marketModal).not.toHaveClass(/open/, { timeout: 5000 });
    // Give it a moment for the sidebar to refresh
    await page.waitForTimeout(1000);

    // 7. Re-open Marketplace to verify "Owned" status
    await openMarketBtn.click();
    await expect(marketModal).toHaveClass(/open/);

    // After unlock, button changes to "Archive" (data-action="archive-course")
    const ownedBtn = marketModal.locator(`.market-card:has-text("${courseTitle}")`).locator('button[data-action="archive-course"]');
    await expect(ownedBtn).toBeVisible();
    await expect(ownedBtn).toContainText('Archive');

    // 8. Close Marketplace
    await page.locator('#closeMarketBtn').click();
    await expect(marketModal).not.toHaveClass(/open/, { timeout: 5000 });

    // 9. Verify it exists in the course sidebar (My Courses / Library)
    const courseInSidebar = sidebar.locator(`.course-item:has-text("${courseTitle}")`);
    await expect(courseInSidebar).toBeVisible();
  });
});

async function loginUser(page, email, password) {
  await ensureMenuOpen(page);

  // Desktop vs Mobile login button
  const authBtnSelector = await page.locator('#authBtn').isVisible() ? '#authBtn' : '#accountBtn';
  const loginBtn = page.locator(authBtnSelector);

  const text = await loginBtn.innerText();
  if (!text.includes('Sign In') && !text.includes('Register')) {
    console.log("Already signed in?");
    return;
  }

  await loginBtn.click();

  await expect(page.locator('#authModal')).toHaveClass(/open/);
  await page.fill('#authEmail', email);
  await page.click('#authContinueBtn');
  await page.locator('#authPasswordRow').waitFor({ state: 'visible', timeout: 10000 });
  await page.fill('#authPass', password);
  await page.click('#authLogin');

  await expect(page.locator('#authHint')).toContainText('Signed in!', { timeout: 10000 });
  await expect(page.locator('#authModal')).not.toHaveClass(/open/);
}

async function openCoursesSidebar(page) {
  const sidebar = page.locator('#courseSidebar');

  const isOpen = await sidebar.evaluate(el => el.classList.contains('open'));
  if (!isOpen) {
    const toggleBtn = page.locator('#toggleSidebarBtn');
    if (await toggleBtn.isVisible()) {
      await toggleBtn.click();
    } else {
      // For mobile or desktop dropdown
      const mobileBtn = page.locator('#mobileMenuBtn');
      if (await mobileBtn.isVisible()) {
        await mobileBtn.click();
      } else {
        const desktopBtn = page.locator('#accountBtn');
        await desktopBtn.click();
      }
      await page.waitForTimeout(500);
      await toggleBtn.click({ force: true });
    }
    await expect(sidebar).toHaveClass(/open/);
  }
  return sidebar;
}

async function ensureMenuOpen(page) {
  const mobileBtn = page.locator('#mobileMenuBtn');
  if (await mobileBtn.isVisible()) {
    const menu = page.locator('#headerMenu');
    const isOpen = await menu.evaluate(el => el.classList.contains('open'));
    if (!isOpen) {
      await mobileBtn.click();
      await page.waitForTimeout(500);
    }
  }
}
