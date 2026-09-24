const { test, expect } = require('@playwright/test');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { createTestUser, deleteTestUser, loginAsTestUser } = require('./utils/auth-helper');

const admin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Regression cover for the lesson player panel actually showing its content
// (description / video / pattern preview) when a lesson is opened. Previously
// untested — see project_test_coverage memo item "Courses lesson player".
for (const asAdmin of [false, true]) {
  test(`lesson player shows description + video + pattern (${asAdmin ? 'admin' : 'student'})`, async ({ page }) => {
    test.setTimeout(120000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    const u = await createTestUser(asAdmin);
    const ts = Date.now();
    const { data: course } = await admin.from('courses').insert({
      title: `LessonPlayerTest ${ts}`, description: 'c', owner_id: u.user.id, is_published: true,
    }).select().single();
    const { data: section } = await admin.from('sections').insert({
      course_id: course.id, title: 'S1', order_index: 0, is_published: true,
    }).select().single();
    const { data: lesson } = await admin.from('lessons').insert({
      section_id: section.id, title: 'Lesson One', order_index: 0,
      description: 'THIS IS THE LESSON DESCRIPTION TEXT',
      video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      pattern_name: 'demo',
      pattern_json: { labels: ['1', '', '2', '', '3', '', '4', ''], hands: [], beats: 4, subdivision: 2, measures: 1 },
    }).select().single();
    await admin.from('user_courses').insert({ user_id: u.user.id, course_id: course.id });

    try {
      await loginAsTestUser(page, u);
      await page.waitForTimeout(1500);
      await page.evaluate(() => { window.location.hash = '#studio'; });
      await page.waitForSelector('.measure-row:visible', { timeout: 20000 }).catch(() => {});

      await page.evaluate(() => document.getElementById('toggleSidebarBtn')?.click());
      await page.waitForSelector('#courseSidebar.open', { timeout: 10000 });
      await page.locator(`.course-item[data-id="${course.id}"]`).click();
      const lessonLink = page.locator(`.lesson-link[data-id="${lesson.id}"]`);
      await lessonLink.scrollIntoViewIfNeeded();
      await lessonLink.click();

      await expect(page.locator('#lessonContent')).toBeVisible();
      // pattern preview canvas is created near the end of loadLesson()
      await expect(page.locator('#lessonPatternPreview')).toBeVisible({ timeout: 15000 });
      await expect(page.locator('#videoContainer iframe')).toHaveCount(1);

      // description: admins get an editable textarea, students a rendered div
      const desc = await page.evaluate(() => {
        const edit = document.getElementById('editLessonDescription');
        const view = document.getElementById('lessonDescription');
        const editShown = edit && getComputedStyle(edit).display !== 'none';
        const viewShown = view && getComputedStyle(view).display !== 'none';
        return { shownText: editShown ? edit.value : viewShown ? view.textContent : '' };
      });
      expect(desc.shownText).toContain('THIS IS THE LESSON DESCRIPTION TEXT');
      expect(errors, 'no page errors while loading the lesson').toEqual([]);
    } finally {
      await admin.from('lessons').delete().eq('id', lesson.id);
      await admin.from('sections').delete().eq('id', section.id);
      await admin.from('courses').delete().eq('id', course.id);
      await deleteTestUser(u.user.id);
    }
  });
}
