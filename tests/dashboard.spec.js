// @ts-check
// The signed-in student's Dashboard (js/dashboard.js): greeting, active
// courses, practice plan, and the editable goals.
const { test, expect } = require('@playwright/test');
const { createTestUser, deleteTestUser, loginAsTestUser } = require('./utils/auth-helper');
const { seedCourse, enroll, deleteCourse } = require('./utils/seed-helper');
const { navigateTo } = require('./helpers');

test.describe('Dashboard', () => {
  let student, owner, course;

  test.beforeEach(async ({ page }) => {
    test.setTimeout(90000);
    student = await createTestUser();
    owner = await createTestUser();
    ({ course } = await seedCourse(owner.user.id, { title: `Dashboard Course ${Date.now()}` }));
    await enroll(student.user.id, course.id);
    await loginAsTestUser(page, student);
    // Signing in lands on the Dashboard; navigate anyway so the test also
    // exercises the Dashboard nav link.
    await navigateTo(page, 'dashboard');
    await expect(page.locator('#view-dashboard')).toBeVisible();
  });

  test.afterEach(async () => {
    if (course) await deleteCourse(course.id);
    if (student) await deleteTestUser(student.user.id);
    if (owner) await deleteTestUser(owner.user.id);
  });

  test('shows the student\'s greeting, active course, and empty practice plan; a course opens in the Courses panel', { tag: '@core' }, async ({ page }) => {
    await expect(page.locator('#dashGreetName')).toHaveText(student.email.split('@')[0]);

    const courseRow = page.locator(`#dashCoursesContent .dash-list-item[data-id="${course.id}"]`);
    await expect(courseRow).toContainText(course.title);
    await expect(page.locator('#dashPracticeContent')).toContainText('Your practice plan is empty.');
    await expect(page.locator('#dashGoalsContent .dash-goal-card')).toHaveCount(2);

    await courseRow.click();
    await expect(page.locator('#courseSidebar')).toHaveClass(/open/);
    await expect(page.locator(`#courseSidebar .course-item[data-id="${course.id}"]`)).toBeVisible();
  });

  test('editing goals saves them and they persist across a reload', { tag: '@core' }, async ({ page }) => {
    const dream = `Play a full set ${Date.now()}`;
    const focus = 'Clean 16th-note rolls';

    await page.locator('#dashDreamGoalCard').click();
    const modal = page.locator('#dashGoalsModal');
    await expect(modal).toBeVisible();
    await page.fill('#dashDreamGoalInput', dream);
    await page.fill('#dashShortGoalInput', focus);
    await page.click('#dashGoalsSaveBtn');
    await expect(modal).toBeHidden();

    await expect(page.locator('#dashDreamGoalCard')).toContainText(dream);
    await expect(page.locator('#dashShortGoalCard')).toContainText(focus);

    await page.reload({ waitUntil: 'networkidle' });
    // Reloads briefly route to Home until the session restores, then back.
    await expect(page.locator('#view-dashboard')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#dashDreamGoalCard')).toContainText(dream);
    await expect(page.locator('#dashShortGoalCard')).toContainText(focus);
  });
});
