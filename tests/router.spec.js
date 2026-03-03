import { test, expect } from '@playwright/test';

test.describe('SPA Routing', () => {
  test.beforeEach(async ({ page }) => {
    // Start at the root (should default to freeplay)
    await page.goto('/');
    await page.waitForTimeout(500); // Give init scripts a moment to run
  });

  test('should default to freeplay view if no hash is provided', async ({ page }) => {
    // Verify hash was updated
    await expect(page).toHaveURL(/.*#freeplay/);

    // Check view visibility
    await expect(page.locator('#view-freeplay')).toBeVisible();
    await expect(page.locator('#view-dashboard')).not.toBeVisible();
  });

  test('should switch to dashboard view when hash changes', async ({ page }) => {
    // Navigate via the new Dashboard button
    const mobileMenu = page.locator('#mobileMenuBtn');
    if (await mobileMenu.isVisible()) {
      await mobileMenu.click();
    }
    // Hover or click account dropdown container to reveal contents
    const accountDropdown = page.locator('.account-dropdown');
    await accountDropdown.hover();
    await page.waitForTimeout(200);

    // Dashboard btn inside account dropdown (evaluate click to bypass CSS hover display:none issues in headless)
    await page.evaluate(() => document.getElementById('navDashboardBtn').click());

    // Verify hash changed to #dashboard
    await expect(page).toHaveURL(/.*#dashboard/);

    // Verify views updated
    await expect(page.locator('#view-freeplay')).not.toBeVisible();
    await expect(page.locator('#view-dashboard')).toBeVisible();
  });

  test('should switch back to freeplay from dashboard', async ({ page }) => {
    // Go directly to dashboard first
    await page.goto('/#dashboard');
    await page.waitForTimeout(500);

    // Verify dashboard is active
    await expect(page.locator('#view-dashboard')).toBeVisible();

    // Click the Free Play Card on the dashboard
    await page.locator('text=Free Play Engine').click();

    // Verify hash changed to #freeplay
    await expect(page).toHaveURL(/.*#freeplay/);

    // Verify freeplay is visible again
    await expect(page.locator('#view-freeplay')).toBeVisible();
    await expect(page.locator('#view-dashboard')).not.toBeVisible();
  });
});
