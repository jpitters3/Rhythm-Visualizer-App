/**
 * tests/invite-enroll-workflow.spec.js
 *
 * End-to-end: Teacher invites student with a course pre-selected
 *   → invite token accepted via URL
 *   → student auto-enrolled in course
 *   → first lesson's linked assignment auto-assigned
 *   → assignment appears as the hero card on the student's Dashboard
 *
 * What's NOT re-tested here (covered elsewhere):
 *   - Assignment CRUD (assignments.spec.js)
 *   - Course CRUD (course_crud.spec.js)
 *
 * Invite acceptance path tested: the email-link / token URL path
 * (teacher_invitations.token → /?invite=TOKEN → processInviteToken auto-runs).
 * The existing-student in-app notification path produces the same DB outcome
 * via the same accept_teacher_invitation_by_token RPC.
 */

const { test, expect } = require('@playwright/test');
require('dotenv').config();

const { createTestUser, deleteTestUser, loginAsTestUser, supabaseAdmin } = require('./utils/auth-helper');
const { waitForPageReady } = require('./utils/page-helper');

// ── seed / cleanup ────────────────────────────────────────────────────────────

async function seedCourseWithLinkedAssignment(ownerId) {
  const ts = Date.now();

  const { data: course, error: cErr } = await supabaseAdmin
    .from('courses')
    .insert({
      title: `E2E Beginner Course ${ts}`,
      description: 'Auto-seeded for invite-enroll test',
      owner_id: ownerId,
      is_published: true,
    })
    .select()
    .single();
  if (cErr) throw new Error('seed course: ' + cErr.message);

  const { data: section, error: sErr } = await supabaseAdmin
    .from('sections')
    .insert({ course_id: course.id, title: 'Section 1', order_index: 0, is_published: true })
    .select()
    .single();
  if (sErr) throw new Error('seed section: ' + sErr.message);

  const { data: lesson, error: lErr } = await supabaseAdmin
    .from('lessons')
    .insert({
      section_id: section.id,
      title: 'Lesson 1 — Welcome',
      description: '',
      video_url: '',
      order_index: 0,
      pattern_json: {},
    })
    .select()
    .single();
  if (lErr) throw new Error('seed lesson: ' + lErr.message);

  const { data: assignment, error: aErr } = await supabaseAdmin
    .from('assignments')
    .insert({
      title: `E2E First Assignment ${ts}`,
      description: 'Complete the warm-up exercise.',
      course_id: course.id,
      lesson_id: lesson.id,   // explicit lesson link — what we just built
      created_by: ownerId,
      is_published: true,
    })
    .select()
    .single();
  if (aErr) throw new Error('seed assignment: ' + aErr.message);

  return { course, section, lesson, assignment };
}

async function cleanupSeed(seed) {
  if (!seed) return;
  if (seed.assignment) {
    await supabaseAdmin.from('assignments').delete().eq('id', seed.assignment.id);
  }
  if (seed.course) {
    // lessons + sections cascade-deleted with course in most setups;
    // delete explicitly to be safe.
    if (seed.lesson) await supabaseAdmin.from('lessons').delete().eq('id', seed.lesson.id);
    if (seed.section) await supabaseAdmin.from('sections').delete().eq('id', seed.section.id);
    await supabaseAdmin.from('courses').delete().eq('id', seed.course.id);
  }
}

// ── test ─────────────────────────────────────────────────────────────────────

test.describe('Invite → Enroll → Dashboard Workflow', () => {
  let teacherUser, studentUser, seed;

  test.beforeEach(async () => {
    teacherUser = await createTestUser(true);  // admin — Students panel + course creation
    studentUser = await createTestUser(false); // will become the student

    // Ensure student profile exists with role = 'student'
    const { error: pErr } = await supabaseAdmin
      .from('profiles')
      .upsert({
        user_id: studentUser.user.id,
        role: 'student',
        username: studentUser.email.split('@')[0],
      });
    if (pErr) console.warn('[invite-enroll] profile upsert warning:', pErr.message);

    // Seed course → section → lesson → assignment (lesson_id linked)
    seed = await seedCourseWithLinkedAssignment(teacherUser.user.id);
  });

  test.afterEach(async () => {
    // Clean up student_assignments and user_courses created by the test
    if (studentUser && seed?.assignment) {
      await supabaseAdmin
        .from('student_assignments')
        .delete()
        .eq('student_id', studentUser.user.id)
        .eq('assignment_id', seed.assignment.id);
    }
    if (studentUser && seed?.course) {
      await supabaseAdmin
        .from('user_courses')
        .delete()
        .eq('user_id', studentUser.user.id)
        .eq('course_id', seed.course.id);
    }
    if (teacherUser && studentUser) {
      await supabaseAdmin
        .from('teacher_students')
        .delete()
        .eq('teacher_id', teacherUser.user.id)
        .eq('student_id', studentUser.user.id);
      await supabaseAdmin
        .from('teacher_invitations')
        .delete()
        .eq('teacher_id', teacherUser.user.id);
    }
    await cleanupSeed(seed);
    if (teacherUser) await deleteTestUser(teacherUser.user.id);
    if (studentUser) await deleteTestUser(studentUser.user.id);
  });

  test('invite with course pre-selected → auto-enroll + auto-assign → hero on dashboard', async ({ browser }) => {
    test.setTimeout(120_000);

    const teacherCtx = await browser.newContext();
    const studentCtx = await browser.newContext();
    const tPage = await teacherCtx.newPage();
    const sPage = await studentCtx.newPage();

    tPage.on('console', msg => { if (msg.type() !== 'log') console.log(`[TEACHER] ${msg.text()}`); });
    sPage.on('console', msg => { if (msg.type() !== 'log') console.log(`[STUDENT] ${msg.text()}`); });

    try {
      // ════════════════════════════════════════════════════════════════════
      // PHASE 1 — Teacher: send invite with course pre-selected
      // ════════════════════════════════════════════════════════════════════
      await waitForPageReady(tPage);
      await loginAsTestUser(tPage, teacherUser);
      await tPage.waitForTimeout(1500); // let profile + role load so Students button appears

      // Open account dropdown → click Students
      const accountBtn = tPage.locator('#accountBtn');
      if (await accountBtn.isVisible()) await accountBtn.click();
      await tPage.locator('#studentMgmtBtn').click();
      await expect(tPage.locator('#studentMgmtSidebar')).toHaveClass(/open/, { timeout: 5000 });

      // Open invite form
      await tPage.locator('#stmgmtInviteToggle').click();
      const inviteForm = tPage.locator('#stmgmtInviteForm');
      await expect(inviteForm).not.toHaveAttribute('hidden', { timeout: 3000 });

      // Fill email
      await tPage.fill('#stmgmtInviteEmail', studentUser.email);

      // Wait for course checkboxes to load (triggered when form opens)
      const courseRow = tPage.locator('.stmgmt-invite-course-row', { hasText: seed.course.title });
      await expect(courseRow).toBeVisible({ timeout: 8000 });

      // Check the seeded course
      await courseRow.locator('.stmgmt-invite-course-checkbox').check();

      // Send
      await tPage.locator('#stmgmtInviteSend').click();
      // Student already has an account → in-app notification path
      await expect(tPage.locator('#stmgmtInviteStatus')).toContainText('Invitation sent', { timeout: 10000 });

      // ════════════════════════════════════════════════════════════════════
      // PHASE 2 — Read invite token from DB (simulates clicking the email link)
      //           Using supabaseAdmin bypasses the need to intercept email.
      // ════════════════════════════════════════════════════════════════════
      const { data: invitation, error: tokenErr } = await supabaseAdmin
        .from('teacher_invitations')
        .select('token, course_ids')
        .eq('teacher_id', teacherUser.user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      expect(tokenErr).toBeNull();
      expect(invitation.token).toBeTruthy();
      // Confirm course_ids was stored correctly
      expect(invitation.course_ids).toContain(seed.course.id);

      // Relative so it resolves against playwright.config.js's baseURL
      // (this dev server is HTTPS-only when .certs/ is present — a hardcoded
      // http://localhost:3000 gets a connection-level ERR_EMPTY_RESPONSE).
      const inviteUrl = `/?invite=${invitation.token}`;

      // ════════════════════════════════════════════════════════════════════
      // PHASE 3 — Student: log in, then navigate to the invite URL
      //           processInviteToken() fires on load, reads ?invite=TOKEN,
      //           calls accept_teacher_invitation_by_token RPC, then strips
      //           the param from the URL via history.replaceState.
      // ════════════════════════════════════════════════════════════════════
      await waitForPageReady(sPage);
      await loginAsTestUser(sPage, studentUser);
      await sPage.waitForTimeout(500);

      // Navigate to invite URL — student is already authenticated in this context
      await sPage.goto(inviteUrl, { waitUntil: 'networkidle' });

      // Wait for processInviteToken to strip the ?invite= param (confirms RPC was called)
      await sPage.waitForFunction(
        () => !new URLSearchParams(window.location.search).has('invite'),
        { timeout: 10000 }
      );

      // Brief pause to let the RPC response settle (network round-trip)
      await sPage.waitForTimeout(1500);

      // ════════════════════════════════════════════════════════════════════
      // PHASE 4 — Verify DB: teacher↔student linked, enrolled, assigned
      // ════════════════════════════════════════════════════════════════════
      const { data: teacherLink } = await supabaseAdmin
        .from('teacher_students')
        .select('student_id')
        .eq('teacher_id', teacherUser.user.id)
        .eq('student_id', studentUser.user.id)
        .maybeSingle();
      expect(teacherLink, 'teacher_students row should exist after invite acceptance').not.toBeNull();

      const { data: enrollment } = await supabaseAdmin
        .from('user_courses')
        .select('user_id')
        .eq('user_id', studentUser.user.id)
        .eq('course_id', seed.course.id)
        .maybeSingle();
      expect(enrollment, 'student should be auto-enrolled in the pre-selected course').not.toBeNull();

      const { data: autoAssignment } = await supabaseAdmin
        .from('student_assignments')
        .select('id, status')
        .eq('student_id', studentUser.user.id)
        .eq('assignment_id', seed.assignment.id)
        .maybeSingle();
      expect(autoAssignment, 'first lesson assignment should be auto-assigned').not.toBeNull();
      expect(autoAssignment.status).toBe('pending');

      // ════════════════════════════════════════════════════════════════════
      // PHASE 5 — Student: Dashboard shows assignment in hero, course in sidebar
      // ════════════════════════════════════════════════════════════════════
      // Hero card shows the assignment. A reload right after the invite RPC
      // can outrace loadDashboard()'s own fetch seeing the just-created row —
      // reload and retry a few times instead of trusting a single fixed wait.
      const heroCard = sPage.locator('#dashAssignmentCard');
      await expect(async () => {
        await sPage.goto('/#dashboard', { waitUntil: 'networkidle' });
        await expect(heroCard).toBeVisible({ timeout: 3000 });
        await expect(heroCard).toContainText(seed.assignment.title, { timeout: 3000 });
      }).toPass({ timeout: 20000, intervals: [1000, 2000, 3000] });
      await expect(heroCard).toContainText('New'); // status = 'assigned'

      // Active courses section lists the enrolled course
      const coursesSection = sPage.locator('#dashCoursesContent');
      await expect(coursesSection).toContainText(seed.course.title, { timeout: 5000 });

    } finally {
      await teacherCtx.close();
      await studentCtx.close();
    }
  });
});
