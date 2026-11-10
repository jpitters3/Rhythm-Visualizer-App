// Shared Playwright fixtures: every spec imports { test, expect } from here.
//
// pageErrorGuard (automatic) fails a test when its page throws, leaves a promise
// rejection unhandled, or reports a window error event such as "ResizeObserver
// loop completed with undelivered notifications". Errors behind a passing test
// used to go unnoticed. A test that expects one can allow it:
//   test.use({ allowedPageErrors: [/Expected failure/] });
const base = require('@playwright/test');

const ALWAYS_ALLOWED = [
  // Cross-origin scripts report only this, with no detail to act on
  /^Script error\.?$/,
  // WebKit reports a failed or cancelled cross-origin request as a page error even
  // when the app catches it (Chromium reports nothing). It can come after a reason
  // line, e.g. a third-party API answering without CORS headers, so not anchored.
  /Fetch API cannot load .* due to access control checks/,
  /is not allowed by Access-Control-Allow-Origin/,
];
const MARK = '[page-error] ';

const test = base.test.extend({
  allowedPageErrors: [[], { option: true }],

  pageErrorGuard: [async ({ page, allowedPageErrors }, use, testInfo) => {
    const allowed = [...ALWAYS_ALLOWED, ...allowedPageErrors];
    const errors = new Set();
    const note = (msg) => {
      if (!allowed.some(re => re.test(msg))) errors.add(msg);
    };

    page.on('pageerror', err => note(err.stack || err.message));
    // Error events without an exception (e.g. the ResizeObserver loop) and unhandled
    // rejections, passed out through the console
    await page.addInitScript((mark) => {
      addEventListener('error', (e) => { if (!e.error) console.error(mark + e.message); });
      addEventListener('unhandledrejection', (e) => {
        console.error(mark + 'Unhandled rejection: ' + (e.reason?.stack || e.reason));
      });
    }, MARK);
    page.on('console', (m) => {
      if (m.type() === 'error' && m.text().startsWith(MARK)) note(m.text().slice(MARK.length));
    });

    await use();

    if (errors.size && testInfo.status === testInfo.expectedStatus) {
      throw new Error(`The page reported ${errors.size} error(s):\n\n${[...errors].join('\n\n')}`);
    }
  }, { auto: true }],
});

module.exports = { test, expect: base.expect };
