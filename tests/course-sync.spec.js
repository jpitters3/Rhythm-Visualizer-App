// @ts-check
const { test, expect } = require('./fixtures');
const { checkPublish, compareCourses, courseSlug, isTestCourse, moveStorageUrl, planCopy } =
  require('../supabase/functions/course-sync/plan.ts');

const STAGING = 'https://staging.supabase.co';
const PROD = 'https://prod.supabase.co';
const summary = (id, title, lessons = 1, is_published = true) =>
  ({ id, title, is_published, sections: [{ lessons: Array.from({ length: lessons }, (_, i) => ({ id: `${id}-l${i}` })) }] });

test.describe('course-sync rules', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'pure logic; one project is enough');
  });

  test('slugs are the hyphenated title, and match the app’s', async ({ page }) => {
    const titles = ['🍂 Fall Into Flow 2026 🍂', 'Rhythm & Flow • April 2026', 'Course 1: Basics', 'Café Grooves'];
    expect(titles.map(courseSlug)).toEqual(['fall-into-flow-2026', 'rhythm-flow-april-2026', 'course-1-basics', 'cafe-grooves']);

    await page.goto('/');
    const appSlugs = await page.evaluate(async (list) => {
      const { courseSlug: appSlug } = await import('/js/course-links.js');
      return list.map(appSlug);
    }, titles);
    expect(appSlugs).toEqual(titles.map(courseSlug));
  });

  test('spots leftover test courses by their timestamp', () => {
    expect(isTestCourse('LessonPlayerTest 1792295594509')).toBe(true);
    expect(isTestCourse('Test Marketplace Course 1794853254409-3bc5f261')).toBe(true);
    expect(isTestCourse('🍂 Fall Into Flow 2026 🍂')).toBe(false);
    expect(isTestCourse('Rhythm & Flow • April 2026')).toBe(false);
  });

  test('lists each course once, saying where it lives', () => {
    const rows = compareCourses(
      [summary('a', 'Alpha', 2), summary('b', 'Beta', 3), summary('t', 'E2E Beginner Course 1795632262080')],
      [summary('a', 'Alpha', 4), summary('p', 'Prod Only')],
    );
    expect(rows.map(r => [r.id, r.where, r.isTest])).toEqual([
      ['a', 'both', false], ['b', 'staging', false], ['t', 'staging', true], ['p', 'production', false],
    ]);
    expect(rows[0].staging.lessons).toBe(2);
    expect(rows[0].production.lessons).toBe(4);
  });

  test('only new courses can be published', () => {
    const prod = [summary('a', 'Alpha')];
    expect(() => checkPublish({ id: 'a', owner_id: 'u', title: 'Alpha' }, prod)).toThrow(/already on production/);
    expect(() => checkPublish({ id: 'n', owner_id: 'u', title: 'ALPHA!' }, prod)).toThrow(/already has a course called/);
    expect(() => checkPublish({ id: 'n', owner_id: 'u', title: 'LessonPlayerTest 1792295594509' }, prod)).toThrow(/test course/);
    expect(() => checkPublish({ id: 'n', owner_id: 'u', title: 'Brand New' }, prod)).not.toThrow();
  });

  test('moves storage URLs to the other project and lists the files to copy', () => {
    const url = `${STAGING}/storage/v1/object/public/course-thumbnails/u1/pic%201.png`;
    expect(moveStorageUrl(url, STAGING, PROD)).toEqual({
      url: `${PROD}/storage/v1/object/public/course-thumbnails/u1/pic%201.png`,
      object: { bucket: 'course-thumbnails', path: 'u1/pic 1.png' },
    });
    expect(moveStorageUrl('https://youtu.be/abc', STAGING, PROD)).toEqual({ url: 'https://youtu.be/abc', object: null });
    expect(moveStorageUrl(null, STAGING, PROD)).toEqual({ url: null, object: null });
  });

  test('copies keep ids, remap the owner and drop links the target can’t resolve', () => {
    const course = {
      id: 'c1', owner_id: 'staging-user', title: 'New Course', is_published: true,
      progression_id: 'prog-1', preview_lesson_id: 'l2',
      thumbnail_url: `${STAGING}/storage/v1/object/public/course-thumbnails/u/t.png`,
      sections: [{
        id: 's1', course_id: 'c1', title: 'One', order_index: 0,
        lessons: [
          { id: 'l1', section_id: 's1', title: 'A', order_index: 0, video_url: 'https://youtu.be/x' },
          { id: 'l2', section_id: 's1', title: 'B', order_index: 1, video_url: `${STAGING}/storage/v1/object/public/lesson-videos/u/v.mp4` },
        ],
      }],
    };
    const plan = planCopy(course, { fromBase: STAGING, toBase: PROD, ownerId: 'prod-user', progressionExists: false });

    expect(plan.course).toMatchObject({
      id: 'c1', owner_id: 'prod-user', progression_id: null, preview_lesson_id: null,
      thumbnail_url: `${PROD}/storage/v1/object/public/course-thumbnails/u/t.png`,
    });
    expect(plan.course).not.toHaveProperty('sections');
    expect(plan.previewLessonId).toBe('l2');
    expect(plan.sections).toEqual([{ id: 's1', course_id: 'c1', title: 'One', order_index: 0 }]);
    expect(plan.lessons.map(l => [l.id, l.video_url])).toEqual([
      ['l1', 'https://youtu.be/x'],
      ['l2', `${PROD}/storage/v1/object/public/lesson-videos/u/v.mp4`],
    ]);
    expect(plan.objects).toEqual(expect.arrayContaining([
      { bucket: 'course-thumbnails', path: 'u/t.png' },
      { bucket: 'lesson-videos', path: 'u/v.mp4' },
    ]));
    expect(plan.objects).toHaveLength(2);

    const linked = planCopy(course, { fromBase: STAGING, toBase: PROD, ownerId: 'prod-user', progressionExists: true });
    expect(linked.course.progression_id).toBe('prog-1');
  });
});
