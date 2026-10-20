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
// Set by .github/workflows/deploy-staging.yml once it knows the just-deployed
// Netlify URL, so the same suite can run against a real deployed staging site
// instead of a local dev server. Unset everywhere else (plain local/manual
// `npm test`), which keeps today's localhost behavior as the default.
const remoteBaseURL = process.env.PLAYWRIGHT_BASE_URL;
const baseURL = remoteBaseURL || `${hasCerts ? 'https' : 'http'}://localhost:3000`;

// Firefox is skipped in CI only (kept for local dev, where coverage matters
// more than wall-clock time) — the staging workflow's 30-minute cap doesn't
// fit the full 5-project matrix, and Firefox-specific bugs are rare enough
// here that dropping it buys the most time back for the least coverage lost.
// CI runners have no real microphone, so getUserMedia() throws there without
// these — coaching_mode.spec.js's turnOnMic() swallows that error, isListening
// never flips true, and the countdown overlay it gates never shows. Harmless
// locally too (just swaps in a synthetic stream), so applied everywhere.
const fakeMediaDeviceArgs = {
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
};

const allProjects = [
  {
    name: 'chromium',
    use: { ...devices['Desktop Chrome'], launchOptions: fakeMediaDeviceArgs },
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
    use: { ...devices['Pixel 5'], launchOptions: fakeMediaDeviceArgs },
  },
  {
    name: 'Mobile Safari',
    use: { ...devices['iPhone 12'] },
  },
];

module.exports = defineConfig({
  testDir: './tests',
  // Playwright's 30s default is too tight for multi-step flows on slower CI
  // runners (notably Mobile Safari). Tests needing more still set their own.
  timeout: 60_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 6 : 4,
  reporter: 'html',
  use: {
    baseURL,
    ignoreHTTPSErrors: true,
    // CI keeps a trace for every failed attempt, including first attempts that
    // pass on retry, so intermittent failures can still be diagnosed.
    trace: process.env.CI ? 'retain-on-failure' : 'on-first-retry',
    // public/sw.js claims the page a few seconds after first load, mid-test.
    // From then on WebKit sends requests through it, so page.route() mocks
    // stop applying. No test exercises the service worker itself.
    serviceWorkers: 'block',
  },

  projects: process.env.CI ? allProjects.filter(p => p.name !== 'firefox') : allProjects,

  /* Run your local dev server before starting the tests — skipped when
     baseURL is a remote deployed site (nothing to start, and Playwright
     would otherwise refuse since that URL is already live). */
  webServer: remoteBaseURL ? undefined : {
    command: 'npm run dev',
    url: baseURL,
    ignoreHTTPSErrors: true,
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
