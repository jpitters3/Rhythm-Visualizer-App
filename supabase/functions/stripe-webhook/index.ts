// stripe-webhook/index.ts
// Zero-dependency implementation for signing verification and database updates
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')

  if (!stripeKey || !webhookSecret) {
    return new Response('Server configuration missing', { status: 500 })
  }

  const signatureHeader = req.headers.get('stripe-signature')
  if (!signatureHeader) {
    return new Response('Missing signature', { status: 400 })
  }

  try {
    const rawBody = await req.text()

    // 1. Manually Verify Stripe Signature (Zero Dependency)
    // Stripe signature format: t=xxx,v1=yyy
    const parts = signatureHeader.split(',')
    const timestamp = parts.find((p: string) => p.startsWith('t='))?.split('=')[1]
    const signature = parts.find((p: string) => p.startsWith('v1='))?.split('=')[1]

    if (!timestamp || !signature) {
      console.error('[stripe-webhook] Missing timestamp or signature in header')
      throw new Error('Invalid signature format')
    }

    // Prepare message for HMAC
    const signedPayload = `${timestamp}.${rawBody}`
    const encoder = new TextEncoder()
    const keyData = encoder.encode(webhookSecret)
    const messageData = encoder.encode(signedPayload)

    // Import key for HMAC-SHA256
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    )

    // Convert hex signature to buffer
    const signatureBuffer = new Uint8Array(
      signature.match(/.{1,2}/g)!.map((byte: string) => parseInt(byte, 16))
    )

    // Verify
    const isValid = await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBuffer,
      messageData
    )

    console.log('[stripe-webhook] Signature verification result:', isValid)

    if (!isValid) {
      console.error('[stripe-webhook] Invalid signature. Payload was:', rawBody)
      return new Response('Invalid signature', { status: 401 })
    }

    // 2. Process the Event
    const event = JSON.parse(rawBody)
    console.log('[stripe-webhook] Processing event type:', event.type)

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SERVICE_ROLE_KEY')!)
    const getSubscription = async (id: string) => {
      const res = await fetch(`https://api.stripe.com/v1/subscriptions/${id}`, {
        headers: { 'Authorization': `Bearer ${stripeKey}` }
      })
      return res.json()
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object
      const userId = session.metadata?.supabase_user_id
      const customerId = session.customer
      const subscriptionId = session.subscription

      if (userId) {
        const sub = subscriptionId ? await getSubscription(subscriptionId) : null
        const expiresAt = toIso(sub && periodEnd(sub))

        const { error } = await supabase
          .from('profiles')
          .update({
            subscription_tier: 'player_plus',
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId ?? null,
            subscription_status: 'active',
            subscription_source: 'stripe',
            subscription_resumes_at: null,
            ...(expiresAt && { subscription_expires_at: expiresAt }),
          })
          .eq('user_id', userId)

        if (error) throw error
        console.log(`[stripe-webhook] Upgraded ${userId}, expires ${expiresAt}`)
      }
    }

    // Only a successful payment extends access, so paused or unpaid periods never do.
    if (event.type === 'invoice.payment_succeeded') {
      const invoice = event.data.object
      const customerId = invoice.customer
      const subscriptionId = invoice.subscription ?? invoice.parent?.subscription_details?.subscription

      if (invoice.billing_reason === 'subscription_cycle' && customerId && subscriptionId) {
        const expiresAt = toIso(periodEnd(await getSubscription(subscriptionId)))

        if (expiresAt) {
          const { error } = await matchSubscription(
            supabase.from('profiles').update({
              subscription_expires_at: expiresAt,
              subscription_status: 'active',
              stripe_subscription_id: subscriptionId,
              subscription_resumes_at: null,
            }),
            customerId, subscriptionId)

          if (error) throw error
          console.log(`[stripe-webhook] Renewed customer ${customerId}, expires ${expiresAt}`)
        }
      }
    }

    // Cancel at period end, undo cancel, pause and resume all arrive here.
    // Only Stripe-sourced rows: a Tekmatix program grant must survive a lapsed Stripe sub.
    if (event.type === 'customer.subscription.updated') {
      const sub = event.data.object
      if (sub.status === 'active' || sub.status === 'trialing') {
        const changes: Record<string, unknown> = { stripe_subscription_id: sub.id, subscription_resumes_at: null }
        if (sub.pause_collection) {
          changes.subscription_status = 'paused'
          changes.subscription_resumes_at = toIso(sub.pause_collection.resumes_at)
        } else if (sub.cancel_at_period_end || sub.cancel_at) {
          changes.subscription_status = 'canceling'
          changes.subscription_expires_at = toIso(sub.cancel_at ?? periodEnd(sub))
        } else {
          changes.subscription_status = 'active'
        }

        const { error } = await matchSubscription(
          supabase.from('profiles').update(changes).eq('subscription_source', 'stripe'), sub.customer, sub.id)
        if (error) throw error
        console.log(`[stripe-webhook] Subscription ${sub.id} is ${changes.subscription_status}`)
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object
      const { error } = await matchSubscription(
        supabase.from('profiles').update({
          subscription_tier: 'player',
          subscription_status: 'canceled',
          subscription_expires_at: new Date().toISOString(),
          subscription_resumes_at: null,
        }).eq('subscription_source', 'stripe'),
        sub.customer, sub.id)
      if (error) throw error
      console.log(`[stripe-webhook] Subscription ${sub.id} ended`)
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (err: any) {
    console.error(`[stripe-webhook] Error: ${err.message}`)
    return new Response(`Error: ${err.message}`, { status: 400 })
  }
})

// Newer Stripe API versions moved the period end onto the subscription item.
function periodEnd(sub: any): number | null {
  return sub?.current_period_end ?? sub?.items?.data?.[0]?.current_period_end ?? null
}

function toIso(seconds: number | null | undefined): string | null {
  return seconds ? new Date(seconds * 1000).toISOString() : null
}

// Rows saved before stripe_subscription_id existed match on the customer alone.
function matchSubscription(query: any, customerId: string, subscriptionId: string) {
  return query
    .eq('stripe_customer_id', customerId)
    .or(`stripe_subscription_id.is.null,stripe_subscription_id.eq.${subscriptionId}`)
}
