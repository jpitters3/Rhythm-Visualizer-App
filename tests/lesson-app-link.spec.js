// @ts-check
// A lesson can link to a Handpan Game or Panafide page (lessons.app_link,
// js/app-links.js); the lesson player shows it as a button.
const { test, expect } = require('./fixtures');
const { createTestUser, deleteTestUser, loginAsTestUser } = require('./utils/auth-helper');
const { seedCourse, enroll, deleteCourse } = require('./utils/seed-helper');
const { supabaseAdmin } = require('./utils/auth-helper');

test.describe('Lesson app links', () => {
  test('link rules: only Panafide destinations, with readable button labels', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'pure logic; one project is enough');
    await page.goto('/');
    const result = await page.evaluate(async () => {
      const { cleanCustomLink, appLinkLabel, isPickedLink } = await import('/js/app-links.js');
      return {
        hash: cleanCustomLink(' #library '),
        path: cleanCustomLink('/?course=fall-into-flow-2026'),
        prod: cleanCustomLink('https://panafide.com/?course=x#studio'),
        other: cleanCustomLink('https://example.com/'),
        script: cleanCustomLink('javascript:alert(1)'),
        protocolRelative: cleanCustomLink('//evil.example/'),
        game: appLinkLabel('game:rhythm-ear'),
        pageLabel: appLinkLabel('page:library'),
        custom: appLinkLabel('#library'),
        unknownGame: appLinkLabel('game:nope'),
        picked: isPickedLink('game:rhythm-ear'),
      };
    });
    expect(result).toEqual({
      hash: '#library',
      path: '/?course=fall-into-flow-2026',
      prod: 'https://panafide.com/?course=x#studio',
      other: null,
      script: null,
      protocolRelative: null,
      game: '👂 Play Rhythm by Ear',
      pageLabel: '📚 Open Library',
      custom: '🔗 Open in Panafide',
      unknownGame: '',
      picked: true,
    });
  });

  test.describe('in the lesson player', () => {
    let student, owner, course, lessons;

    test.beforeEach(async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'chromium', 'one desktop project is enough');
      student = await createTestUser();
      owner = await createTestUser();
      ({ course, lessons } = await seedCourse(owner.user.id, {
        title: `LessonPlayerTest ${Date.now()}`,
        sections: [['Rhythm by Ear lesson']],
      }));
      const { error } = await supabaseAdmin.from('lessons').update({ app_link: 'game:rhythm-ear' }).eq('id', lessons[0].id);
      if (error) throw new Error(`lessons.app_link missing? Apply the migration first: ${error.message}`);
      await enroll(student.user.id, course.id);
      await loginAsTestUser(page, student);
    });

    test.afterEach(async () => {
      if (course) await deleteCourse(course.id);
      if (student) await deleteTestUser(student.user.id);
      if (owner) await deleteTestUser(owner.user.id);
      course = student = owner = undefined;
    });

    test('the lesson button opens Rhythm by Ear', async ({ page }) => {
      await page.evaluate(() => { location.hash = '#studio'; });
      await page.evaluate(() => document.getElementById('toggleSidebarBtn')?.click());
      await page.waitForSelector('#courseSidebar.open');
      await page.locator(`.course-item[data-id="${course.id}"]`).click();
      await page.locator(`.lesson-link[data-id="${lessons[0].id}"]`).click();

      const button = page.locator('#lessonAppLinkBtn');
      await expect(button).toBeVisible({ timeout: 15000 });
      await expect(button).toHaveText('👂 Play Rhythm by Ear');
      await button.click();

      await expect(page.locator('#view-games')).toHaveClass(/active/);
      await expect(page.locator('#view-games .re-container')).toBeVisible({ timeout: 10000 });
    });
  });
});
