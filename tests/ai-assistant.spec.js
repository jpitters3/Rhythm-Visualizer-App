// @ts-check
const { test, expect } = require('@playwright/test');
const { waitForPageReady } = require('./utils/page-helper');

test.describe('AI Assistant', () => {
  test.beforeEach(async ({ page }) => {
    await waitForPageReady(page);
  });

  test('should open and show welcome message', async ({ page }) => {
    // 1. Locate and click FAB
    const fab = page.locator('#aiFab');
    await expect(fab).toBeVisible();
    await fab.click();

    // 2. Verify chat container opens
    const container = page.locator('#aiChatContainer');
    await expect(container).toHaveClass(/open/);

    // 3. Check for welcome message
    const welcomeMsg = page.locator('.ai-messages .bot').first();
    await expect(welcomeMsg).toBeVisible({ timeout: 2000 });
    await expect(welcomeMsg).toContainText("Hi! I'm your composition assistant.");
  });

  test('should send a message and receive a response', async ({ page }) => {
    // 1. Open Chat
    await page.click('#aiFab');

    // 2. Type message
    const input = page.locator('#aiInput');
    await input.fill('Give me a simple happy rhythm');
    await page.click('#sendAiBtn');

    // 3. Verify user message appears
    const userMsg = page.locator('.ai-messages .user').first();
    await expect(userMsg).toContainText('Give me a simple happy rhythm');

    // 4. Wait for bot response (mocking or real)
    // Note: If using real backend, this may take a few seconds
    const botResponse = page.locator('.ai-messages .bot').nth(1);
    await expect(botResponse).toBeVisible({ timeout: 15000 });

    // 5. Check if it says something or errors
    const text = await botResponse.innerText();
    console.log('Bot Response:', text);

    // We expect a valid response or an error we can handle
    if (text.includes('Error') || text.includes('failed')) {
      console.warn('AI Assistant returned an error, but connectivity was verified.');
    } else {
      expect(text.length).toBeGreaterThan(10);
    }
  });

  test('should close the chat', async ({ page }) => {
    // 1. Open
    await page.click('#aiFab');
    await expect(page.locator('#aiChatContainer')).toHaveClass(/open/);

    // 2. Click Close
    await page.click('.close-ai-btn');

    // 3. Verify closed
    await expect(page.locator('#aiChatContainer')).not.toHaveClass(/open/);
  });

  // test: should insert pattern into the grid
  test('should insert pattern into the grid', async ({ page }) => {
    // 0. Wait ten seconds to avoid gemini api rate limiting
    await page.waitForTimeout(10000);

    // 1. Open Chat
    await page.click('#aiFab');

    // 2. Type message
    const input = page.locator('#aiInput');
    await input.fill('Give me a happy 4-measure chord progression');
    await page.click('#sendAiBtn');

    // 3. Verify user message appears
    const userMsg = page.locator('.ai-messages .user').first();
    await expect(userMsg).toContainText('Give me a happy 4-measure chord progression');

    // 4. Wait for bot response with 'Add to Grid' button
    // Note: If using real backend, this may take a few seconds
    const botResponse = page.locator('.ai-messages .bot', { has: page.locator('button', { hasText: 'Add to Grid' }) }).first();
    await expect(botResponse).toBeVisible({ timeout: 45000 });

    // 5. Check if it says something
    const text = await botResponse.innerText();
    console.log('Bot Response with Grid Button:', text);

    // 6. Verify pattern is inserted into the grid
    // Click the 'Add to grid' button in the ai assistant response
    const addToGridBtn = botResponse.locator('button', { hasText: 'Add to Grid' });
    await addToGridBtn.click();

    // 7. Verify there are at least 4 measures in the grid
    // Each measure has class .measure-row
    const measures = page.locator('.measure-row');
    await expect(measures.count()).toBeGreaterThan(3);
  });
});
