/**
 * tekmatix-clients
 *
 * Admin-only read of active clients from Tekmatix (HighLevel API v2) for the
 * Clients view (js/clients.js). Active = tagged "client mentorship" or
 * "client group". Tekmatix is the source of truth; nothing is stored here.
 *
 * Secrets: TEKMATIX_API_TOKEN (Private Integration token),
 * optional TEKMATIX_LOCATION_ID.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const API = 'https://services.leadconnectorhq.com'
const PROGRAM_TAGS: Record<string, string> = {
  'client mentorship': 'mentorship',
  'client group': 'group',
}
const VIDEO_FIELD_ID = 'PjcqmorcvRSN1PGA1oV3' // contact.zoom_video_link
const BATCH_SIZE = 5 // HighLevel allows ~100 requests / 10s

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

type Json = Record<string, any>

async function isAdmin(req: Request) {
  const jwt = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!jwt) return false
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: { user } } = await supabase.auth.getUser(jwt)
  if (!user) return false
  const { data: profile } = await supabase.from('profiles').select('role').eq('user_id', user.id).maybeSingle()
  return profile?.role === 'admin'
}

function tekmatix(token: string) {
  return async (path: string, init: RequestInit = {}): Promise<Json> => {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Version: '2021-07-28',
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    })
    if (!res.ok) throw new Error(`${path.split('?')[0]} → ${res.status} ${(await res.text()).slice(0, 200)}`)
    return res.json()
  }
}

// Offset (ms) of a timezone from UTC at a given instant.
function tzOffset(ms: number, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms)).map(p => [p.type, p.value]))
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - ms
}

// Appointment times arrive as wall-clock strings ("2026-11-01 08:00:00") in
// the location's timezone, with no offset.
function parseWallTime(value: string, timeZone: string) {
  if (/(Z|[+-]\d\d:?\d\d)$/.test(value)) return Date.parse(value)
  const asUtc = Date.parse(`${value.replace(' ', 'T')}Z`)
  const guess = asUtc - tzOffset(asUtc, timeZone)
  return asUtc - tzOffset(guess, timeZone) // second pass settles DST edges
}

// Cancelled bookings don't count as a lesson, past or upcoming.
function splitAppointments(events: Json[], timeZone: string) {
  const now = Date.now()
  const times = events
    .filter(e => !e.deleted && !/cancel/i.test(e.appointmentStatus ?? ''))
    .map(e => ({ at: parseWallTime(String(e.startTime), timeZone), title: e.title ?? '' }))
    .filter(e => !Number.isNaN(e.at))
    .sort((a, b) => a.at - b.at)
  const toJson = (e?: { at: number, title: string }) => e ? { at: new Date(e.at).toISOString(), title: e.title } : null
  return {
    lastAppointment: toJson(times.filter(e => e.at < now).at(-1)),
    nextAppointment: toJson(times.find(e => e.at >= now)),
  }
}

function latestNote(notes: Json[]) {
  const note = [...notes].sort((a, b) => String(b.dateAdded).localeCompare(String(a.dateAdded)))[0]
  if (!note) return null
  return { title: note.title ?? '', html: note.body ?? '', text: note.bodyText ?? '', at: note.dateAdded ?? null }
}

// The location's own timezone; needs the Private Integration's locations.readonly scope.
async function locationTimeZone(api: ReturnType<typeof tekmatix>, locationId: string) {
  try {
    const { location } = await api(`/locations/${locationId}`)
    if (location?.timezone) return location.timezone as string
  } catch (err) {
    console.warn('[tekmatix-clients] location timezone unavailable, using fallback', err)
  }
  return Deno.env.get('TEKMATIX_TIMEZONE') ?? 'America/Toronto'
}

async function loadClient(api: ReturnType<typeof tekmatix>, locationId: string, timeZone: string, id: string) {
  const [detail, appts, notes] = await Promise.all([
    api(`/contacts/${id}`),
    api(`/contacts/${id}/appointments`),
    api(`/contacts/${id}/notes`),
  ])
  const c = detail.contact ?? {}
  const name = [c.firstName, c.lastName].filter(Boolean).join(' ') || c.contactName || c.email || 'Unnamed'
  const video = (c.customFields ?? []).find((f: Json) => f.id === VIDEO_FIELD_ID)?.value || null
  return {
    id,
    name,
    email: c.email ?? null,
    phone: c.phone ?? null,
    photo: c.profilePhoto ?? null,
    programs: (c.tags ?? []).map((t: string) => PROGRAM_TAGS[t.toLowerCase()]).filter(Boolean),
    ...splitAppointments(appts.events ?? [], timeZone),
    summary: latestNote(notes.notes ?? []),
    videoUrl: video,
    profileUrl: `https://app.tekmatix.com/v2/location/${locationId}/contacts/detail/${id}`,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const token = Deno.env.get('TEKMATIX_API_TOKEN')
  const locationId = Deno.env.get('TEKMATIX_LOCATION_ID') ?? 'UoK8VlrzTaf0VmOFilzH'
  if (!token) return jsonResponse({ error: 'TEKMATIX_API_TOKEN not set' }, 500)
  if (!await isAdmin(req)) return jsonResponse({ error: 'Admins only' }, 403)

  try {
    const api = tekmatix(token)
    const search = await api('/contacts/search', {
      method: 'POST',
      body: JSON.stringify({
        locationId,
        pageLimit: 100,
        filters: [{
          group: 'OR',
          filters: Object.keys(PROGRAM_TAGS).map(tag => ({ field: 'tags', operator: 'contains', value: tag })),
        }],
      }),
    })

    const ids: string[] = (search.contacts ?? []).map((c: Json) => c.id)
    const timeZone = await locationTimeZone(api, locationId)
    const clients = []
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      clients.push(...await Promise.all(ids.slice(i, i + BATCH_SIZE).map(id => loadClient(api, locationId, timeZone, id))))
    }
    return jsonResponse({ clients, fetchedAt: new Date().toISOString() })
  } catch (err) {
    console.error('[tekmatix-clients]', err)
    return jsonResponse({ error: 'Tekmatix request failed' }, 502)
  }
})
