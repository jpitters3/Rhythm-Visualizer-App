/**
 * Shared Playwright test helpers
 */

/**
 * Clicks the clear button for the given grid and confirms the custom dialog.
 * The app uses a custom #confirmModal instead of the native browser confirm,
 * so we must wait for it to open and click OK.
 */
export async function clearGrid(page, gridId = 'A') {
  await page.click(`#clearBtn-${gridId}`);
  await page.locator('#confirmModal.open').waitFor({ timeout: 5000 });
  await page.click('#confirmOkBtn');
}
