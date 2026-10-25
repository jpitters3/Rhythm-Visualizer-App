/**
 * sync-tekmatix
 *
 * Sends a Panafide user's contact details to the Tekmatix "Web App User
 * Update" inbound-webhook workflow, which upserts the contact by email.
 * Called by the triggers in 20261025000000_tekmatix_sync.sql and by
 * scripts/backfill-tekmatix.js. Body: { user_id }. Fresh data is read from
 * the DB rather than trusted from the request.
 *
 * Secrets: TEKMATIX_WEBHOOK_URL, TEKMATIX_SYNC_SECRET (must match the
 * vault secret tekmatix_sync_secret). Deploy with --no-verify-jwt.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const PROFILE_FIELDS = 'first_name, last_name, username, role, subscription_tier, subscription_status, subscription_expires_at, handpan_scale'

// Empty values are left out so a blank Panafide field can't wipe data
// Tekmatix already has (e.g. a name imported from Podia).
function withoutEmpty(obj: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined && v !== ''))
}

Deno.serve(async (req) => {
  const syncSecret = Deno.env.get('TEKMATIX_SYNC_SECRET')
  const webhookUrl = Deno.env.get('TEKMATIX_WEBHOOK_URL')
  if (!syncSecret || !webhookUrl) {
    return new Response('Server configuration missing', { status: 500 })
  }
  if (req.headers.get('x-sync-secret') !== syncSecret) {
    return new Response('Unauthorized', { status: 401 })
  }

  let userId: string | undefined
  try {
    userId = (await req.json())?.user_id
  } catch {
    // handled below
  }
  if (!userId) return new Response('Missing user_id', { status: 400 })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const [profileResult, authResult] = await Promise.all([
    supabase.from('profiles').select(PROFILE_FIELDS).eq('user_id', userId).maybeSingle(),
    supabase.auth.admin.getUserById(userId),
  ])
  if (profileResult.error || authResult.error) {
    console.error('[sync-tekmatix] lookup failed', userId, profileResult.error ?? authResult.error)
    return new Response('Lookup failed', { status: 500 })
  }

  const profile = profileResult.data
  const user = authResult.data?.user
  if (!profile || !user?.email) {
    return new Response('User not found', { status: 404 })
  }

  const payload = withoutEmpty({
    event: 'user.updated',
    panafide_user_id: userId,
    email: user.email,
    first_name: profile.first_name,
    last_name: profile.last_name,
    username: profile.username,
    role: profile.role,
    subscription_tier: profile.subscription_tier,
    subscription_status: profile.subscription_status,
    subscription_expires_at: profile.subscription_expires_at,
    handpan_scale: profile.handpan_scale,
    signed_up_at: user.created_at,
  })

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    console.error('[sync-tekmatix] Tekmatix rejected update', userId, res.status, await res.text())
    return new Response('Tekmatix rejected the update', { status: 502 })
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
