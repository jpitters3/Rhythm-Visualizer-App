/**
 * backfill-tekmatix.js
 *
 * Sends every existing Panafide user to Tekmatix once, through the
 * sync-tekmatix edge function (so the payload matches live syncs exactly).
 * Dry run by default; pass --send to actually send.
 *
 * Usage:
 *   node scripts/backfill-tekmatix.js --prod                 # count only
 *   node scripts/backfill-tekmatix.js --prod --send --limit 5
 *   node scripts/backfill-tekmatix.js --prod --send
 *
 * Requires in .env (or .env.prod with --prod): VITE_SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY, TEKMATIX_SYNC_SECRET
 */

require('./load-env');

const SUPABASE_URL     = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SYNC_SECRET      = process.env.TEKMATIX_SYNC_SECRET;
const DELAY_MS         = 300; // stay well under Tekmatix webhook rate limits

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !SYNC_SECRET) {
  console.error('Missing VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or TEKMATIX_SYNC_SECRET in .env');
  process.exit(1);
}

const args = process.argv.slice(2);
const send = args.includes('--send');
const limitIndex = args.indexOf('--limit');
const limit = limitIndex >= 0 ? parseInt(args[limitIndex + 1], 10) : Infinity;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchAllUserIds() {
  const ids = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=user_id&order=user_id`, {
      headers: {
        'apikey': SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'Range': `${from}-${from + pageSize - 1}`,
      },
    });
    const rows = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(rows));
    ids.push(...rows.map(r => r.user_id));
    if (rows.length < pageSize) return ids;
  }
}

async function syncUser(userId) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/sync-tekmatix`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-sync-secret': SYNC_SECRET },
    body: JSON.stringify({ user_id: userId }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
}

(async () => {
  const userIds = (await fetchAllUserIds()).slice(0, limit);
  console.info(`Project: ${new URL(SUPABASE_URL).host}`);
  console.info(`${userIds.length} user(s) to sync`);
  if (!send) {
    console.info('Dry run. Re-run with --send to sync them to Tekmatix.');
    return;
  }

  let ok = 0;
  const failed = [];
  for (const userId of userIds) {
    try {
      await syncUser(userId);
      ok++;
    } catch (err) {
      failed.push(userId);
      console.error(`✗ ${userId}: ${err.message}`);
    }
    await sleep(DELAY_MS);
  }
  console.info(`Done: ${ok} synced, ${failed.length} failed.`);
  if (failed.length) process.exitCode = 1;
})();
