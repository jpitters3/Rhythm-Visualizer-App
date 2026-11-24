/**
 * admin-plus
 *
 * Admin-only Panafide access for the Clients page (js/clients.js):
 *   { action: 'lookup', emails: string[] }  → { accounts: { [email]: summary | null } }
 *   { action: 'set', email, tier: 'player_plus' | 'pro' | 'none', expiresAt? }
 *                                            → { account: summary }
 * Rules live in plan.ts. Deploy with JWT verification on.
 */

import { isAdmin, serviceClient } from '../_shared/admin.ts'
import { accessSummary, planAdminChange, PlanError } from './plan.ts'

const MAX_LOOKUP = 200
const PROFILE_FIELDS = 'username, subscription_tier, subscription_status, subscription_source, subscription_expires_at'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

type Supabase = ReturnType<typeof serviceClient>

async function findProfile(supabase: Supabase, email: string) {
  const { data: userId, error } = await supabase.rpc('user_id_by_email', { p_email: email })
  if (error) throw error
  if (!userId) return null
  const { data: profile, error: profileError } = await supabase
    .from('profiles').select(PROFILE_FIELDS).eq('user_id', userId).maybeSingle()
  if (profileError) throw profileError
  return profile ? { userId: userId as string, profile } : null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (!await isAdmin(req)) return reply({ error: 'Admins only' }, 403)

  let body: any
  try {
    body = await req.json()
  } catch {
    return reply({ error: 'Invalid JSON' }, 400)
  }

  const supabase = serviceClient()
  const clean = (e: unknown) => String(e ?? '').trim().toLowerCase()

  try {
    if (body?.action === 'lookup') {
      const emails = [...new Set((Array.isArray(body.emails) ? body.emails : []).map(clean).filter(Boolean))]
      if (emails.length > MAX_LOOKUP) return reply({ error: `At most ${MAX_LOOKUP} emails` }, 400)
      const found = await Promise.all(emails.map(email => findProfile(supabase, email)))
      const accounts = Object.fromEntries(emails.map((email, i) => [email, found[i] ? accessSummary(found[i]!.profile) : null]))
      return reply({ accounts })
    }

    if (body?.action === 'set') {
      const email = clean(body.email)
      if (!email) return reply({ error: 'Missing email' }, 400)
      const found = await findProfile(supabase, email)
      if (!found) return reply({ error: 'No Panafide account uses this email yet.' }, 404)

      const update = planAdminChange(found.profile, { tier: body.tier, expiresAt: body.expiresAt })
      if (!update) return reply({ account: accessSummary(found.profile) })

      const { data: saved, error } = await supabase
        .from('profiles').update(update).eq('user_id', found.userId).select(PROFILE_FIELDS).single()
      if (error) throw error
      console.log('[admin-plus] set', email, update)
      return reply({ account: accessSummary(saved) })
    }

    return reply({ error: 'action must be lookup or set' }, 400)
  } catch (err) {
    if (err instanceof PlanError) return reply({ error: err.message }, err.status)
    console.error('[admin-plus]', err)
    return reply({ error: 'Something went wrong' }, 500)
  }
})
