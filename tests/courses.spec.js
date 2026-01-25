// @ts-check
const { test, expect } = require('@playwright/test');

test.use({ viewport: { width: 1280, height: 720 } });

test.describe('Course Creator', () => {

  test.beforeEach(async ({ page }) => {
    // Debug: Forward logs
    page.on('console', msg => console.log(`[Browser]: ${msg.text()}`));

    // Inject Mock BEFORE page load to override window.supabase1
    await page.addInitScript(() => {
      // Mock DB Data INITIAL
      window.dbListPatternNames = async () => ['Funky Drum', 'Cool Beat', 'Jazz Swing'];
      window.getSavedPatterns = () => ({});

      // Mock Supabase Query Builder
      const mockQueryBuilder = {
        select: () => mockQueryBuilder,
        order: () => mockQueryBuilder,
        eq: () => mockQueryBuilder, // Chainable
        in: () => mockQueryBuilder, // Chainable
        limit: () => mockQueryBuilder, // Added missing limit
        single: () => Promise.resolve({ data: { id: 'new-id-123' }, error: null }),
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        insert: (data) => {
          // If it's an array, map it. If it's a single object, wrap it? 
          // Actually, Supabase insert takes object or array of objects.
          const isArray = Array.isArray(data);
          const insertedData = isArray
            ? data.map(d => ({ ...d, id: 'new-' + Date.now() }))
            : [{ id: 'new-id-' + Date.now(), ...data }]; // Always store internally as array for simulation

          const builder = {
            then: (onFulfill, onReject) => Promise.resolve({ data: null, error: null }).then(onFulfill, onReject), // Standard insert doesn't return data unless selected
            select: () => ({
              single: () => Promise.resolve({ data: insertedData[0], error: null }), // Return ONE object
              then: (onFulfill, onReject) => Promise.resolve({ data: insertedData, error: null }).then(onFulfill, onReject) // Return ALL
            })
          };
          return builder;
        },
        update: (data) => ({
          eq: (k, v) => Promise.resolve({ data, error: null })
        }),
        delete: () => ({
          eq: () => Promise.resolve({ error: null }),
          in: () => Promise.resolve({ error: null })
        }),
        upsert: () => Promise.resolve({ error: null }),
        then: (resolve) => Promise.resolve({ data: [], error: null }).then(resolve) // Default resolve
      };

      // Complete Mock Client
      window.supabase1 = {
        auth: {
          getUser: () => Promise.resolve({ data: { user: { id: 'test-user-123', email: 'jpitters3@gmail.com' } }, error: null }),
          onAuthStateChange: (cb) => {
            // Trigger "signed in" immediately
            setTimeout(() => cb('SIGNED_IN', { user: { id: 'test-user-123', email: 'jpitters3@gmail.com' } }), 10);
            return { data: { subscription: { unsubscribe: () => { } } } };
          },
          signOut: () => Promise.resolve({ error: null }),
          updateUser: () => Promise.resolve({ data: {}, error: null })
        },
        from: (table) => {
          if (table === 'sections') {
            return {
              ...mockQueryBuilder,
              select: () => ({
                eq: () => Promise.resolve({ data: [{ id: 'old-sec-1' }], error: null })
              }),
              delete: () => ({
                in: () => Promise.resolve({ error: null })
              })
            };
          }
          if (table === 'lessons') {
            return {
              ...mockQueryBuilder,
              delete: () => ({
                in: () => Promise.resolve({ error: null })
              })
            }
          }
          return mockQueryBuilder;
        }
      };

      // Global mocks
      window.fetchCourses = async () => { console.log("Mock fetchCourses called"); };
    });

    // Navigate to home AFTER mocks are set
    await page.goto('/');


    // Re-apply function mocks that might have been overwritten by script loading
    await page.evaluate(() => {
      window.dbListPatternNames = async () => ['Funky Drum', 'Cool Beat', 'Jazz Swing'];
      window.getSavedPatterns = () => ({});
      console.log("Re-applied function mocks after load");
    });

    // Helper to ensure auth settles
    await ensureMenuClosed(page);
    await page.waitForTimeout(500);
  });

  // Helper for mobile menu
  async function ensureMenuClosed(page) {
    if (await page.locator('#mobileMenuBtn').isVisible()) {
      const menu = page.locator('#headerMenu');
      const isOpen = await menu.evaluate(el => el.classList.contains('open'));
      if (isOpen) {
        await page.click('#mobileMenuBtn');
        await expect(menu).not.toHaveClass(/open/);
      }
    }
  }

  test('Create a new course with multiple sections and lessons', async ({ page }) => {
    // 1. Open Course Creator
    // Open Account Dropdown first
    await page.click('#accountBtn');
    await expect(page.locator('#accountDropdownMenu')).toHaveClass(/show/);

    await page.click('#openCourseModalBtn');
    await expect(page.locator('#courseModal')).toHaveClass(/open/);

    // 2. Fill Course Info
    await page.fill('#courseTitle', 'My Epic Course');
    await page.fill('#courseDesc', 'A test course created by Playwright');

    // 3. Verify Default Section 1 exists and is expanded
    const section1 = page.locator('.section-builder').nth(0);
    await expect(section1).toBeVisible();
    await expect(section1.locator('.lessons-container')).toHaveClass(/active/);

    // 4. Add a Lesson to Section 1
    await section1.locator('.add-lesson-btn').click();

    // 5. Verify Lesson 1 appears and fill details
    const lesson1 = section1.locator('.lesson-builder').nth(0);
    await expect(lesson1).toBeVisible();

    // Expand lesson if not already
    if (!await lesson1.locator('.lesson-content').isVisible()) {
      await lesson1.locator('.toggle-btn').click();
    }

    await lesson1.locator('.lesson-title-input').fill('Intro to Rhythm');
    await lesson1.locator('textarea').fill('Basics of timing.');

    // Select a pattern
    const patternSelect = lesson1.locator('.pattern-select');
    await patternSelect.selectOption('Funky Drum');

    // 6. Add a Second Section
    await page.click('#addSectionBtn');
    const section2 = page.locator('.section-builder').nth(1);
    await expect(section2).toBeVisible();

    // 7. Add Lesson to Section 2
    await section2.locator('.add-lesson-btn').click();
    const lesson2 = section2.locator('.lesson-builder').nth(0);
    await expect(lesson2).toBeVisible();
    await lesson2.locator('.lesson-title-input').fill('Advanced Polyrythms');

    // 8. Save Course
    page.once('dialog', dialog => {
      expect(dialog.message()).toContain('saved successfully');
      dialog.accept();
    });

    await page.click('#saveCourseBtn');

    // 9. Verify Modal Closes
    await expect(page.locator('#courseModal')).not.toHaveClass(/open/);
  });

  test('Update an existing course', async ({ page }) => {
    // 1. Mock existing course data loading
    const mockCourse = {
      id: 'existing-123',
      title: 'Old Title',
      description: 'Old Desc',
      sections: [
        {
          id: 'old-sec-1',
          title: 'Old Section',
          lessons: [
            { title: 'Old Lesson', description: '', video_url: '', pattern_name: 'Cool Beat', pattern_json: {} }
          ]
        }
      ]
    };

    // Inject function to trigger edit mode directly
    await page.evaluate((course) => {
      window.loadCourseToEdit(course);
    }, mockCourse);

    await expect(page.locator('#courseModal')).toHaveClass(/open/);
    await expect(page.locator('#saveCourseBtn')).toHaveText('Update Course');
    await expect(page.locator('#courseTitle')).toHaveValue('Old Title');

    // 2. Modify Title
    await page.fill('#courseTitle', 'Updated Title');

    // 3. Expand Section
    const section = page.locator('.section-builder').nth(0);
    // Might be collapsed by default
    if (!await section.locator('.lessons-container').isVisible()) {
      await section.locator('.toggle-btn').click();
    }

    const lesson = section.locator('.lesson-builder').nth(0);
    await lesson.locator('.toggle-btn').click(); // Expand lesson
    await lesson.locator('.lesson-title-input').fill('Updated Lesson Title');

    // 4. Save Updates
    page.once('dialog', dialog => {
      expect(dialog.message()).toContain('saved successfully');
      dialog.accept();
    });

    await page.click('#saveCourseBtn');
    await expect(page.locator('#courseModal')).not.toHaveClass(/open/);
  });

});
