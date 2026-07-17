require('dotenv').config();
const { test, expect } = require('@playwright/test');
const { createClient } = require('@supabase/supabase-js');
const { waitForPageReady } = require('./page-helper');

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function createTestUser(isAdmin = false) {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 10000);
  const email = `test.user.${timestamp}.${random}@example.com`;
  const password = `TestPass${timestamp}!`;

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      is_admin: isAdmin
    }
  });

  if (error) {
    throw new Error(`Failed to create test user: ${error.message}`);
  }

  return {
    email,
    password,
    user: data.user,
  };
}

async function deleteTestUser(userId) {
  const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (error) {
    console.error(`Failed to delete test user ${userId}:`, error.message);
  }
}

async function loginAsTestUser(page, testUser) {
  // auth-helper.js
  await waitForPageReady(page);

  // On mobile the account button lives inside the hamburger menu — open it first.
  const mobileMenu = page.locator('#mobileMenuBtn');
  if (await mobileMenu.isVisible()) await mobileMenu.click();

  // Auth Logic...
  const authBtnSelector = await page.locator('#authBtn').isVisible() ? '#authBtn' : '#accountBtn';
  const loginBtn = page.locator(authBtnSelector);

  // If button text implies not logged in, log in
  const btnText = await loginBtn.innerText();
  if (btnText.includes('Sign In') || btnText.includes('Register')) {
    await loginBtn.click();
    await expect(page.locator('#authModal')).toHaveClass(/open/);

    // Step 1: Enter email and click Continue (app checks if email exists via Supabase)
    await page.fill('#authEmail', testUser.email);
    await page.click('#authContinueBtn');

    // Step 2: Wait for password row to appear, then fill and submit
    await page.locator('#authPasswordRow').waitFor({ state: 'visible', timeout: 10000 });
    await page.fill('#authPass', testUser.password);
    await page.click('#authLogin');

    // Verify login success with longer timeout
    await expect(page.locator('#authHint')).toContainText('Signed in', { timeout: 15000 });
    await expect(page.locator('#authModal')).not.toHaveClass(/open/);
  }
}

module.exports = { createTestUser, deleteTestUser, loginAsTestUser, supabaseAdmin };
