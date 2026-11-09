// stripe-subscription/index.ts
// A member manages their own Stripe subscription: pause, resume, renew, cancel, billing portal.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { periodEnd, stripeRequest, subscriptionChanges, toIso } from '../_shared/stripe.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const authClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    })
    const { data: { user } } = await authClient.auth.getUser()
    if (!user) return json({ error: 'Not signed in' }, 401)

    const admin = createClient(supabaseUrl, Deno.env.get('SERVICE_ROLE_KEY')!)
    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('stripe_customer_id, stripe_subscription_id, subscription_expires_at')
      .eq('user_id', user.id)
      .single()
    if (profileError) throw profileError
    if (!profile?.stripe_customer_id) return json({ error: 'No Stripe subscription' }, 404)

    const { action, months, returnUrl } = await req.json()
    const customer = profile.stripe_customer_id

    if (action === 'portal') {
      const session = await stripeRequest('billing_portal/sessions', {
        customer,
        return_url: `${returnUrl}?subscription=updated`,
      })
      return json({ url: session.url })
    }

    const sub = await findSubscription(customer, profile.stripe_subscription_id)
    if (!sub) return json({ error: 'No active subscription' }, 404)

    const saveProfile = async (changes: Record<string, unknown> | null) => {
      if (!changes) return
      const { error } = await admin.from('profiles').update(changes)
        .eq('user_id', user.id).eq('subscription_source', 'stripe')
      if (error) throw error
    }

    if (action === 'sync') {
      await saveProfile(subscriptionChanges(sub))
      return json({ ok: true })
    }

    if (action === 'cancel') {
      // Stripe's cancel page; it offers the retention coupon before confirming.
      const params: Record<string, string> = {
        customer,
        return_url: `${returnUrl}?subscription=updated`,
        'flow_data[type]': 'subscription_cancel',
        'flow_data[subscription_cancel][subscription]': sub.id,
        'flow_data[after_completion][type]': 'redirect',
        'flow_data[after_completion][redirect][return_url]': `${returnUrl}?subscription=canceled`,
      }
      const coupon = Deno.env.get('STRIPE_RETENTION_COUPON')
      if (coupon) {
        // The offer is once per customer; if Stripe rejects it, cancel without it.
        const session = await stripeRequest('billing_portal/sessions', {
          ...params,
          'flow_data[subscription_cancel][retention][type]': 'coupon_offer',
          'flow_data[subscription_cancel][retention][coupon_offer][coupon]': coupon,
        }).catch((err) => {
          console.warn('[stripe-subscription] Retention offer skipped:', err.message)
          return null
        })
        if (session) return json({ url: session.url })
      }
      const session = await stripeRequest('billing_portal/sessions', params)
      return json({ url: session.url })
    }

    if (action === 'pause') {
      const count = Number(months)
      if (![1, 2, 3].includes(count)) return json({ error: 'Pause for 1, 2 or 3 months' }, 400)
      // Keeps the paid-for time; billing restarts N months after it ends.
      // An hour early so the renewal on that date isn't voided by the pause.
      const resumes = new Date(periodEnd(sub)! * 1000)
      resumes.setUTCMonth(resumes.getUTCMonth() + count)
      resumes.setUTCHours(resumes.getUTCHours() - 1)
      const updated = await stripeRequest(`subscriptions/${sub.id}`, {
        'pause_collection[behavior]': 'void',
        'pause_collection[resumes_at]': String(Math.floor(resumes.getTime() / 1000)),
        cancel_at_period_end: 'false',
      })
      await saveProfile(subscriptionChanges(updated))
      return json({ ok: true })
    }

    if (action === 'resume') {
      const lapsed = !profile.subscription_expires_at || new Date(profile.subscription_expires_at) <= new Date()
      // Lapsed: charge now and start a new period; fails cleanly if the card is declined.
      const updated = await stripeRequest(`subscriptions/${sub.id}`, {
        pause_collection: '',
        ...(lapsed && {
          billing_cycle_anchor: 'now',
          proration_behavior: 'none',
          payment_behavior: 'error_if_incomplete',
        }),
      })
      const changes = subscriptionChanges(updated)
      if (changes && lapsed) changes.subscription_expires_at = toIso(periodEnd(updated))
      await saveProfile(changes)
      return json({ ok: true })
    }

    if (action === 'renew') {
      const updated = await stripeRequest(`subscriptions/${sub.id}`, { cancel_at_period_end: 'false' })
      const changes = subscriptionChanges(updated)
      if (changes) changes.subscription_expires_at = toIso(periodEnd(updated))
      await saveProfile(changes)
      return json({ ok: true })
    }

    return json({ error: 'Unknown action' }, 400)
  } catch (err: any) {
    console.error('[stripe-subscription] Error:', err.message)
    return json({ error: err.message }, 400)
  }
})

// The saved subscription if it's still live, otherwise the customer's live one.
async function findSubscription(customer: string, savedId: string | null) {
  const live = (s: any) => s && s.customer === customer && ['active', 'trialing', 'past_due'].includes(s.status)
  if (savedId) {
    const saved = await stripeRequest(`subscriptions/${savedId}`).catch(() => null)
    if (live(saved)) return saved
  }
  const list = await stripeRequest(`subscriptions?customer=${customer}&status=all&limit=10`)
  return list.data.find(live) ?? null
}
