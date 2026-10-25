/**
 * fill-names-from-podia.js
 *
 * Fills blank profiles.first_name / last_name from a Podia audience export,
 * matched by email. Never overwrites a name that's already set. Podia has a
 * single Name column: the first word becomes first_name, the rest last_name.
 * Each update also triggers the Tekmatix sync (profiles trigger).
 * Dry run by default; pass --apply to write.
 *
 * Usage:
 *   node scripts/fill-names-from-podia.js <podia.csv> --prod
 *   node scripts/fill-names-from-podia.js <podia.csv> --prod --apply
 *
 * Requires in .env (or .env.prod with --prod): VITE_SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY
 */

require('./load-env');
const fs = require('fs');

const SUPABASE_URL     = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const HEADERS = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` };

const args = process.argv.slice(2);
const csvPath = args.find(a => !a.startsWith('--'));
const apply = args.includes('--apply');

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !csvPath) {
  console.error('Usage: node scripts/fill-names-from-podia.js <podia.csv> [--prod] [--apply]');
  process.exit(1);
}

// Minimal RFC 4180 parser: quoted fields, escaped quotes, commas in quotes.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(Boolean));
}

function splitName(name) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return { first: words[0] || '', last: words.slice(1).join(' ') };
}

function podiaNamesByEmail(csvText) {
  const [header, ...rows] = parseCsv(csvText);
  const nameCol = header.indexOf('Name');
  const emailCol = header.indexOf('Email');
  if (nameCol < 0 || emailCol < 0) throw new Error('CSV needs Name and Email columns');
  const map = new Map();
  for (const r of rows) {
    const email = r[emailCol]?.trim().toLowerCase();
    const name = r[nameCol]?.trim();
    if (email && name) map.set(email, name);
  }
  return map;
}

async function fetchAuthEmails() {
  const emails = new Map();
  for (let page = 1; ; page++) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=1000`, { headers: HEADERS });
    const json = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(json));
    for (const u of json.users || []) if (u.email) emails.set(u.id, u.email.toLowerCase());
    if (!json.users || json.users.length < 1000) return emails;
  }
}

async function fetchProfiles() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=user_id,first_name,last_name`, { headers: HEADERS });
  const json = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(json));
  return json;
}

async function updateProfile(userId, changes) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${userId}`, {
    method: 'PATCH',
    headers: { ...HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify(changes),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
}

(async () => {
  const podia = podiaNamesByEmail(fs.readFileSync(csvPath, 'utf8'));
  const [emails, profiles] = await Promise.all([fetchAuthEmails(), fetchProfiles()]);
  console.info(`Project: ${new URL(SUPABASE_URL).host}`);

  const updates = [];
  let notInPodia = 0;
  for (const p of profiles) {
    if (p.first_name && p.last_name) continue;
    const email = emails.get(p.user_id);
    const podiaName = email && podia.get(email);
    if (!podiaName) { notInPodia++; continue; }

    const { first, last } = splitName(podiaName);
    const changes = {};
    if (!p.first_name && first) changes.first_name = first;
    if (!p.last_name && last) changes.last_name = last;
    if (Object.keys(changes).length) updates.push({ userId: p.user_id, email, podiaName, changes });
  }

  for (const u of updates) {
    console.info(`${u.email}  "${u.podiaName}"  →  ${JSON.stringify(u.changes)}`);
  }
  console.info(`\n${updates.length} profile(s) to update; ${notInPodia} missing a name with no Podia match.`);

  if (!apply) {
    console.info('Dry run. Re-run with --apply to write these changes.');
    return;
  }

  let failed = 0;
  for (const u of updates) {
    try {
      await updateProfile(u.userId, u.changes);
    } catch (err) {
      failed++;
      console.error(`✗ ${u.email}: ${err.message}`);
    }
  }
  console.info(`Done: ${updates.length - failed} updated, ${failed} failed.`);
  if (failed) process.exitCode = 1;
})();
