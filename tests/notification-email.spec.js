/**
 * tests/notification-email.spec.js
 *
 * Verifies that the correct HTTP request is sent to the
 * send-notification-email Edge Function when an assignment is published.
 *
 * Strategy: mock the Edge Function URL via page.route() (so the app gets a
 * clean 200 and no real emails are sent), then use page.waitForRequest() to
 * capture the outgoing fetch and inspect its payload.
 *
 * Key gotcha — Promise flattening deadlock:
 *   page.waitForRequest() returns a Promise<Request>. If you return that from
 *   an async function and await the caller, JavaScript auto-unwraps it and
 *   you end up waiting for the request *before* you've triggered the action
 *   that causes it. The fix: wrap the Promise in a plain object so the
 *   auto-unwrapping doesn't happen (see setupEmailCapture).
 *
 * Covered cases:
 *   1. publish triggers email → payload contains student's user ID
 *   2. assign to already-published assignment → email also fired
 */

const { test, expect } = require('@playwright/test');
require('dotenv').config();

const { createTestUser, deleteTestUser, loginAsTestUser, supabaseAdmin } = require('./utils/auth-helper');
const { waitForPageReady } = require('./utils/page-helper');

// ── helpers ───────────────────────────────────────────────────────────────────

async function createStudentUser() {
  const user = await createTestUser(false);
  const { error } = await supabaseAdmin
    .from('profiles')
    .upsert({ user_id: user.user.id, role: 'student', username: user.email.split('@')[0] });
  if (error) throw new Error(`Failed to create student profile: ${error.message}`);
  return user;
}

/**
 * Sets up mock + listener for the send-notification-email Edge Function.
 *
 * Returns { requestPromise } where requestPromise resolves to the Playwright
 * Request object once the fetch is initiated.
 *
 * USAGE:
 *   const { requestPromise } = await setupEmailCapture(page);
 *   // ... trigger the action ...
 *   const request = await requestPromise;
 *   const payload = request.postDataJSON();
 *
 * Do NOT await requestPromise before triggering the action — that deadlocks.
 * The wrapper object prevents JavaScript's async-function Promise-flattening
 * from auto-awaiting it inside setupEmailCapture.
 */
async function setupEmailCapture(page) {
  await page.route('**/functions/v1/send-notification-email', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"mock-email-id"}' })
  );
  return {
    requestPromise: page.waitForRequest(
      req => req.url().includes('send-notification-email') && req.method() === 'POST',
      { timeout: 20_000 }
    ),
  };
}

async function openAssignmentsModal(page) {
  // Wait for admin.js to inject #assignmentsBtn into the dropdown
  await page.locator('#assignmentsBtn').waitFor({ state: 'attached', timeout: 15000 });

  const authBtn    = page.locator('#authBtn');
  const accountBtn = page.locator('#accountBtn');
  if (await authBtn.isVisible()) {
    await authBtn.click();
  } else {
    await accountBtn.click({ force: true });
  }

  await page.locator('#assignmentsBtn').waitFor({ state: 'visible', timeout: 5000 });
  await page.locator('#assignmentsBtn').click();
  await expect(page.locator('#assignmentsModal')).toHaveClass(/open/, { timeout: 5000 });
}

async function createMinimalAssignment(page, title) {
  await page.locator('#asgnNewBtn').click();
  await expect(page.locator('#asgnEditor')).toBeVisible({ timeout: 5000 });
  await page.fill('#asgnTitle', title);
  await page.selectOption('#asgnAddItemType', 'mark_complete');
  await page.locator('#asgnAddItemBtn').click();
  const card = page.locator('.asgn-item-card').last();
  await card.locator('[data-action="item-toggle"]').click();
  await card.locator('[data-field="item-title"]').fill('Do the thing');
}

// ── tests ─────────────────────────────────────────────────────────────────────

test.describe('Notification email', () => {
  let teacherUser, studentUser;

  test.beforeEach(async () => {
    teacherUser = await createTestUser(true);
    studentUser = await createStudentUser();

    // Pre-create teacher profile so current_user_role() works immediately in
    // RLS policies. Without this, the browser's async createDefaultProfile()
    // might not complete before the first DB query that needs the role runs,
    // causing student_assignments SELECTs to return empty (studentIds = []).
    const { error } = await supabaseAdmin
      .from('profiles')
      .upsert({ user_id: teacherUser.user.id, role: 'admin', username: teacherUser.email.split('@')[0] });
    if (error) throw new Error(`Failed to create teacher profile: ${error.message}`);
  });

  test.afterEach(async () => {
    if (teacherUser) await deleteTestUser(teacherUser.user.id);
    if (studentUser) await deleteTestUser(studentUser.user.id);
  });

  test('publishing an assignment sends email with student user IDs', async ({ page }) => {
    test.setTimeout(150_000);
    const ts = Date.now();

    await waitForPageReady(page);
    await loginAsTestUser(page, teacherUser);
    await page.waitForTimeout(1500);
    await openAssignmentsModal(page);

    await createMinimalAssignment(page, `Email Test ${ts}`);
    await page.locator('#asgnSaveBtn').click();
    await expect(page.locator('#asgnSaveStatus')).toContainText('Saved', { timeout: 8000 });

    // Assign the student
    const studentCheckbox = page.locator(`[data-student-id="${studentUser.user.id}"]`);
    await expect(studentCheckbox).toBeVisible({ timeout: 5000 });
    await studentCheckbox.check();
    await page.locator('#asgnAssignBtn').click();
    await expect(page.locator('#asgnAssignBtn')).toContainText('Assigned', { timeout: 5000 });

    // Arm capture BEFORE publish (don't await requestPromise yet — that would deadlock)
    const { requestPromise } = await setupEmailCapture(page);

    await page.locator('#asgnPublished').check();
    await page.locator('#asgnSaveBtn').click();
    await expect(page.locator('#asgnSaveStatus')).toContainText('Saved', { timeout: 8000 });

    // Now await the captured request
    const request = await requestPromise;
    const payload = request.postDataJSON();

    expect(payload.type).toBe('new_assignment');
    expect(payload.title).toBe('New assignment');
    expect(Array.isArray(payload.userIds)).toBe(true);
    expect(payload.userIds).toContain(studentUser.user.id);
    expect(payload.body).toContain(`Email Test ${ts}`);
  });

  test('assigning a student to an already-published assignment sends email', async ({ page }) => {
    test.setTimeout(150_000);
    const ts = Date.now();

    await waitForPageReady(page);
    await loginAsTestUser(page, teacherUser);
    await page.waitForTimeout(1500);
    await openAssignmentsModal(page);

    // Create and publish first (no students yet)
    await createMinimalAssignment(page, `Published First ${ts}`);
    await page.locator('#asgnPublished').check();
    await page.locator('#asgnSaveBtn').click();
    await expect(page.locator('#asgnSaveStatus')).toContainText('Saved', { timeout: 8000 });

    // Arm capture BEFORE assigning (since the assignment is already published,
    // the email fires immediately when the student is added)
    const { requestPromise } = await setupEmailCapture(page);

    const studentCheckbox = page.locator(`[data-student-id="${studentUser.user.id}"]`);
    await expect(studentCheckbox).toBeVisible({ timeout: 5000 });
    await studentCheckbox.check();
    await page.locator('#asgnAssignBtn').click();
    await expect(page.locator('#asgnAssignBtn')).toContainText('Assigned', { timeout: 5000 });

    const request = await requestPromise;
    const payload = request.postDataJSON();

    expect(payload.type).toBe('new_assignment');
    expect(Array.isArray(payload.userIds)).toBe(true);
    expect(payload.userIds).toContain(studentUser.user.id);
  });
});
