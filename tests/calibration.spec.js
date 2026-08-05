// @ts-check
const { test, expect } = require('@playwright/test');
const { createClient } = require('@supabase/supabase-js');

// Supabase Setup
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || "";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const { createTestUser, deleteTestUser } = require('./utils/auth-helper');
const { waitForPageReady } = require('./utils/page-helper');

test.describe('Calibration Feature', () => {
  let testUser;
  let testHandpanId;

  test.beforeEach(async ({ page, isMobile }) => {
    if (isMobile) {
      test.skip(true, 'Skipping calibration tests on mobile');
      return;
    }

    // 0. Create unique test user (admin to bypass CUSTOM_SCALES feature gate)
    testUser = await createTestUser(true);

    // Mock image request to ensure it loads (and triggers onload)
    await page.route('https://placehold.co/600x400', async route => {
      // Return a simple 1x1 pixel image or just 200 OK with minimal body
      // A minimal valid PNG
      const pngBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: pngBuffer
      });
    });

    // Authenticate as the user to bypass RLS for seeding
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: testUser.email,
      password: testUser.password
    });
    if (signInError) throw new Error(`Failed to sign in for seeding: ${signInError.message}`);

    // 1. Seed a generic handpan for this user
    const { data: hp, error } = await supabase
      .from('user_handpans')
      .insert({
        user_id: testUser.user.id,
        name: 'Test Handpan For Calibration',
        builder: 'Test Builder',
        scale_name: 'D Minor',
        top_image_url: 'https://placehold.co/600x400',
        note_map: [
          { id: 1, note: 'D', octave: 3, x: 50, y: 50, r: 10 },
          { id: 2, note: 'A', octave: 3, x: 20, y: 20, r: 8 }
        ],
        is_active: true
      })
      .select()
      .single();

    // Sign out to clean up local client state (optional but good practice)
    await supabase.auth.signOut();

    if (error) throw new Error(`Failed to seed handpan: ${error.message}`);
    testHandpanId = hp.id;

    // 2. Navigate and wait for page to be fully loaded
    await waitForPageReady(page);

    // Auth Logic (from course_crud.spec.js pattern)
    // Mobile/Desktop handling for Auth Button
    const authBtnSelector = await page.locator('#authBtn').isVisible() ? '#authBtn' : '#accountBtn';
    const loginBtn = page.locator(authBtnSelector);

    // If button text implies not logged in, log in
    const btnText = await loginBtn.innerText();
    if (btnText.includes('Sign In') || btnText.includes('Register')) {
      await loginBtn.click();
      await expect(page.locator('#authModal')).toHaveClass(/open/);
      await page.fill('#authEmail', testUser.email);
      await page.click('#authContinueBtn');
      await page.locator('#authPasswordRow').waitFor({ state: 'visible', timeout: 10000 });
      await page.fill('#authPass', testUser.password);
      await page.click('#authLogin');

      // Verify login success with longer timeout
      await expect(page.locator('#authHint')).toContainText('Signed in', { timeout: 15000 });
      await expect(page.locator('#authModal')).not.toHaveClass(/open/);
    }
  });

  test.afterEach(async ({ page }) => {
    // Clear browser session to prevent test interference
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());

    // Clean up test data
    if (testHandpanId) {
      await supabase.from('user_handpans').delete().eq('id', testHandpanId);
    }
    if (testUser) {
      await deleteTestUser(testUser.user.id);
    }
  });

  test('Verify Calibration UI and Persistence', async ({ page }) => {
    test.slow(); // Allow more time for data fetching

    // Debug Logs
    page.on('console', msg => console.log('BROWSER_LOG:', msg.text()));
    page.on('pageerror', err => console.log('BROWSER_ERR:', err));

    // 1. Navigate to My Scales
    // Click Account Dropdown (or ensure it's open if flattened)
    const accountBtn = page.locator('#accountBtn');
    if (await accountBtn.isVisible()) {
      await accountBtn.click();
    } else {
      // Mobile menu handling if needed, but assuming desktop mostly for complex interactions?
      // Let's ensure menu open
      const mobileBtn = page.locator('#mobileMenuBtn');
      if (await mobileBtn.isVisible()) {
        await mobileBtn.click();
      }
    }

    // Click "My Scales"
    await page.click('#myScalesBtn');
    await expect(page.locator('#myScalesModal')).toHaveClass(/open/);

    // Wait for list to populate
    await expect(page.locator('.scale-list-item').first()).toBeVisible({ timeout: 15000 });

    // 2. Find our seeded handpan in the list
    const scaleItem = page.locator('.scale-list-item').filter({ hasText: 'Test Handpan For Calibration' });
    await expect(scaleItem).toBeVisible();

    // 3. Click "Map"
    await page.getByRole('button', { name: 'Map' }).first().click();

    // 4. Verify Calibration Overlay
    const overlay = page.locator('#calibrationOverlay');
    await expect(overlay).toBeVisible();
    await expect(page.locator('#calHandpanName')).toContainText('Calibrating: Test Handpan For Calibration');

    // Force container dimensions to ensure drag calculations work (avoid divide by zero)
    await page.addStyleTag({
      content: '#calCanvasContainer { width: 800px !important; height: 600px !important; display: block !important; }'
    });

    // 5. Verify Tonefields
    // We seeded 2 items
    await expect(page.locator('.tonefield')).toHaveCount(2);

    // 6. Select a Tonefield and Change Property
    const tf1 = page.locator('#tf-1');
    await tf1.click();
    await expect(tf1).toHaveClass(/selected/);
    await expect(page.locator('#calPropertiesPanel')).toBeVisible();

    // Change Note D -> E
    await page.selectOption('#calPitchSelect', 'E');

    // Wait for "Saving..." then "All changes saved"
    await expect(page.locator('#calSaveStatus')).toContainText('Saving...');
    await expect(page.locator('#calSaveStatus')).toContainText('All changes saved', { timeout: 10000 });

    // Wait for save again (skip checking "Saving..." as it may be too fast)
    await expect(page.locator('#calSaveStatus')).toContainText('All changes saved');

    // 6.5 Test Dragging (Pointer Events Verification)
    const dragTf = page.locator('#tf-1');
    const boxBefore = await dragTf.boundingBox();
    if (boxBefore) {
      await dragTf.hover();
      await page.mouse.down();
      await page.mouse.move(boxBefore.x + 50, boxBefore.y + 50, { steps: 5 });
      await page.mouse.up();

      const boxAfter = await dragTf.boundingBox();
      if (boxAfter) {
        expect(boxAfter.x).not.toBe(boxBefore.x);
        expect(boxAfter.y).not.toBe(boxBefore.y);
      }

      // Wait for auto-save trigger
      await expect(page.locator('#calSaveStatus')).toContainText('All changes saved', { timeout: 10000 });
    }

    // 7. Test "Add Tonefield" (New ID)
    await page.click('#headerAddTonefieldBtn');
    await expect(page.locator('.tonefield')).toHaveCount(3);

    // Verify new tonefield is selected (ID will be a timestamp, so just check count and selection class)
    const newTf = page.locator('.tonefield').nth(2); // 0-indexed, so 3rd item
    await expect(newTf).toHaveClass(/selected/);

    // Wait for save
    await expect(page.locator('#calSaveStatus')).toContainText('All changes saved');

    // 8. Exit
    await page.click('#calDoneBtn');
    await expect(overlay).not.toBeVisible();
    await expect(page.locator('#myScalesModal')).toHaveClass(/open/);

    // 9. Database Verification
    // Re-auth to query DB
    await supabase.auth.signInWithPassword({
      email: testUser.email,
      password: testUser.password
    });

    const { data: updatedHp } = await supabase
      .from('user_handpans')
      .select('note_map')
      .eq('id', testHandpanId)
      .single();

    // Check Note Change for ID 1
    const t1 = updatedHp.note_map.find(t => t.id === 1);
    expect(t1.note).toBe('E');
  });
});
