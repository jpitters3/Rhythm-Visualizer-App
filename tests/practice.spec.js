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

test.describe('Practice Plan', () => {
  let testUser;

  test.beforeEach(async ({ page }) => {
    // Create unique test user
    testUser = await createTestUser();

    // Enable Console Logs
    page.on('console', msg => console.log(`BROWSER LOG: ${msg.text()}`));
    await page.goto('/');

    // Auth Check
    const accountBtn = page.locator('#accountBtn');
    const authBtn = page.locator('#authBtn');

    if (await accountBtn.isVisible()) {
      const text = await accountBtn.innerText();
      if (!text.includes('Sign In')) {
        // If somehow logged in (shouldn't happen with fresh context), log out? 
        // Or just assume fresh context.
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
      await page.fill('#authEmail', testUser.email);
      await page.fill('#authPass', testUser.password);
      await page.click('#authLogin');

      // Explicitly wait for Auth to be settled
      await expect(page.locator('#authHint')).toContainText('Signed in!', { timeout: 15000 });

      // DEBUG WAIT
      await page.waitForTimeout(2000);

      await expect(page.locator('#authModal')).not.toHaveClass(/open/);
    }
  });

  test.afterEach(async () => {
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

    // 4. Save Course
    // Handle alert dialog if any, though usually specific save actions might rely on UI feedback.
    // course-creator.js uses alert() for success.
    page.once('dialog', dialog => {
      console.log(`Dialog message: ${dialog.message()}`);
      dialog.accept().catch(() => { });
    });

    await page.click('#saveCourseBtn');

    // Wait for modal to close
    await expect(page.locator('#courseModal')).not.toHaveClass(/open/);
    await expect(page.locator('#courseModal')).toBeHidden();
    // Allow CSS transitions to finish or overlay to be removed
    await page.waitForTimeout(500);

    // 5. Open Course Sidebar to find the new course
    await clickAccountBtn(page);

    const toggleBtn = page.locator('#toggleSidebarBtn');
    await toggleBtn.click();
    const sidebar = page.locator('#courseSidebar');

    // Ensure sidebar is open
    if (!await sidebar.getAttribute('class').then(c => c?.includes('open'))) {
      if (await toggleBtn.isVisible()) {
        await toggleBtn.click();
      } else {
        // Mobile fallback
        const mobileMenuBtn = page.locator('#mobileMenuBtn');
        if (await mobileMenuBtn.isVisible()) {
          await mobileMenuBtn.click();
          await page.locator('#toggleSidebarBtn').click();
        }
      }
    }
    await expect(sidebar).toHaveClass(/open/);

    // 6. Find and Expand the new Course
    const newCourseHeader = page.locator('.course-item .course-header', { hasText: courseTitle });
    // It might take a moment to fetch
    await newCourseHeader.waitFor({ state: 'visible', timeout: 10000 });
    await newCourseHeader.click();

    // 7. Click the lesson link
    const lessonLink = page.locator('.lesson-link', { hasText: lessonTitle });
    await expect(lessonLink).toBeVisible();
    await lessonLink.click();

    // --- TEST ACTION: Add to Practice ---

    // 8. Verify Lesson Loaded
    await expect(page.locator('#activeLessonTitle')).toContainText(lessonTitle);

    // 9. Click "Add to Plan" button
    const addToPlanBtn = page.locator('#addPracticeBtn');
    await expect(addToPlanBtn).toBeVisible();

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
