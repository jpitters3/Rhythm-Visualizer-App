// @ts-check
require('dotenv').config();
const fs = require('fs');
const { defineConfig, devices } = require('@playwright/test');

// Mirrors vite.config.js's own check: the dev server serves HTTPS whenever
// local certs are present (needed for camera access on mobile), plain HTTP
// otherwise (e.g. CI, where certs aren't generated). Deriving the protocol
// here instead of hardcoding one keeps this in sync with whichever mode the
// webServer command below actually starts.
const hasCerts = fs.existsSync('.certs/localhost-key.pem') && fs.existsSync('.certs/localhost.pem');
const baseURL = `${hasCerts ? 'https' : 'http'}://localhost:3000`;

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 4,
  reporter: 'html',
  use: {
    baseURL,
    ignoreHTTPSErrors: true,
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        launchOptions: {
          firefoxUserPrefs: {
            'dom.events.asyncClipboard.readText': true,
            'dom.events.testing.asyncClipboard': true,
          },
        },
      },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] },
    },
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    command: 'npm run dev',
    url: baseURL,
    ignoreHTTPSErrors: true,
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
