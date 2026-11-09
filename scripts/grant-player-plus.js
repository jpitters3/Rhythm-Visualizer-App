/**
 * grant-player-plus.js
 *
 * Grants subscription_tier = 'player_plus' (or 'pro' with --tier pro) for a
 * fixed duration (default 1 year) to a list of existing users, looked up by
 * email. Silent — no email
 * sent, no Stripe involved. Intended for one-off manual grants (e.g. beta
 * testers, students on a teacher-sponsored plan).
 *
 * Usage:
 *   node scripts/grant-player-plus.js alice@example.com bob@example.com
 *   node scripts/grant-player-plus.js --file emails.txt
 *   node scripts/grant-player-plus.js --file emails.txt --days 30
 *   node scripts/grant-player-plus.js alice@example.com --tier pro --days 90
 *
 * emails.txt: one email per line, blank lines and lines starting with #
 * are ignored.
 *
 * Runs against production (.env.prod). Add --staging to use .env instead.
 * Requires: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in that file.
 */

const { scriptArgs } = require('./load-env');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL     = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

function parseArgs(argv) {
  const emails = [];
  let file = null;
  let days = 365;
  let tier = 'player_plus';

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--file') {
      file = argv[++i];
    } else if (arg === '--tier') {
      tier = argv[++i];
    } else if (arg === '--days') {
      days = parseInt(argv[++i], 10);
    } else {
      emails.push(arg);
    }
  }

  if (file) {
    const filePath = path.resolve(process.cwd(), file);
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) emails.push(trimmed);
    }
  }

  return { emails: [...new Set(emails.map(e => e.toLowerCase()))], days, tier };
}

const { emails, days, tier } = parseArgs(scriptArgs);

if (emails.length === 0 || !Number.isFinite(days) || days <= 0 || !['player_plus', 'pro'].includes(tier)) {
  console.error('Usage: node scripts/grant-player-plus.js <email1> <email2> ... [--file emails.txt] [--days 365] [--tier player_plus|pro] [--staging]');
  process.exit(1);
}

async function getUserByEmail(email) {
  // This endpoint's ?email= filter isn't actually applied server-side —
  // it silently returns the first unfiltered page instead, so a user past
  // page 1 reads as "not found" even though they exist. Paginate for real.
  let page = 1;
  while (true) {
    const res = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=1000`,
      {
        headers: {
          'apikey': SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        },
      }
    );
    const json = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(json));
    const user = json.users?.find(u => u.email?.toLowerCase() === email.toLowerCase());
    if (user) return user;
    if (!json.users || json.users.length < 1000) break;
    page++;
  }
  throw new Error('No user found with this email');
}

async function grantTier(userId, expiresAt) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${userId}`, {
    method: 'PATCH',
    headers: {
      'apikey': SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify({
      subscription_tier: tier,
      subscription_status: 'active',
      subscription_expires_at: expiresAt,
    }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(JSON.stringify(json));
  if (!json || json.length === 0) throw new Error('No profile row found for this user (missing profiles row?)');
  return json[0];
}

async function main() {
  const expiresAt = new Date(Date.now() + days * 86400000).toISOString();
  console.log(`Granting ${tier}, expiring ${expiresAt} (${days} days from now), to ${emails.length} user(s):\n`);

  const results = { granted: [], failed: [] };

  for (const email of emails) {
    try {
      const user = await getUserByEmail(email);
      await grantTier(user.id, expiresAt);
      console.log(`  ✓ ${email}`);
      results.granted.push(email);
    } catch (err) {
      console.log(`  ✗ ${email} — ${err.message}`);
      results.failed.push(email);
    }
  }

  console.log(`\nDone. Granted: ${results.granted.length}. Failed: ${results.failed.length}.`);
  if (results.failed.length > 0) {
    console.log('Failed emails:', results.failed.join(', '));
    process.exit(1);
  }
}

main().catch(err => {
  console.error('\nUnexpected error:', err.message);
  process.exit(1);
});
