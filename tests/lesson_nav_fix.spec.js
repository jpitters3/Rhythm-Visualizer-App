const { test, expect } = require('@playwright/test');

test.describe('Lesson Navigation Filtering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:8000');
    // We need to wait for the app to initialize enough so globals exist
    await page.waitForFunction(() => typeof window.allCourses !== 'undefined');
  });

  test('Next Lesson button should be hidden if the next lesson is in a draft section', async ({ page }) => {
    await page.evaluate(() => {
      // Mock data
      const currentUser = { id: 'user1' };
      window.currentUser = currentUser;

      // Mock isAdminUser to return false (regular user)
      window.isAdminUser = () => false;

      const mockCourse = {
        id: 'course1',
        title: 'Test Course',
        owner_id: 'other_user', // Not the owner
        is_published: true,
        sections: [
          {
            id: 'sec1',
            title: 'Section 1',
            order_index: 1,
            is_published: true,
            lessons: [
              { id: 'lesson1', title: 'Lesson 1', section_id: 'sec1', order_index: 1, pattern_json: {} }
            ]
          },
          {
            id: 'sec2',
            title: 'Section 2 (Draft)',
            order_index: 2,
            is_published: false, // DRAFT
            lessons: [
              { id: 'lesson2', title: 'Lesson 2', section_id: 'sec2', order_index: 1, pattern_json: {} }
            ]
          }
        ]
      };

      window.allCourses = [mockCourse];
      // Re-calculate allLessons and allSections if needed, but loadLesson flattens them itself
      window.allLessons = mockCourse.sections.flatMap(s => s.lessons);
      window.allSections = mockCourse.sections.map(s => ({ ...s, courseTitle: mockCourse.title }));

      // Load lesson 1
      window.loadLesson('lesson1');
    });

    const nextBtn = page.locator('#nextLessonBtn');
    // It should be hidden because the next lesson is in a draft section
    await expect(nextBtn).not.toBeVisible();
  });

  test('Next Lesson button should be visible if user is admin even if next section is draft', async ({ page }) => {
    await page.evaluate(() => {
      // Mock data
      const currentUser = { id: 'user1' };
      window.currentUser = currentUser;

      // Mock isAdminUser to return true
      window.isAdminUser = () => true;

      const mockCourse = {
        id: 'course1',
        title: 'Test Course',
        owner_id: 'other_user',
        is_published: true,
        sections: [
          {
            id: 'sec1',
            title: 'Section 1',
            order_index: 1,
            is_published: true,
            lessons: [
              { id: 'lesson1', title: 'Lesson 1', section_id: 'sec1', order_index: 1, pattern_json: {} }
            ]
          },
          {
            id: 'sec2',
            title: 'Section 2 (Draft)',
            order_index: 2,
            is_published: false, // DRAFT
            lessons: [
              { id: 'lesson2', title: 'Lesson 2', section_id: 'sec2', order_index: 1, pattern_json: {} }
            ]
          }
        ]
      };

      window.allCourses = [mockCourse];
      window.allLessons = mockCourse.sections.flatMap(s => s.lessons);
      window.allSections = mockCourse.sections.map(s => ({ ...s, courseTitle: mockCourse.title }));

      // Load lesson 1
      window.loadLesson('lesson1');
    });

    const nextBtn = page.locator('#nextLessonBtn');
    // Admin should see it
    await expect(nextBtn).toBeVisible();
  });
});
