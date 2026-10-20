/**
 * check-site.js — post-deploy health check.
 *
 *   node scripts/check-site.js <url> [path/to/dist/index.html]
 *
 * With a dist/index.html, first waits (up to 3 min) until <url> serves that
 * build's main script, so a CDN still serving the previous deploy isn't
 * mistaken for success. Then loads the Studio in headless Chromium and fails
 * if the page throws any JavaScript error or the grid never renders: the
 * symptoms of a broken build that still deploys "successfully".
 */
const fs = require('fs');
const { chromium } = require('@playwright/test');

const [url, distIndex] = process.argv.slice(2);
if (!url) {
  console.error('Usage: node scripts/check-site.js <url> [dist/index.html]');
  process.exit(2);
}

const mainScript = html => (html.match(/src="([^"]*\/assets\/main-[^"]+\.js)"/) || [])[1];

async function waitForBuild(expected) {
  const deadline = Date.now() + 3 * 60 * 1000;
  for (;;) {
    const html = await fetch(`${url}?check=${Date.now()}`, { cache: 'no-store' }).then(r => r.text()).catch(() => '');
    if (mainScript(html) === expected) return;
    if (Date.now() > deadline) throw new Error(`${url} still isn't serving ${expected} after 3 minutes`);
    await new Promise(r => setTimeout(r, 10000));
  }
}

(async () => {
  if (distIndex) {
    const expected = mainScript(fs.readFileSync(distIndex, 'utf8'));
    if (!expected) throw new Error(`No main script found in ${distIndex}`);
    console.log(`Waiting for ${url} to serve ${expected}…`);
    await waitForBuild(expected);
  }

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${url.replace(/\/$/, '')}/#studio`, { waitUntil: 'networkidle' });
  const gridRendered = await page.locator('.measure-row').first()
    .waitFor({ state: 'visible', timeout: 20000 }).then(() => true, () => false);
  await browser.close();

  if (errors.length || !gridRendered) {
    console.error(`❌ ${url} is broken`);
    if (!gridRendered) console.error('   - the Studio grid never rendered');
    errors.forEach(e => console.error(`   - page error: ${e}`));
    process.exit(1);
  }
  console.log(`✅ ${url} loads with no page errors and the Studio grid renders`);
})().catch(err => { console.error(`❌ ${err.message}`); process.exit(1); });
