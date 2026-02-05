// @ts-check
const { test, expect } = require('@playwright/test');
const { createClient } = require('@supabase/supabase-js');

// Supabase Setup for Data Seeding
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || "";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const { createTestUser, deleteTestUser } = require('./utils/auth-helper');

test.describe('Course CRUD (Clean)', () => {
  let testUser;

  test.beforeEach(async ({ page }) => {
    // 0. Create unique test user
    testUser = await createTestUser();

    // 1. Navigate
    await page.goto('/');

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

      await page.fill('#authEmail', email);

      // Ensure we are on login tab if needed (default is usually register if fresh? or login?)
      // Actually, if we just created the user via admin API, we need to Log In.
      // The modal defaults to "Sign In" usually.

      await page.fill('#authPass', password);
      await page.click('#authLogin');

      // Wait for success
      await expect(page.locator('#authHint')).toContainText('Signed in!');
      await expect(page.locator('#authModal')).not.toHaveClass(/open/);

      // Verify login button changed state
      await expect(page.locator('text=Sign In / Register')).not.toBeVisible();
    }
  });

  test.afterEach(async () => {
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
    // Mock the confirm dialog if it appears? (None for save, only delete)
    // Actually handleCourseSave calls alert("Course saved successfully!") on success.
    // We need to handle that dialog.
    page.once('dialog', async dialog => {
      console.log(`Dialog message: ${dialog.message()}`);
      await dialog.accept();
    });

    await page.click('#saveCourseBtn');

    // 5. Verify Close
    // The alert accept should proceed to closeCourseCreator
    await expect(page.locator('#courseModal')).not.toHaveClass(/open/);

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
        is_published: false
      })
      .select()
      .single();

    if (insertError) {
      throw new Error(`Failed to seed course: ${insertError.message}`);
    }

    try {
      // 2. Refresh Page (to load new course list)
      await page.reload();
      await ensureMenuOpen(page); // Ensure menu state is clean

      // 3. Open Courses Sidebar
      const sidebar = await openCoursesSidebar(page);
      await expect(sidebar).toHaveClass(/open/);

      // 4. Find the Course in the list
      // Wait for list to load
      await expect(page.locator('#courseList .course-item')).not.toHaveCount(0);

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
      let dialogHandled = false;
      page.once('dialog', async dialog => {
        console.log(`Dialog message: ${dialog.message()}`);
        await dialog.accept();
        dialogHandled = true;
      });

      await page.click('#saveCourseBtn');

      // Wait for dialog logic to possibly fire?
      await page.waitForTimeout(1000);

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
  // If not open, click button
  if (!await sidebar.getAttribute('class').then(c => c?.includes('open'))) {
    const toggleBtn = page.locator('#toggleSidebarBtn');
    if (await toggleBtn.isVisible()) {
      await toggleBtn.click();
    } else {
      // If button not visible (locked in dropdown), open dropdown/menu
      const accountBtn = page.locator('#accountBtn');
      if (await accountBtn.isVisible()) {
        await accountBtn.click();

        // await page.pause();

        await toggleBtn.click({ force: true });
      } else {
        await ensureMenuOpen(page); // Ensures #authBtn is visible, but we need #toggleSidebarBtn
        // On mobile, toggleSidebarBtn is in #accountDropdownMenu (inside #headerMenu)
        // If #headerMenu is open (ensureMenuOpen ensures that), is .account-dropdown open?
        // No, .account-dropdown content is "static" on mobile?
        // Let's check layout.css.
        // Mobile: .account-dropdown .dropdown-content { display: flex !important; position: static; }
        // So if menu is open, the buttons should be visible.
        const toggleBtnMobile = page.locator('#toggleSidebarBtn');
        // Mobile menu might need scrolling or ensuring it's interactable
        await toggleBtnMobile.click();
      }
    }
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
