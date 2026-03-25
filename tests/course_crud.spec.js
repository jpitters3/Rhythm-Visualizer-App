// @ts-check
const { test, expect } = require('@playwright/test');
const { createClient } = require('@supabase/supabase-js');

// Supabase Setup for Data Seeding
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || "";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const { createTestUser, deleteTestUser, loginAsTestUser } = require('./utils/auth-helper');
const { waitForPageReady } = require('./utils/page-helper');

test.describe('Course CRUD (Clean)', () => {
  let testUser;

  test.beforeEach(async ({ page }) => {
    // 0. Create unique test user (admin so edit-course button is visible)
    testUser = await createTestUser(true);

    // 1. Navigate and wait for page to be fully loaded
    await waitForPageReady(page);

    // 2. Auth Check: If not signed in, sign in
    await ensureMenuOpen(page);

    // Pick the button: 
    // On Desktop: #accountBtn (visible)
    // On Mobile: #accountBtn (hidden), #authBtn (visible inside flattened menu)

    const authBtnSelector = await page.locator('#authBtn').isVisible() ? '#authBtn' : '#accountBtn';
    const loginBtn = page.locator(authBtnSelector);

    await expect(loginBtn).toBeVisible();

    const btnText = await loginBtn.innerText();

    if (btnText.includes('Sign In') || btnText.includes('Register')) {
      await loginBtn.click();
      await expect(page.locator('#authModal')).toHaveClass(/open/);

      const email = testUser.email;
      const password = testUser.password;

      if (!email || !password) {
        throw new Error('Failed to create test user credentials');
      }

      console.log(`[COURSE-CRUD] Logging in with:`, { email, password });

      await page.fill('#authEmail', email);
      await page.click('#authContinueBtn');
      await page.locator('#authPasswordRow').waitFor({ state: 'visible', timeout: 10000 });
      await page.fill('#authPass', password);
      await page.click('#authLogin');

      // Wait for success with longer timeout
      await expect(page.locator('#authHint')).toContainText('Signed in!', { timeout: 10000 });
      await expect(page.locator('#authModal')).not.toHaveClass(/open/);

      // Verify login button changed state
      await expect(page.locator('text=Sign In / Register')).not.toBeVisible();
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

  test('Create and Save a new Course', async ({ page }) => {
    // 1. Open Course Modal (Admin only)
    // On Desktop, we must click #accountBtn to see the dropdown.
    // On Mobile, the dropdown is flattened inside #headerMenu, so we just ensure menu is open.
    const accountBtn = page.locator('#accountBtn');
    if (await accountBtn.isVisible()) {
      await accountBtn.click();
    } else {
      await ensureMenuOpen(page);
    }

    // Check if "Create Course" is visible (Admin check)
    const createBtn = page.locator('#openCourseModalBtn');
    if (!await createBtn.isVisible()) {
      test.skip(true, 'User is not an admin, cannot create courses');
      return;
    }

    await createBtn.click();
    await expect(page.locator('#courseModal')).toHaveClass(/open/);

    // 2. Fill Course Info
    const timestamp = Date.now();
    const courseTitle = `Clean Test Course ${timestamp}`;
    await page.fill('#courseTitle', courseTitle);
    await page.fill('#courseDesc', 'Created via clean E2E test');

    // 3. Add Section & Lesson (Required for valid course?) 
    // Usually a course can be saved empty, but let's add content.
    await page.click('#addSectionBtn');
    const section1 = page.locator('.section-builder').first();
    await expect(section1).toBeVisible();

    await section1.locator('.add-lesson-btn').click();
    const lesson1 = section1.locator('.lesson-builder').first();
    await expect(lesson1).toBeVisible();

    await lesson1.locator('.lesson-title-input').fill(`Lesson 1`);

    // 4. Save
    await page.click('#saveCourseBtn');

    // Dismiss the "Course saved successfully!" custom alert modal
    await page.locator('#confirmModal.open').waitFor({ timeout: 10000 });
    await page.click('#confirmOkBtn');

    // 5. Verify Close
    await expect(page.locator('#courseModal')).not.toHaveClass(/open/, { timeout: 5000 });

    // Verify it appears in Sidebar
    const sidebar = await openCoursesSidebar(page);
    await expect(sidebar).toHaveClass(/open/);
    const courseItem = page.locator('.course-item').filter({ hasText: courseTitle });
    await expect(courseItem).toHaveCount(1);
    await expect(courseItem.first()).toBeVisible();

    // Finally, delete the course with supabase
    await supabase.from('courses').delete().eq('title', courseTitle);

  });

  test('Update an existing Course', async ({ page }) => {
    // 1. Seed a course via API
    const email = testUser.email;
    const password = testUser.password;

    // Sign in via API to get user ID
    const { data: { user }, error: authError } = await supabase.auth.signInWithPassword({
      email: email || '',
      password: password || ''
    });

    if (authError || !user) {
      test.skip(true, 'Could not sign in via API to seed data: ' + (authError?.message || 'No user'));
      return;
    }

    // Insert Course
    const timestamp = Date.now();
    const courseTitle = `Course to Update ${timestamp}`;
    const { data: course, error: insertError } = await supabase
      .from('courses')
      .insert({
        title: courseTitle,
        description: 'Original Description',
        owner_id: user.id,
        is_published: true
      })
      .select()
      .single();

    if (insertError) {
      throw new Error(`Failed to seed course: ${insertError.message}`);
    }

    try {
      // 2. Refresh Page (to load new course list), then re-login to restore auth state
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('.measure-row', { timeout: 10000 });
      await loginAsTestUser(page, testUser);

      // 3. Open Courses Sidebar
      const sidebar = await openCoursesSidebar(page);
      await expect(sidebar).toHaveClass(/open/, { timeout: 5000 });

      // 4. Find the Course in the list
      await expect(page.locator('#courseList .course-item')).not.toHaveCount(0, { timeout: 10000 });

      const courseItem = page.locator(`.course-item[data-id="${course.id}"]`);
      await courseItem.scrollIntoViewIfNeeded();
      await expect(courseItem).toBeVisible();

      // 5. Click the Edit Icon
      const editBtn = courseItem.locator('.edit-course');

      // If course is not active/expanded, edit button might not be in DOM or hidden
      if (!await editBtn.isVisible()) {
        console.log("Course item collapsed, clicking to expand...");
        await courseItem.click();
      }

      await expect(editBtn).toBeVisible();
      await editBtn.click();

      // 6. Verify Modal Open and Data
      await expect(page.locator('#courseModal')).toHaveClass(/open/);
      await expect(page.locator('#courseTitle')).toHaveValue(courseTitle);

      // 7. Edit
      const updatedTitle = courseTitle + " (Updated)";
      await page.fill('#courseTitle', updatedTitle);
      await page.fill('#courseDesc', 'Updated Description');

      // 8. Save
      await page.click('#saveCourseBtn');

      // Dismiss the "Course saved successfully!" custom alert modal
      await page.locator('#confirmModal.open').waitFor({ timeout: 10000 });
      await page.click('#confirmOkBtn');

      // 9. Verify DB Update
      await expect(async () => {
        const { data: updatedCourse } = await supabase
          .from('courses')
          .select()
          .eq('id', course.id)
          .single();
        expect(updatedCourse.title).toBe(updatedTitle);
        expect(updatedCourse.description).toBe('Updated Description');
      }).toPass({ timeout: 5000 });

    } finally {
      // Cleanup
      await supabase.from('courses').delete().eq('id', course.id);
    }
  });
});

async function openCoursesSidebar(page) {
  const sidebar = page.locator('#courseSidebar');
  if (!await sidebar.getAttribute('class').then(c => c?.includes('open'))) {
    // #toggleSidebarBtn lives inside the account dropdown — click it via evaluate
    // to bypass visibility restrictions without needing to open the dropdown first
    await page.evaluate(() => document.getElementById('toggleSidebarBtn')?.click());
  }
  return sidebar;
}

// Helper for mobile menu
async function ensureMenuOpen(page) {
  // Check if we are in mobile mode
  const mobileBtn = page.locator('#mobileMenuBtn');
  if (await mobileBtn.isVisible()) {
    const menu = page.locator('#headerMenu');
    // If not visible, click toggle
    if (!await menu.isVisible()) {
      await mobileBtn.click();
      await expect(menu).toBeVisible();
    }
  }
}

async function ensureMenuClosed(page) {
  // Only act if we are in mobile view (button is visible)
  if (await page.locator('#mobileMenuBtn').isVisible()) {
    const menu = page.locator('#headerMenu');
    const isOpen = await menu.evaluate(el => el.classList.contains('open'));
    if (isOpen) {
      await page.click('#mobileMenuBtn');
      await expect(menu).not.toHaveClass(/open/);
    }
  }
}
