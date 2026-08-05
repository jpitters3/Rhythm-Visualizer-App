const { test, expect } = require('@playwright/test');
const { createTestUser, deleteTestUser, loginAsTestUser } = require('./utils/auth-helper');
const { gotoStudio } = require('./helpers');

test.describe('SPA Routing', () => {
  test.describe('guest', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/');
      await page.waitForTimeout(500); // Give init scripts a moment to run
    });

    test('should default to home view for guests when no hash is provided', async ({ page }) => {
      // dashboard.js redirects unauthenticated cold loads from 'dashboard' to 'home'
      // (see js/router.js's handleHashChange + js/dashboard.js's routeChanged guard)
      await expect(page).toHaveURL(/.*#home/);
      await expect(page.locator('#view-home')).toBeVisible();
      await expect(page.locator('#view-studio')).not.toBeVisible();
    });
  });

  test.describe('authenticated', () => {
    let testUser;

    test.beforeEach(async ({ page }) => {
      testUser = await createTestUser();
      await gotoStudio(page);
      await loginAsTestUser(page, testUser);
    });

    test.afterEach(async () => {
      if (testUser) await deleteTestUser(testUser.user.id);
    });

    test('should switch to dashboard view when hash changes', async ({ page }) => {
      // #navDashboardBtn is a plain top-level nav link, not inside the account
      // dropdown — no need to open anything first.
      await page.locator('#navDashboardBtn').click();

      await expect(page).toHaveURL(/.*#dashboard/);
      await expect(page.locator('#view-studio')).not.toBeVisible();
      await expect(page.locator('#view-dashboard')).toBeVisible();
    });

    test('should switch back to studio from dashboard', async ({ page }) => {
      await page.goto('/#dashboard');
      await page.waitForTimeout(500);
      await expect(page.locator('#view-dashboard')).toBeVisible();

      // Navigate back to Studio via the real nav link (the old "Free Play
      // Engine" dashboard card this test used to click no longer exists).
      await page.locator('a[data-route="studio"]').click();

      await expect(page).toHaveURL(/.*#studio/);
      await expect(page.locator('#view-studio')).toBeVisible();
      await expect(page.locator('#view-dashboard')).not.toBeVisible();
    });
  });
});
