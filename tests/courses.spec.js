// @ts-check
// Student-side course use: browsing an enrolled course in the Courses panel,
// searching its lessons, and moving through lessons with Next/Previous.
// Admin course editing is covered separately in course_crud.spec.js.
const { test, expect } = require('@playwright/test');
const { createTestUser, deleteTestUser, loginAsTestUser } = require('./utils/auth-helper');
const { seedCourse, enroll, deleteCourse } = require('./utils/seed-helper');
const { openNavPanel } = require('./helpers');

test.describe('Courses (student)', () => {
  let student, owner, course, lessons;

  test.beforeEach(async ({ page }) => {
    test.setTimeout(90000);
    student = await createTestUser();
    owner = await createTestUser();
    ({ course, lessons } = await seedCourse(owner.user.id, {
      title: `Rhythm Basics ${Date.now()}`,
      sections: [['Intro to Rhythm', 'Second Groove'], ['Advanced Flow']],
    }));
    await enroll(student.user.id, course.id);
    await loginAsTestUser(page, student);
  });

  test.afterEach(async () => {
    if (course) await deleteCourse(course.id);
    if (student) await deleteTestUser(student.user.id);
    if (owner) await deleteTestUser(owner.user.id);
  });

  test('enrolled course lists its lessons, search filters them, and Next/Previous move between them', { tag: '@core' }, async ({ page }) => {
    await openNavPanel(page, '#toggleSidebarBtn', '#courseSidebar');

    const courseItem = page.locator(`.course-item[data-id="${course.id}"]`);
    await expect(courseItem).toBeVisible();
    await expect(courseItem).toContainText(course.title);

    // A lone enrolled course auto-expands once the course list loads — clicking
    // its header would collapse it again, so just wait for the lessons.
    const links = lessons.map(l => page.locator(`.lesson-link[data-id="${l.id}"]`));
    for (const link of links) await expect(link).toBeVisible();

    await page.fill('#courseSearchInput', 'groove');
    await expect(links[1]).toBeVisible();
    await expect(links[0]).toBeHidden();
    await expect(links[2]).toBeHidden();
    await page.fill('#courseSearchInput', '');
    await expect(links[0]).toBeVisible();

    await links[0].click();
    const title = page.locator('#activeLessonTitle');
    await expect(title).toContainText('Intro to Rhythm');
    await expect(page.locator('#lessonDescription')).toContainText('Description for Intro to Rhythm');
    await expect(page.locator('#prevLessonBtn')).toBeHidden();

    // Next crosses from section 1 into section 2.
    await page.click('#nextLessonBtn');
    await expect(title).toContainText('Second Groove');
    await page.click('#nextLessonBtn');
    await expect(title).toContainText('Advanced Flow');
    await expect(page.locator('#nextLessonBtn')).toBeHidden();

    await page.click('#prevLessonBtn');
    await expect(title).toContainText('Second Groove');
  });

  test('marking a lesson complete persists across a reload', { tag: '@core' }, async ({ page }) => {
    await openNavPanel(page, '#toggleSidebarBtn', '#courseSidebar');
    const link = page.locator(`.lesson-link[data-id="${lessons[0].id}"]`);
    await expect(link).toBeVisible();
    await link.click();

    const completeBtn = page.locator('#lessonCompleteBtn');
    await expect(completeBtn).toHaveText('Mark as Complete');
    await completeBtn.click();
    await expect(completeBtn).toHaveText('✅ Completed');

    // Signed-in reloads land on the Dashboard; wait for it so the nav click
    // below can't race the reload.
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('#view-dashboard')).toBeVisible();
    await openNavPanel(page, '#toggleSidebarBtn', '#courseSidebar');
    const linkAgain = page.locator(`.lesson-link[data-id="${lessons[0].id}"]`);
    await expect(linkAgain).toBeVisible();
    await linkAgain.click();
    await expect(completeBtn).toHaveText('✅ Completed');
  });
});
