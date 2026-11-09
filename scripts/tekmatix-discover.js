/**
 * tekmatix-discover.js
 *
 * Read-only look at the Tekmatix (HighLevel) sub-account, used to map
 * fields for the Clients view: tags, contact custom fields, calendars, and
 * the field names (not values) on one tagged contact.
 *
 * Usage:
 *   node scripts/tekmatix-discover.js [--tag client-mentorship]
 *
 * Requires in .env.prod: TEKMATIX_API_TOKEN (Private Integration token).
 */

require('./load-env');

const API = 'https://services.leadconnectorhq.com';
const LOCATION_ID = process.env.TEKMATIX_LOCATION_ID || 'UoK8VlrzTaf0VmOFilzH';
const TOKEN = process.env.TEKMATIX_API_TOKEN;

const args = process.argv.slice(2);
const tagArg = args.includes('--tag') ? args[args.indexOf('--tag') + 1] : null;

if (!TOKEN) {
  console.error('Add TEKMATIX_API_TOKEN=pit-… to .env.prod, then run it.');
  process.exit(1);
}

async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Version: '2021-07-28',
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  const text = await res.text();
  if (!res.ok) return { error: `${res.status} ${text.slice(0, 300)}` };
  return JSON.parse(text);
}

function section(title) {
  console.info(`\n=== ${title} ===`);
}

(async () => {
  section('Tags');
  const tags = await api(`/locations/${LOCATION_ID}/tags`);
  if (tags.error) console.error(tags.error);
  else console.info((tags.tags || []).map(t => t.name).sort().join('\n') || '(none)');

  section('Contact custom fields');
  const fields = await api(`/locations/${LOCATION_ID}/customFields?model=contact`);
  if (fields.error) console.error(fields.error);
  else for (const f of fields.customFields || []) console.info(`${f.fieldKey}  [${f.dataType}]  id=${f.id}  "${f.name}"`);

  section('Calendars');
  const cals = await api(`/calendars/?locationId=${LOCATION_ID}`);
  if (cals.error) console.error(cals.error);
  else for (const c of cals.calendars || []) console.info(`${c.name}  id=${c.id}`);

  section(tagArg ? `Sample contact tagged "${tagArg}" (field names only)` : 'Sample contact (field names only)');
  const search = await api('/contacts/search', {
    method: 'POST',
    body: JSON.stringify({
      locationId: LOCATION_ID,
      pageLimit: 1,
      ...(tagArg ? { filters: [{ field: 'tags', operator: 'contains', value: tagArg }] } : {}),
    }),
  });
  if (search.error) { console.error(search.error); return; }
  const contact = search.contacts?.[0];
  if (!contact) { console.info('(no contact found)'); return; }
  console.info(`total matching: ${search.total ?? '?'}`);
  console.info('search fields:', Object.keys(contact).sort().join(', '));

  // The single-contact endpoint can carry more fields than search results.
  const full = await api(`/contacts/${contact.id}`);
  if (!full.error) console.info('detail fields:', Object.keys(full.contact || {}).sort().join(', '));
  const photoKeys = Object.keys(full.contact || contact).filter(k => /photo|avatar|image|picture/i.test(k));
  console.info('photo-like fields:', photoKeys.join(', ') || '(none found)');

  const appts = await api(`/contacts/${contact.id}/appointments`);
  console.info('appointments endpoint:', appts.error ? appts.error : `${(appts.events || []).length} events`);

  const notes = await api(`/contacts/${contact.id}/notes`);
  console.info('notes endpoint:', notes.error ? notes.error : `${(notes.notes || []).length} notes`);
})();
