const { chromium } = require('playwright');
const path = require('path');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 11pt;
    color: #1a1a2e;
    padding: 36pt 48pt;
    line-height: 1.5;
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    border-bottom: 2.5pt solid #6366f1;
    padding-bottom: 10pt;
    margin-bottom: 20pt;
  }
  header h1 { font-size: 18pt; font-weight: 700; color: #6366f1; letter-spacing: -0.3pt; }
  header .meta { font-size: 9pt; color: #666; text-align: right; line-height: 1.6; }

  .badge {
    display: inline-block;
    background: #f0f0ff;
    border: 1pt solid #c7d2fe;
    border-radius: 4pt;
    padding: 2pt 7pt;
    font-size: 9pt;
    color: #4f46e5;
    font-weight: 600;
    margin-bottom: 16pt;
  }

  section { margin-bottom: 18pt; break-inside: avoid; }

  .section-header {
    display: flex;
    align-items: center;
    gap: 8pt;
    margin-bottom: 8pt;
  }
  .section-header h2 {
    font-size: 11pt;
    font-weight: 700;
    color: #1a1a2e;
  }
  .time-badge {
    font-size: 8pt;
    color: #6366f1;
    background: #eef2ff;
    border-radius: 3pt;
    padding: 1pt 5pt;
    font-weight: 600;
  }

  ul { list-style: none; padding: 0; }
  li {
    display: flex;
    align-items: flex-start;
    gap: 8pt;
    padding: 4pt 0;
    border-bottom: 0.5pt solid #f0f0f0;
    font-size: 10pt;
  }
  li:last-child { border-bottom: none; }

  .checkbox {
    width: 10pt;
    height: 10pt;
    min-width: 10pt;
    border: 1.5pt solid #9ca3af;
    border-radius: 2pt;
    margin-top: 1.5pt;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 9.5pt;
    margin-top: 4pt;
  }
  thead tr { background: #f5f3ff; }
  th {
    text-align: left;
    padding: 5pt 8pt;
    font-weight: 600;
    color: #4f46e5;
    border-bottom: 1pt solid #c7d2fe;
  }
  td { padding: 5pt 8pt; border-bottom: 0.5pt solid #f0f0f0; vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  td:first-child { font-weight: 600; color: #374151; white-space: nowrap; }
  td:last-child { color: #6b7280; }

  footer {
    margin-top: 24pt;
    padding-top: 8pt;
    border-top: 0.5pt solid #e5e7eb;
    font-size: 8pt;
    color: #9ca3af;
    display: flex;
    justify-content: space-between;
  }
</style>
</head>
<body>

<header>
  <h1>Panafide — Manual Regression Checklist</h1>
  <div class="meta">
    Version 1.0<br/>
    Generated: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}<br/>
    Run before every production deploy
  </div>
</header>

<div class="badge">⏱ Target: ~10 minutes end-to-end</div>

<section>
  <div class="section-header">
    <h2>1 · First-Load &amp; Auth</h2>
    <span class="time-badge">~2 min</span>
  </div>
  <ul>
    <li><div class="checkbox"></div>Page loads without red errors in DevTools console</li>
    <li><div class="checkbox"></div>Welcome modal appears for logged-out users; video plays on click; modal closes cleanly with audio stopped</li>
    <li><div class="checkbox"></div>Sign up with a new email — account created, nav updates to show username</li>
    <li><div class="checkbox"></div>Sign out — nav resets, grid still usable without logging in</li>
  </ul>
</section>

<section>
  <div class="section-header">
    <h2>2 · Core Grid</h2>
    <span class="time-badge">~2 min</span>
  </div>
  <ul>
    <li><div class="checkbox"></div>Click a cell → type a note letter (e.g. D) → note label appears in cell</li>
    <li><div class="checkbox"></div>Press Play → active cell highlights and pulses in time with playback</li>
    <li><div class="checkbox"></div>Press Stop → playback halts cleanly</li>
    <li><div class="checkbox"></div>Change BPM — playback speed updates immediately without restarting</li>
    <li><div class="checkbox"></div>Switch label mode Numbers → Pitches — all note labels update across every cell</li>
  </ul>
</section>

<section>
  <div class="section-header">
    <h2>3 · Save &amp; Load</h2>
    <span class="time-badge">~1.5 min</span>
  </div>
  <ul>
    <li><div class="checkbox"></div>Save a new phrase — name prompt appears, pattern saves, name shown in header</li>
    <li><div class="checkbox"></div>Reload the page → open the saved phrase → grid matches exactly what was saved</li>
    <li><div class="checkbox"></div>Share button → link copies to clipboard; visiting that link loads the correct pattern</li>
  </ul>
</section>

<section>
  <div class="section-header">
    <h2>4 · Courses</h2>
    <span class="time-badge">~1.5 min</span>
  </div>
  <ul>
    <li><div class="checkbox"></div>Open the sidebar → at least one course is visible with a title and thumbnail</li>
    <li><div class="checkbox"></div>Open a course → lesson list loads with correct titles</li>
    <li><div class="checkbox"></div>Open a lesson with a pattern → click "Load Pattern" → grid updates to that pattern</li>
    <li><div class="checkbox"></div>Mark a lesson complete → progress indicator reflects the change</li>
  </ul>
</section>

<section>
  <div class="section-header">
    <h2>5 · Monetisation &amp; Gating</h2>
    <span class="time-badge">~1.5 min</span>
  </div>
  <ul>
    <li><div class="checkbox"></div>Signed out: attempt to save → auth prompt appears (not a JS error or blank screen)</li>
    <li><div class="checkbox"></div>Free user: save 5 patterns, attempt a 6th → upgrade modal appears, mentions "Unlimited Cloud Storage"</li>
    <li><div class="checkbox"></div>Upgrade modal: "Upgrade to Player+" button redirects to Stripe checkout (do not complete purchase)</li>
    <li><div class="checkbox"></div>Player+ user with active subscription: no expiry banner visible</li>
  </ul>
</section>

<section>
  <div class="section-header">
    <h2>6 · Community</h2>
    <span class="time-badge">~30 sec</span>
  </div>
  <ul>
    <li><div class="checkbox"></div>Open Community tab → posts load without an error state</li>
    <li><div class="checkbox"></div>Like a post → count increments; refresh the page → count persists</li>
  </ul>
</section>

<section>
  <div class="section-header">
    <h2>Instant Red Flags</h2>
  </div>
  <table>
    <thead>
      <tr><th>Symptom</th><th>Likely cause</th></tr>
    </thead>
    <tbody>
      <tr><td>Grid cells don't respond to clicks</td><td>JS init failed — check console for module errors</td></tr>
      <tr><td>Save shows "undefined" as pattern name</td><td>Pattern name state lost — check controls.js</td></tr>
      <tr><td>Courses sidebar is empty</td><td>Supabase fetch error — check network tab</td></tr>
      <tr><td>Upgrade modal doesn't fire on 6th save</td><td>Gating logic broken — check gated-feature.js</td></tr>
      <tr><td>Community likes reset on refresh</td><td>post_likes trigger missing — run DB migration</td></tr>
      <tr><td>Subscription banner not showing near expiry</td><td>subscription_expires_at column not migrated</td></tr>
    </tbody>
  </table>
</section>

<footer>
  <span>Panafide · panafide.com</span>
  <span>This document is for internal use only</span>
</footer>

</body>
</html>`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle' });
  const outputPath = path.join(__dirname, '..', 'Panafide-Regression-Checklist.pdf');
  await page.pdf({
    path: outputPath,
    format: 'A4',
    printBackground: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' },
  });
  await browser.close();
  console.log(`PDF saved to: ${outputPath}`);
})();
