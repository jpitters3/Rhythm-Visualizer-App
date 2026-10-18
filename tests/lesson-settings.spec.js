const { test, expect } = require('@playwright/test');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { createTestUser, deleteTestUser, loginAsTestUser } = require('./utils/auth-helper');

const admin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Per-student lesson settings (js/lesson-settings.js): a student's own
// BPM/phrase override for a course lesson, layered on top of the shared
// lessons.pattern_json without ever mutating it. Covers the save-prompt
// (replacing the old binary "Discard unsaved changes?"), the override
// persisting across visits, and the Reset ⇄ Restore one-level undo.
test.describe('Lesson Settings (Reset/Restore)', () => {
  let u, course, section, lesson, lesson2;

  test.beforeEach(async ({ page }) => {
    test.setTimeout(90000);
    u = await createTestUser(false);
    const ts = Date.now();
    const { data: c } = await admin.from('courses').insert({
      title: `LessonSettingsTest ${ts}`, description: 'c', owner_id: u.user.id, is_published: true,
    }).select().single();
    course = c;
    const { data: s } = await admin.from('sections').insert({
      course_id: course.id, title: 'S1', order_index: 0, is_published: true,
    }).select().single();
    section = s;
    const { data: l1 } = await admin.from('lessons').insert({
      section_id: section.id, title: 'Lesson One', order_index: 0,
      pattern_name: 'demo',
      pattern_json: { labels: ['1', '', '2', '', '3', '', '4', ''], hands: [], flams: [], beats: 4, subdivision: 2, measures: 1, bpm: 90 },
    }).select().single();
    lesson = l1;
    // Created upfront alongside lesson1 — course sidebar fetches+caches its
    // lessons once on open, so a lesson inserted afterward would never show.
    const { data: l2 } = await admin.from('lessons').insert({
      section_id: section.id, title: 'Lesson Two', order_index: 1,
    }).select().single();
    lesson2 = l2;
    await admin.from('user_courses').insert({ user_id: u.user.id, course_id: course.id });

    await loginAsTestUser(page, u);
    await page.waitForTimeout(1500);
    await page.evaluate(() => { window.location.hash = '#studio'; });
    await page.waitForSelector('.measure-row:visible', { timeout: 20000 }).catch(() => {});
    await page.evaluate(() => document.querySelectorAll('.tour-overlay').forEach(el => el.remove()));

    // No course click needed — with only one course, courses.js
    // auto-activates *and* auto-expands it as soon as the sidebar loads, so
    // its lesson links are already visible. Clicking the course header here
    // would actually *collapse* it (toggle-course flips collapsed state for
    // an already-active course); clicking .course-item's wider area risks
    // landing on a .lesson-link instead and loading a lesson early.
    await page.evaluate(() => document.getElementById('toggleSidebarBtn')?.click());
    await expect(page.locator('#courseSidebar.open')).toBeVisible({ timeout: 10000 });
    // Close it again — opening it above was only to force courses.js to
    // load/auto-expand the course and its lesson links, not because tests
    // need it to stay open. On a narrow mobile viewport it overlays the
    // full width, intercepting every click on #measures otherwise.
    await page.evaluate(() => document.getElementById('toggleSidebarBtn')?.click());
    await expect(page.locator('#courseSidebar')).not.toHaveClass(/open/);
  });

  test.afterEach(async () => {
    await admin.from('student_lesson_settings').delete().eq('user_id', u.user.id);
    await admin.from('patterns').delete().eq('user_id', u.user.id);
    await admin.from('lessons').delete().eq('section_id', section.id);
    await admin.from('sections').delete().eq('id', section.id);
    await admin.from('courses').delete().eq('id', course.id);
    await deleteTestUser(u.user.id);
  });

  async function openLesson(page, l) {
    // Self-contained open/close around the click — #courseSidebar starts
    // (and ends, see beforeEach/this function) closed, and on a narrow
    // mobile viewport it overlays the full width, intercepting every click
    // on #measures if left open afterward. Idempotent either way: a
    // preceding explicit openSidebar() call just makes the open here a
    // no-op, not a double-toggle.
    const sidebar = page.locator('#courseSidebar');
    if (!(await sidebar.evaluate(el => el.classList.contains('open')))) {
      await page.evaluate(() => document.getElementById('toggleSidebarBtn')?.click());
      await expect(sidebar).toHaveClass(/open/);
    }

    const link = page.locator(`.lesson-link[data-id="${l.id}"]`);
    await link.scrollIntoViewIfNeeded();
    await link.click();
    await expect(page.locator('#lessonContent')).toBeVisible();

    if (await sidebar.evaluate(el => el.classList.contains('open'))) {
      await page.evaluate(() => document.getElementById('toggleSidebarBtn')?.click());
      await expect(sidebar).not.toHaveClass(/open/);
    }

    // #lessonPlayer (js/courses.js's openLessonSidebar()) opens automatically
    // on every lesson click, and at 360px fixed width (css/courses.css)
    // covers nearly all of a narrow mobile viewport, intercepting clicks on
    // #measures behind it. Its own close button (#closeLessonBtn) also nulls
    // out currentLesson (js/courses.js's closeLessonSidebar), which would
    // break the lesson-scoped save guard these tests rely on — Escape
    // instead just collapses the panel via Sidepanel.closeTopmost(), with no
    // side effects beyond that.
    const lessonPlayer = page.locator('#lessonPlayer');
    if (await lessonPlayer.evaluate(el => el.classList.contains('open'))) {
      await page.keyboard.press('Escape');
      await expect(lessonPlayer).not.toHaveClass(/open/);
    }
  }

  async function openSidebar(page) {
    await page.evaluate(() => document.getElementById('toggleSidebarBtn')?.click());
    await expect(page.locator('#courseSidebar.open')).toBeVisible();
  }

  // Opens account dropdown + phrase submenu, for the non-lesson Studio flows
  // (mirrors saving_loading.spec.js's own helper).
  async function openPhraseMenu(page) {
    const accountDropdown = page.locator('#accountDropdownMenu');
    if (!await accountDropdown.evaluate(el => el.classList.contains('show'))) {
      await page.click('#accountBtn');
      await expect(accountDropdown).toHaveClass(/show/, { timeout: 3000 });
    }
    const phraseSubmenu = page.locator('#phraseSubmenu');
    if (!await phraseSubmenu.evaluate(el => el.classList.contains('open'))) {
      await page.click('#phraseMenuBtn');
      await expect(phraseSubmenu).toHaveClass(/open/, { timeout: 3000 });
    }
  }

  test('BPM-only change: save prompt, override persists, Reset/Restore round-trip', async ({ page, isMobile }) => {
    await openLesson(page, lesson);

    const bpmInput = page.locator('#mainTransport-A .t-bpm-num');
    await bpmInput.fill('128');
    await bpmInput.press('Tab');

    // Lesson 1's own pattern has subdivision 2 (eighth notes). On mobile,
    // applyPattern() (js/pattern-crud.js) collapses that to quarter notes
    // for display, doubling the BPM the transport bar shows/accepts — so
    // typing '128' there sets a *display-domain* BPM, and the value that
    // gets diffed/saved/compared against the lesson's stored (un-doubled)
    // 90 is 128 halved back down: 64. Desktop never collapses, so there
    // typing 128 round-trips as literally 128 everywhere.
    const savedBpm = isMobile ? '64' : '128';
    // Reset re-loads the lesson's raw pattern_json fresh — on mobile that
    // re-triggers the same doubling (90 → 180 on screen), even though the
    // underlying stored default is still 90.
    const resetDisplayBpm = isMobile ? '180' : '90';

    // Navigating to another lesson while unsaved should show the new
    // save-prompt, not the old plain "Discard unsaved changes?" — with a
    // diff line for the BPM change.
    await openSidebar(page);
    await openLesson(page, lesson2);
    await expect(page.locator('#lessonSaveChangesModal')).toHaveClass(/open/);
    await expect(page.locator('#lessonSaveDiffList')).toContainText('90');
    await expect(page.locator('#lessonSaveDiffList')).toContainText(savedBpm);

    // BPM-only save has no name prompt — it goes straight through.
    await page.click('#lessonSaveConfirmBtn');
    await expect(page.locator('#lessonSaveChangesModal')).not.toHaveClass(/open/);
    await expect(page.locator('#activeLessonTitle')).toContainText('Lesson Two');

    // Revisiting lesson 1: the override applies automatically, and the
    // Reset control appears. applyLessonOverride() converts the saved
    // (un-doubled) custom_bpm back to the doubled display domain, so the
    // transport bar shows the original '128' the student typed either way.
    await openSidebar(page);
    await openLesson(page, lesson);
    await expect(bpmInput).toHaveValue('128');
    await expect(page.locator('#lessonResetBtn')).toBeVisible();
    await expect(page.locator('#lessonSettingsControl')).toContainText('90');
    await expect(page.locator('#lessonSettingsControl')).toContainText(savedBpm);

    // Reset restores the lesson's real default and offers Restore.
    await page.click('#lessonResetBtn');
    await expect(bpmInput).toHaveValue(resetDisplayBpm);
    await expect(page.locator('#lessonRestoreBtn')).toBeVisible();

    // Restore brings the custom BPM straight back.
    await page.click('#lessonRestoreBtn');
    await expect(bpmInput).toHaveValue('128');
  });

  test('Phrase edit: saves to the student\'s own library under the chosen name, Reset/Restore round-trip', async ({ page }) => {
    await openLesson(page, lesson);

    const cell1 = page.locator('#measures .cell').nth(1);
    await cell1.click();
    await page.keyboard.press('2');
    await expect(cell1.locator('.inner')).toHaveText('2');

    await openSidebar(page);
    await openLesson(page, lesson2);
    await expect(page.locator('#lessonSaveChangesModal')).toHaveClass(/open/);
    await expect(page.locator('#lessonSaveDiffList')).toContainText('edited');

    await page.click('#lessonSaveConfirmBtn');

    // Phrase edits prompt for a name (prefilled with the lesson title).
    const nameModal = page.locator('#confirmModal');
    await expect(nameModal).toHaveClass(/open/);
    await expect(page.locator('#confirmInput')).toHaveValue('Lesson One');
    await page.fill('#confirmInput', 'My Faster Version');
    await page.click('#confirmOkBtn');
    await expect(nameModal).not.toHaveClass(/open/);
    await expect(page.locator('#activeLessonTitle')).toContainText('Lesson Two');

    // Saved to the student's own patterns library — the same quota a manual
    // save counts against — never to the shared lessons row.
    const { data: saved } = await admin.from('patterns').select('name').eq('user_id', u.user.id);
    expect(saved?.map(p => p.name)).toContain('My Faster Version');
    const { data: sharedLesson } = await admin.from('lessons').select('pattern_json').eq('id', lesson.id).single();
    expect(sharedLesson.pattern_json.labels[1]).toBe(''); // admin's shared copy is untouched

    // Revisiting lesson 1: the custom phrase loads, and the Reset strip
    // shows the real saved name, not a generic "edited".
    await openSidebar(page);
    await openLesson(page, lesson);
    await expect(cell1.locator('.inner')).toHaveText('2');
    await expect(page.locator('#lessonSettingsControl')).toContainText('saved as "My Faster Version"');

    // Reset clears back to the lesson's original (empty) cell.
    await page.click('#lessonResetBtn');
    await expect(cell1.locator('.inner')).toBeEmpty();
    await expect(page.locator('#lessonRestoreBtn')).toBeVisible();

    // Restore brings the custom phrase straight back.
    await page.click('#lessonRestoreBtn');
    await expect(cell1.locator('.inner')).toHaveText('2');
  });

  test('Non-lesson Studio use keeps the plain binary discard confirm', async ({ page }) => {
    // beforeEach never loads a lesson — no lesson context is active here,
    // so this exercises the general (non-lesson) Studio path.
    const cell0 = page.locator('#measures .cell').nth(0);
    await cell0.click();
    await page.keyboard.press('1');
    await expect(cell0.locator('.inner')).toHaveText('1');

    await openPhraseMenu(page);
    await page.click('#newPhraseBtn');

    await expect(page.locator('#lessonSaveChangesModal')).not.toHaveClass(/open/);
    const discardModal = page.locator('#confirmModal');
    await expect(discardModal).toHaveClass(/open/);
    await expect(page.locator('#confirmMessage')).toContainText('unsaved changes');

    await page.click('#confirmCancelBtn');
    await expect(discardModal).not.toHaveClass(/open/);
  });
});
