const { test, expect } = require('@playwright/test');
require('dotenv').config();

let isMobile = false;

async function clickAccountBtn(page) {
  if (isMobile) {
    await page.locator('#mobileMenuBtn').click();
  } else {
    await page.locator('#accountBtn').click({ force: true });
  }
}

const { createTestUser, deleteTestUser } = require('./utils/auth-helper');
const { waitForPageReady } = require('./utils/page-helper');

test.describe('Practice Plan', () => {
  let testUser;

  test.beforeEach(async ({ page }) => {
    // Create unique test user (admin so #openCourseModalBtn is visible)
    testUser = await createTestUser(true);

    // Enable Console Logs
    page.on('console', msg => console.log(`BROWSER LOG: ${msg.text()}`));

    // Navigate and wait for page to be fully loaded
    await waitForPageReady(page);

    // Auth Check
    const accountBtn = page.locator('#accountBtn');
    const authBtn = page.locator('#authBtn');

    if (await accountBtn.isVisible()) {
      const text = await accountBtn.innerText();
      if (!text.includes('Sign In')) {
      }
    }

    // Sign In
    const mobileMenuBtn = page.locator('#mobileMenuBtn');
    if (await mobileMenuBtn.isVisible()) {
      await mobileMenuBtn.click();
      isMobile = true;
    }
    const loginBtn = await authBtn.isVisible() ? page.locator('#authBtn') : page.locator('#accountBtn');
    if (await loginBtn.isVisible()) {
      await loginBtn.click();

      console.log(`[PRACTICE-TEST] Logging in with:`, {
        email: testUser.email,
        password: testUser.password
      });

      await page.fill('#authEmail', testUser.email);
      await page.click('#authContinueBtn');
      await page.locator('#authPasswordRow').waitFor({ state: 'visible', timeout: 10000 });
      await page.fill('#authPass', testUser.password);
      await page.click('#authLogin');

      // Explicitly wait for Auth to be settled with longer timeout
      await expect(page.locator('#authHint')).toContainText('Signed in!', { timeout: 10000 });

      // DEBUG WAIT
      await page.waitForTimeout(2000);

      await expect(page.locator('#authModal')).not.toHaveClass(/open/);
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

  test('Add and Remove Lesson from Practice Plan', async ({ page }, testInfo) => {
    // --- SETUP: Create a temporary course and lesson ---

    // 1. Open Course Creator via Account Dropdown (Admin only, user is admin by default test env)
    const accountBtn = page.locator('#accountBtn');
    const mobileMenuBtn = page.locator('#mobileMenuBtn');

    await clickAccountBtn(page);

    const createBtn = page.locator('#openCourseModalBtn');
    await expect(createBtn).toBeVisible();
    await createBtn.click();

    // 2. Fill Course Details
    const timestamp = Date.now();
    const courseTitle = `Practice Test Course ${timestamp}`;
    await page.fill('#courseTitle', courseTitle);
    await page.fill('#courseDesc', 'For testing practice plan');

    // 3. Add Section and Lesson content (Crucial so we have a lesson to add)
    const sectionBuilder = page.locator('.section-builder').first();
    await expect(sectionBuilder).toBeVisible();

    await sectionBuilder.locator('.add-lesson-btn').click();
    const lessonBuilder = sectionBuilder.locator('.lesson-builder').first();
    await expect(lessonBuilder).toBeVisible();

    const lessonTitle = `Test Lesson ${timestamp}`;
    await lessonBuilder.locator('.lesson-title-input').fill(lessonTitle);

    // Publish the section so RLS allows reading its lessons
    const sectionPublishToggle = sectionBuilder.locator('[data-field="section-published"]');
    await sectionPublishToggle.check();

    // 4. Save Course
    await page.click('#saveCourseBtn');

    // Dismiss "Course saved successfully!" custom alert
    await page.locator('#confirmModal.open').waitFor({ timeout: 10000 });
    await page.click('#confirmOkBtn');

    // Wait for modal to close
    await expect(page.locator('#courseModal')).not.toHaveClass(/open/, { timeout: 5000 });
    // Allow CSS transitions to finish or overlay to be removed
    await page.waitForTimeout(500);

    // 5. Open Course Sidebar to find the new course
    const sidebar = page.locator('#courseSidebar');
    await page.evaluate(() => document.getElementById('toggleSidebarBtn')?.click());
    await expect(sidebar).toHaveClass(/open/, { timeout: 5000 });

    // 6. Find the lesson link — course is already expanded after creation
    const lessonLink = page.locator('.lesson-link', { hasText: lessonTitle });
    await expect(lessonLink).toBeVisible({ timeout: 10000 });

    // 7. Click the lesson link
    await lessonLink.click();

    // --- TEST ACTION: Add to Practice ---

    // 8. Verify Lesson Loaded
    await expect(page.locator('#activeLessonTitle')).toContainText(lessonTitle);

    // 9. Click "Add to Plan" button
    const addToPlanBtn = page.locator('#addPracticeBtn');
    await expect(addToPlanBtn).toBeVisible();

    await addToPlanBtn.scrollIntoViewIfNeeded();
    await addToPlanBtn.click({ force: true });
    await expect(addToPlanBtn).toContainText('Remove'); // Verify Toggle State

    // 10. Open Practice Sidebar (if not auto-opened)
    const practiceSidebar = page.locator('#practiceSidebar');
    if (!await practiceSidebar.getAttribute('class').then(c => c?.includes('open'))) {
      const togglePracticeBtn = page.locator('#togglePracticeBtn');
      await togglePracticeBtn.click();
    }
    await expect(practiceSidebar).toHaveClass(/open/);

    // 11. Verify Item is there
    const practiceItem = page.locator('.practice-item', { hasText: lessonTitle });
    await expect(practiceItem).toBeVisible();

    // 12. Remove item via Practice Sidebar
    const removeBtn = practiceItem.locator('.remove-practice-btn');

    // Handle confirm dialog for removal
    page.once('dialog', dialog => dialog.accept());
    await removeBtn.scrollIntoViewIfNeeded(); // Fix viewport issue
    await removeBtn.click({ force: true });

    // Verify removed
    await expect(practiceItem).not.toBeVisible();

    // --- CLEANUP: Delete the course ---
    // (Optional, dependent on cleanliness requirements. We can skip for now)
  });
});
