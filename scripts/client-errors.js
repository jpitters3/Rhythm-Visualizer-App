/**
 * client-errors.js
 *
 * Lists recent errors reported from users' browsers (js/error-reporter.js),
 * newest first, grouped by message.
 *
 * Usage:
 *   node scripts/client-errors.js            # last 7 days
 *   node scripts/client-errors.js --days 30
 *   node scripts/client-errors.js --full     # every report with its stack
 *
 * Runs against production (.env.prod). Add --staging to use .env instead.
 * Requires: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in that file.
 */

const { scriptArgs } = require('./load-env');

const SUPABASE_URL     = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const args = scriptArgs();
const daysIdx = args.indexOf('--days');
const days = daysIdx >= 0 ? Number(args[daysIdx + 1]) || 7 : 7;
const full = args.includes('--full');

async function main() {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const url = `${SUPABASE_URL}/rest/v1/client_errors?select=*&created_at=gte.${since}&order=created_at.desc&limit=500`;
  const res = await fetch(url, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  if (!res.ok) {
    console.error(`Request failed (${res.status}): ${await res.text()}`);
    process.exit(1);
  }
  const rows = await res.json();
  if (!rows.length) {
    console.log(`No errors reported in the last ${days} day(s).`);
    return;
  }

  if (full) {
    for (const r of rows) {
      console.log(`\n${r.created_at}  ${r.page || ''}  user ${r.user_id || 'signed out'}`);
      console.log(`  ${r.message}`);
      if (r.stack) console.log(r.stack.split('\n').map(l => `    ${l}`).join('\n'));
      console.log(`  ${r.user_agent || ''}`);
    }
    return;
  }

  const groups = new Map();
  for (const r of rows) {
    const g = groups.get(r.message) || { count: 0, users: new Set(), last: r.created_at, page: r.page };
    g.count += 1;
    g.users.add(r.user_id || 'signed out');
    groups.set(r.message, g);
  }
  console.log(`${rows.length} report(s) in the last ${days} day(s):\n`);
  for (const [message, g] of [...groups].sort((a, b) => b[1].count - a[1].count)) {
    console.log(`${String(g.count).padStart(4)}×  ${message}`);
    console.log(`       last ${g.last}  ·  ${g.users.size} user(s)  ·  ${g.page || ''}`);
  }
  console.log('\nAdd --full for stacks and browsers.');
}

main().catch((e) => { console.error(e); process.exit(1); });
