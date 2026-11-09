/**
 * tekmatix-plus
 *
 * Grants or revokes Panafide Plus from Tekmatix workflow Webhook actions,
 * so client tags (and each attended private lesson) drive access. The
 * contact's email comes from the standard webhook payload; the workflow's
 * Custom Data supplies:
 *   secret   must match TEKMATIX_PLUS_SECRET
 *   action   'grant' | 'revoke'
 *   program  'group' (Panafide+, 8 weeks) | 'private' (Panafide Pro, 6 weeks), or
 *   weeks / until / tier to override the length or tier
 * Rules live in access.ts. Deploy with --no-verify-jwt.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { planAccessChange } from './access.ts'

function reply(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('TEKMATIX_PLUS_SECRET')
  if (!secret) return reply({ error: 'Server configuration missing' }, 500)

  let body: any
  try {
    body = await req.json()
  } catch {
    return reply({ error: 'Invalid JSON' }, 400)
  }

  // Tekmatix nests Custom Data under customData; accept it flat too.
  const custom = body?.customData ?? body ?? {}
  if (custom.secret !== secret) return reply({ error: 'Unauthorized' }, 401)

  const email = String(body?.email ?? body?.contact?.email ?? custom.email ?? '').trim().toLowerCase()
  const action = custom.action
  if (!email) return reply({ error: 'Missing email' }, 400)
  if (action !== 'grant' && action !== 'revoke') return reply({ error: 'action must be grant or revoke' }, 400)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: userId, error: lookupError } = await supabase.rpc('user_id_by_email', { p_email: email })
  if (lookupError) {
    console.error('[tekmatix-plus] lookup failed', email, lookupError)
    return reply({ error: 'Lookup failed' }, 500)
  }
  // Not signed up yet: re-add the tag once they have an account.
  if (!userId) {
    console.log('[tekmatix-plus] no Panafide user for', email)
    return reply({ ok: true, skipped: 'no_user' })
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('subscription_tier, subscription_status, subscription_source, subscription_expires_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (profileError || !profile) {
    console.error('[tekmatix-plus] profile missing', userId, profileError)
    return reply({ ok: true, skipped: 'no_profile' })
  }

  let update
  try {
    update = planAccessChange(profile, {
      action,
      program: custom.program,
      weeks: custom.weeks ? Number(custom.weeks) : undefined,
      until: custom.until || undefined,
      tier: custom.tier || undefined,
    })
  } catch (err) {
    return reply({ error: (err as Error).message }, 400)
  }
  if (!update) return reply({ ok: true, skipped: 'unchanged' })

  const { error: updateError } = await supabase.from('profiles').update(update).eq('user_id', userId)
  if (updateError) {
    console.error('[tekmatix-plus] update failed', userId, updateError)
    return reply({ error: 'Update failed' }, 500)
  }

  console.log('[tekmatix-plus]', action, email, update.subscription_expires_at)
  return reply({ ok: true, ...update })
})
