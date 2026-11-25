// @ts-check
// Manage courses page (#manage-courses) and direct course links (?course=<slug>).
// Runs against staging, where the course-sync function is deployed.
const { test, expect } = require('./fixtures');
const { createTestUser, deleteTestUser, loginAsTestUser, supabaseAdmin } = require('./utils/auth-helper');

test.describe('Manage courses', () => {
  let admin;
  let course;

  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'admin tool; desktop Chromium is enough');
    admin = await createTestUser(true);
    const title = `MC Test Course ${Date.now()}`;
    const { data, error } = await supabaseAdmin.from('courses')
      .insert({ title, description: 'Manage courses test', owner_id: admin.user.id, is_published: false })
      .select().single();
    if (error) throw error;
    course = data;
    await supabaseAdmin.from('sections').insert({ course_id: course.id, title: 'Section 1', order_index: 0 });
    await loginAsTestUser(page, admin);
  });

  test.afterEach(async () => {
    if (course) {
      const { data: sections } = await supabaseAdmin.from('sections').select('id').eq('course_id', course.id);
      const ids = (sections || []).map(s => s.id);
      if (ids.length) await supabaseAdmin.from('sections').delete().in('id', ids);
      await supabaseAdmin.from('courses').delete().eq('id', course.id);
    }
    if (admin) await deleteTestUser(admin.user.id);
  });

  test('lists staging courses and deletes one from staging', async ({ page }) => {
    await page.evaluate(() => { location.hash = '#manage-courses'; });
    const view = page.locator('#view-manage-courses');
    await expect(view).toHaveClass(/active/);

    await view.locator('.mc-search').fill(course.title);
    const row = view.locator('.mc-row', { hasText: course.title });
    await expect(row).toBeVisible({ timeout: 20000 });
    await expect(row).toContainText('Staging only');
    await expect(row).toContainText('Test');
    await expect(row.getByRole('button', { name: 'Publish to production' })).toBeVisible();

    await row.getByRole('button', { name: 'Delete' }).click();
    await page.locator('#confirmModal.open').waitFor();
    await page.click('#confirmOkBtn');

    await expect(view.locator('.mc-status')).toContainText('Deleted', { timeout: 20000 });
    await expect(row).toHaveCount(0);
    const { data } = await supabaseAdmin.from('courses').select('id').eq('id', course.id);
    expect(data).toHaveLength(0);
  });

  test('Copy sections tab shows the copier', async ({ page }) => {
    await page.evaluate(() => { location.hash = '#manage-courses'; });
    await page.getByRole('tab', { name: 'Copy sections' }).click();
    await expect(page.locator('#copierSelectLeft')).toBeVisible();
    await expect(page.locator(`#copierSelectLeft option[value="${course.id}"]`)).toHaveCount(1, { timeout: 15000 });
  });

  test('an edit link opens the course in the Course Creator', async ({ page }) => {
    const slug = course.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    await page.goto(`/?course=${slug}&edit=1#studio`);
    await expect(page.locator('#view-course-creator')).toHaveClass(/active/, { timeout: 20000 });
    await expect(page.locator('#courseTitle')).toHaveValue(course.title);
    expect(new URL(page.url()).searchParams.get('course')).toBeNull();
  });
});
