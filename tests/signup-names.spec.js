// @ts-check
const { test, expect } = require('@playwright/test');
const { deleteTestUser, supabaseAdmin } = require('./utils/auth-helper');
const { gotoStudio } = require('./helpers');

// Sign-up has no session until the email is confirmed, so names must travel
// in user metadata and reach profiles on first login (they used to be lost).
test.describe('Sign-up names', () => {
  test.beforeEach(async ({ page }) => {
    await gotoStudio(page);
    await page.waitForSelector('.measure-row');
    await page.evaluate(() => document.getElementById('authBtn')?.click());
    await expect(page.locator('#authModal')).toHaveClass(/open/, { timeout: 5000 });
  });

  test('sign-up sends first and last name as user metadata', async ({ page }) => {
    await page.route('**/functions/v1/check-email-exists', route =>
      route.fulfill({ json: { exists: false } }));

    // Intercepted so no real account or confirmation email is created.
    let signupBody = null;
    await page.route('**/auth/v1/signup**', route => {
      signupBody = route.request().postDataJSON();
      return route.fulfill({ json: { id: 'stub', email: signupBody.email, user_metadata: signupBody.data } });
    });

    await page.locator('#authEmail').fill(`signup.names.${Date.now()}@example.com`);
    await page.click('#authContinueBtn');
    await page.locator('#authFirstName').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('#authPass').fill('TestPass123!');
    await page.locator('#authPassConfirm').fill('TestPass123!');
    await page.locator('#authFirstName').fill('Ada');
    await page.locator('#authLastName').fill('Lovelace');
    await page.locator('#authTosCheckbox').check();
    await page.click('#authRegister');

    await expect(page.locator('#authHint')).toContainText('Account created', { timeout: 10000 });
    expect(signupBody?.data).toMatchObject({ first_name: 'Ada', last_name: 'Lovelace' });
  });

  test('first login copies metadata names into the new profile', async ({ page }) => {
    const email = `test.user.${Date.now()}.names@example.com`;
    const password = `TestPass${Date.now()}!`;
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { first_name: 'Ada', last_name: 'Lovelace' },
    });
    if (error) throw new Error(error.message);
    const userId = data.user.id;

    try {
      await page.locator('#authEmail').fill(email);
      await page.click('#authContinueBtn');
      await page.locator('#authPasswordRow').waitFor({ state: 'visible', timeout: 10000 });
      await page.locator('#authPass').fill(password);
      await page.click('#authLogin');
      await expect(page.locator('#authModal')).not.toHaveClass(/open/, { timeout: 15000 });

      await expect.poll(async () => {
        const { data: profile } = await supabaseAdmin
          .from('profiles').select('first_name, last_name').eq('user_id', userId).maybeSingle();
        return profile;
      }, { timeout: 15000 }).toEqual({ first_name: 'Ada', last_name: 'Lovelace' });
    } finally {
      await deleteTestUser(userId);
    }
  });
});
