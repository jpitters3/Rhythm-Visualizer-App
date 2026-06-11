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

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object
      const userId = session.metadata?.supabase_user_id
      const customerId = session.customer
      const subscriptionId = session.subscription

      if (userId) {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!
        const supabaseServiceKey = Deno.env.get('SERVICE_ROLE_KEY')!
        const supabase = createClient(supabaseUrl, supabaseServiceKey)

        // Fetch subscription period end from Stripe
        let expiresAt: string | null = null
        if (subscriptionId) {
          const subRes = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
            headers: { 'Authorization': `Bearer ${stripeKey}` }
          })
          const sub = await subRes.json()
          if (sub.current_period_end) {
            expiresAt = new Date(sub.current_period_end * 1000).toISOString()
          }
        }

        const { error } = await supabase
          .from('profiles')
          .update({
            subscription_tier: 'player_plus',
            stripe_customer_id: customerId,
            subscription_status: 'active',
            subscription_source: 'stripe',
            ...(expiresAt && { subscription_expires_at: expiresAt }),
          })
          .eq('user_id', userId)

        if (error) throw error
        console.log(`[stripe-webhook] Upgraded ${userId}, expires ${expiresAt}`)
      }
    }

    // Renew expiry on each billing cycle
    if (event.type === 'invoice.payment_succeeded') {
      const invoice = event.data.object
      if (invoice.billing_reason !== 'subscription_cycle') return new Response(JSON.stringify({ received: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })

      const customerId = invoice.customer
      const subscriptionId = invoice.subscription

      if (customerId && subscriptionId) {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!
        const supabaseServiceKey = Deno.env.get('SERVICE_ROLE_KEY')!
        const supabase = createClient(supabaseUrl, supabaseServiceKey)

        const subRes = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
          headers: { 'Authorization': `Bearer ${stripeKey}` }
        })
        const sub = await subRes.json()
        const expiresAt = sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
          : null

        if (expiresAt) {
          const { error } = await supabase
            .from('profiles')
            .update({ subscription_expires_at: expiresAt, subscription_status: 'active' })
            .eq('stripe_customer_id', customerId)

          if (error) throw error
          console.log(`[stripe-webhook] Renewed customer ${customerId}, expires ${expiresAt}`)
        }
      }
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
