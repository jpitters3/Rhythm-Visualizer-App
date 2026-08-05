/**
 * tests/assignments.spec.js
 *
 * Full assignment workflow:
 *   Teacher creates → assigns → publishes
 *   Student submits
 *   Teacher sends back with feedback
 *   Student resubmits
 *   Teacher marks complete
 *
 * Items used: mark_complete, quiz (1 question / 2 options), link
 * (audio/video covered separately in assignments-media.spec.js)
 */

const { test, expect } = require('@playwright/test');
require('dotenv').config();

const { createTestUser, deleteTestUser, loginAsTestUser, supabaseAdmin } = require('./utils/auth-helper');
const { waitForPageReady } = require('./utils/page-helper');

// ── helpers ──────────────────────────────────────────────────────────────────

async function createStudentUser() {
  const user = await createTestUser(false);
  const { error } = await supabaseAdmin
    .from('profiles')
    .upsert({ user_id: user.user.id, role: 'student', username: user.email.split('@')[0] });
  if (error) throw new Error(`Failed to create student profile: ${error.message}`);
  return user;
}

async function openAccountDropdown(page) {
  const authBtn   = page.locator('#authBtn');
  const accountBtn = page.locator('#accountBtn');
  if (await authBtn.isVisible()) {
    await authBtn.click();
  } else {
    await accountBtn.click({ force: true });
  }
}

// ── test ─────────────────────────────────────────────────────────────────────

test.describe('Assignment Workflow', () => {
  let teacherUser, studentUser;

  test.beforeEach(async () => {
    teacherUser = await createTestUser(true);   // admin — gets Assignments button
    studentUser = await createStudentUser();
  });

  test.afterEach(async () => {
    if (teacherUser) await deleteTestUser(teacherUser.user.id);
    if (studentUser) await deleteTestUser(studentUser.user.id);
  });

  test('create → assign → publish → submit → send back → resubmit → complete', async ({ browser }) => {
    test.setTimeout(180_000); // full two-user workflow needs more than the 30s default
    const ts = Date.now();
    const assignmentTitle = `E2E Assignment ${ts}`;
    const linkUrl = 'https://example.com/submission';
    const feedbackText = 'Good start — please review the quiz answer and resubmit.';

    // ── two independent browser contexts ─────────────────────────────────────
    const teacherCtx = await browser.newContext();
    const studentCtx = await browser.newContext();
    const tPage = await teacherCtx.newPage();
    const sPage = await studentCtx.newPage();

    tPage.on('console', msg => console.log(`[TEACHER] ${msg.text()}`));
    sPage.on('console', msg => console.log(`[STUDENT] ${msg.text()}`));

    try {
      // ══════════════════════════════════════════════════════════════════════
      // PHASE 1 — Teacher: create assignment
      // ══════════════════════════════════════════════════════════════════════
      await waitForPageReady(tPage);
      await loginAsTestUser(tPage, teacherUser);
      await tPage.waitForTimeout(1500); // let prefetchAssignmentsData fire

      // Open Assignments modal
      await openAccountDropdown(tPage);
      await tPage.locator('#assignmentsBtn').click();
      await expect(tPage.locator('#assignmentsModal')).toHaveClass(/open/, { timeout: 5000 });

      // New assignment
      await tPage.locator('#asgnNewBtn').click();
      await expect(tPage.locator('#asgnEditor')).toBeVisible({ timeout: 5000 });
      await tPage.fill('#asgnTitle', assignmentTitle);

      // ── Item 1: Mark Complete ─────────────────────────────────────────────
      await tPage.selectOption('#asgnAddItemType', 'mark_complete');
      await tPage.locator('#asgnAddItemBtn').click();
      const markCard = tPage.locator('.asgn-item-card').last();
      await markCard.locator('[data-action="item-toggle"]').click(); // expand
      await markCard.locator('[data-field="item-title"]').fill('Complete the warm-up exercise');
      await markCard.locator('[data-field="item-required"]').check();

      // ── Item 2: Quiz ──────────────────────────────────────────────────────
      await tPage.selectOption('#asgnAddItemType', 'quiz');
      await tPage.locator('#asgnAddItemBtn').click();
      const quizCard = tPage.locator('.asgn-item-card').last();
      await quizCard.locator('[data-action="item-toggle"]').click();
      await quizCard.locator('[data-field="item-title"]').fill('Quick check');
      await quizCard.locator('[data-field="item-required"]').check();

      // Add question
      await quizCard.locator('[data-action="quiz-add-question"]').click();
      const questionInput = quizCard.locator('[data-field="quiz-question-text"]').first();
      await expect(questionInput).toBeVisible({ timeout: 3000 });
      await questionInput.fill('How many notes in a pentatonic scale?');

      // Add option A
      await quizCard.locator('[data-action="quiz-add-option"]').first().click();
      const optionAText = quizCard.locator('[data-field="quiz-option-text"]').nth(0);
      await expect(optionAText).toBeVisible({ timeout: 3000 });
      await optionAText.fill('5');

      // Add option B
      await quizCard.locator('[data-action="quiz-add-option"]').first().click();
      const optionBText = quizCard.locator('[data-field="quiz-option-text"]').nth(1);
      await expect(optionBText).toBeVisible({ timeout: 3000 });
      await optionBText.fill('7');

      // Mark option A as correct
      await quizCard.locator('[data-field="quiz-option-correct"]').first().check();

      // ── Item 3: Link ──────────────────────────────────────────────────────
      await tPage.selectOption('#asgnAddItemType', 'link');
      await tPage.locator('#asgnAddItemBtn').click();
      const linkCard = tPage.locator('.asgn-item-card').last();
      await linkCard.locator('[data-action="item-toggle"]').click();
      await linkCard.locator('[data-field="item-title"]').fill('Share a reference link');
      await linkCard.locator('[data-field="item-required"]').check();

      // ── Save ──────────────────────────────────────────────────────────────
      await tPage.locator('#asgnSaveBtn').click();
      await expect(tPage.locator('#asgnSaveStatus')).toContainText('Saved', { timeout: 8000 });

      // ── Assign student ────────────────────────────────────────────────────
      const studentCheckbox = tPage.locator(`[data-student-id="${studentUser.user.id}"]`);
      await expect(studentCheckbox).toBeVisible({ timeout: 5000 });
      await studentCheckbox.check();
      await tPage.locator('#asgnAssignBtn').click();
      await expect(tPage.locator('#asgnAssignBtn')).toContainText('Assigned', { timeout: 5000 });

      // ── Publish ───────────────────────────────────────────────────────────
      await tPage.locator('#asgnPublished').check();
      await tPage.locator('#asgnSaveBtn').click();
      await expect(tPage.locator('#asgnSaveStatus')).toContainText('Saved', { timeout: 8000 });

      // ══════════════════════════════════════════════════════════════════════
      // PHASE 2 — Student: open inbox and submit
      // ══════════════════════════════════════════════════════════════════════
      await waitForPageReady(sPage);
      await loginAsTestUser(sPage, studentUser);
      await sPage.waitForTimeout(1500);

      // Open My Assignments
      await openAccountDropdown(sPage);
      await sPage.locator('#myAssignmentsBtn').click();
      await expect(sPage.locator('#studentAssignmentsModal')).toHaveClass(/open/, { timeout: 5000 });

      // Assignment should appear in list
      const assignmentItem = sPage.locator('.student-inbox-item', { hasText: assignmentTitle });
      await expect(assignmentItem).toBeVisible({ timeout: 8000 });
      await assignmentItem.click();

      // Detail view should open
      await expect(sPage.locator('#studentInboxDetailTitle')).toContainText(assignmentTitle, { timeout: 5000 });

      // ── Complete mark_complete item ───────────────────────────────────────
      const markCompleteCheckbox = sPage.locator('[data-field="mark_complete"]').first();
      await expect(markCompleteCheckbox).toBeVisible({ timeout: 5000 });
      await markCompleteCheckbox.check();

      // ── Answer quiz ───────────────────────────────────────────────────────
      // Select first option (the correct one: "5")
      const quizRadio = sPage.locator('[data-field="quiz-answer"]').first();
      await expect(quizRadio).toBeVisible({ timeout: 5000 });
      await quizRadio.check();

      // ── Fill link ─────────────────────────────────────────────────────────
      const linkInput = sPage.locator('[data-field="link-url"]').first();
      await expect(linkInput).toBeVisible({ timeout: 5000 });
      await linkInput.fill(linkUrl);

      // ── Submit ────────────────────────────────────────────────────────────
      await sPage.locator('#studentInboxSubmitBtn').click();

      // Confirm dialog
      await sPage.locator('#confirmModal.open').waitFor({ timeout: 5000 });
      await sPage.locator('#confirmOkBtn').click();

      // Status shows submitted
      await expect(sPage.locator('#studentInboxSaveStatus')).toContainText('Submitted', { timeout: 8000 });

      // ══════════════════════════════════════════════════════════════════════
      // PHASE 3 — Teacher: review and send back
      // ══════════════════════════════════════════════════════════════════════
      // Switch to Submissions tab
      await tPage.locator('.asgn-tab-btn[data-tab="submissions"]').click();
      await tPage.waitForTimeout(1000); // let loadSubmissionsList run

      const submissionRow = tPage.locator('.asgn-submission-row', { hasText: assignmentTitle });
      await expect(submissionRow).toBeVisible({ timeout: 10000 });
      await submissionRow.click();

      // Review panel opens
      await expect(tPage.locator('#asgnReviewPanel')).toBeVisible({ timeout: 5000 });
      await expect(tPage.locator('#asgnReviewBody')).not.toContainText('No submission data found', { timeout: 5000 });

      // Add feedback and send back
      await tPage.fill('#asgnFeedback', feedbackText);
      await tPage.locator('#asgnSendBackBtn').click();
      await expect(tPage.locator('#asgnReviewStatus')).toContainText('Sent back', { timeout: 5000 });

      // ══════════════════════════════════════════════════════════════════════
      // PHASE 4 — Student: sees feedback, resubmits
      // ══════════════════════════════════════════════════════════════════════
      // Reload student's assignments list to pick up status change
      await sPage.locator('#studentInboxBackBtn').click();
      await sPage.waitForTimeout(500);

      // Reload inbox to reflect sent_back status
      await sPage.locator('#closeStudentAssignmentsModal').click();
      await sPage.waitForTimeout(500);
      await openAccountDropdown(sPage);
      await sPage.locator('#myAssignmentsBtn').click();
      await expect(sPage.locator('#studentAssignmentsModal')).toHaveClass(/open/);

      const sentBackItem = sPage.locator('.student-inbox-item', { hasText: assignmentTitle });
      await expect(sentBackItem).toBeVisible({ timeout: 8000 });
      // Should show "Sent back" status pill
      await expect(sentBackItem.locator('.student-inbox-status-pill')).toContainText('Sent back');
      await sentBackItem.click();

      // Feedback should be visible
      await expect(sPage.locator('#studentInboxFeedbackSection')).toBeVisible({ timeout: 5000 });
      await expect(sPage.locator('#studentInboxFeedbackText')).toContainText(feedbackText);

      // Re-complete and resubmit
      await sPage.locator('[data-field="mark_complete"]').first().check();
      await sPage.locator('[data-field="quiz-answer"]').first().check();
      await sPage.locator('[data-field="link-url"]').first().fill(linkUrl);

      await sPage.locator('#studentInboxSubmitBtn').click();
      await sPage.locator('#confirmModal.open').waitFor({ timeout: 5000 });
      await sPage.locator('#confirmOkBtn').click();
      await expect(sPage.locator('#studentInboxSaveStatus')).toContainText('Submitted', { timeout: 8000 });

      // ══════════════════════════════════════════════════════════════════════
      // PHASE 5 — Teacher: mark complete
      // ══════════════════════════════════════════════════════════════════════
      // Reload submissions tab
      await tPage.locator('.asgn-tab-btn[data-tab="submissions"]').click();
      await tPage.waitForTimeout(1000);

      const resubmissionRow = tPage.locator('.asgn-submission-row', { hasText: assignmentTitle });
      await expect(resubmissionRow).toBeVisible({ timeout: 10000 });
      await resubmissionRow.click();

      await expect(tPage.locator('#asgnReviewPanel')).toBeVisible({ timeout: 5000 });
      await tPage.locator('#asgnMarkCompleteBtn').click();

      // Review panel closes after marking complete
      await expect(tPage.locator('#asgnReviewPanel')).not.toBeVisible({ timeout: 5000 });

    } finally {
      await teacherCtx.close();
      await studentCtx.close();
    }
  });

  test('assigning a phrase item copies it into the student\'s own Library', async ({ browser }) => {
    test.setTimeout(60_000);
    const ts = Date.now();
    const assignmentTitle = `E2E Phrase Assignment ${ts}`;
    const phraseName = `E2E Test Phrase ${ts}`;

    // Seed a phrase in the teacher's own Library so it's pickable in the item's dropdown.
    const { error: patternErr } = await supabaseAdmin.from('patterns').insert({
      user_id: teacherUser.user.id,
      name: phraseName,
      data: { on: [true, false, true, false], bpm: 90, mode: '8', steps: 4, labels: ['1', '2', '3', '4'], measures: 1, handSplit: false },
    });
    if (patternErr) throw new Error(`Failed to seed teacher phrase: ${patternErr.message}`);

    const teacherCtx = await browser.newContext();
    const tPage = await teacherCtx.newPage();
    tPage.on('console', msg => console.log(`[TEACHER] ${msg.text()}`));

    try {
      await waitForPageReady(tPage);
      await loginAsTestUser(tPage, teacherUser);
      await tPage.waitForTimeout(1500); // let prefetchAssignmentsData fire

      await openAccountDropdown(tPage);
      await tPage.locator('#assignmentsBtn').click();
      await expect(tPage.locator('#assignmentsModal')).toHaveClass(/open/, { timeout: 5000 });

      await tPage.locator('#asgnNewBtn').click();
      await expect(tPage.locator('#asgnEditor')).toBeVisible({ timeout: 5000 });
      await tPage.fill('#asgnTitle', assignmentTitle);

      // ── Item: Phrase ────────────────────────────────────────────────────
      await tPage.selectOption('#asgnAddItemType', 'phrase');
      await tPage.locator('#asgnAddItemBtn').click();
      const phraseCard = tPage.locator('.asgn-item-card').last();
      await phraseCard.locator('[data-action="item-toggle"]').click(); // expand
      await phraseCard.locator('[data-field="phrase-select"]').selectOption(phraseName);

      // ── Save ────────────────────────────────────────────────────────────
      await tPage.locator('#asgnSaveBtn').click();
      await expect(tPage.locator('#asgnSaveStatus')).toContainText('Saved', { timeout: 8000 });

      // ── Assign student ──────────────────────────────────────────────────
      const studentCheckbox = tPage.locator(`[data-student-id="${studentUser.user.id}"]`);
      await expect(studentCheckbox).toBeVisible({ timeout: 5000 });
      await studentCheckbox.check();
      await tPage.locator('#asgnAssignBtn').click();
      await expect(tPage.locator('#asgnAssignBtn')).toContainText('Assigned', { timeout: 5000 });

      // ── Verify: the phrase now exists in the student's own Library ─────────
      // copy_pattern_to_student runs as part of handleAssign — give it a moment.
      await expect(async () => {
        const { data, error } = await supabaseAdmin
          .from('patterns')
          .select('id, user_id, name, source, data')
          .eq('user_id', studentUser.user.id)
          .eq('name', phraseName);
        if (error) throw error;
        expect(data).toHaveLength(1);
        expect(data[0].source).toBe('assignment');
      }).toPass({ timeout: 8000 });

    } finally {
      await teacherCtx.close();
      await supabaseAdmin.from('patterns').delete().eq('name', phraseName);
    }
  });
});
