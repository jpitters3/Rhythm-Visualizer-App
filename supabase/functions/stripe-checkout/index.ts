// stripe-checkout/index.ts
// Zero-dependency implementation to avoid Node.js compatibility issues in Edge Runtime

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { userId, email, returnUrl, interval = 'month' } = await req.json()
    if (interval !== 'month' && interval !== 'year') throw new Error('interval must be month or year')

    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
    if (!stripeKey) throw new Error('Missing Stripe configuration')

    // Prices are found by lookup key (plus_month / plus_year) so a new price
    // needs no new secret; the old monthly secret is the fallback.
    const lookup = await fetch(`https://api.stripe.com/v1/prices?active=true&lookup_keys[]=plus_${interval}`, {
      headers: { 'Authorization': `Bearer ${stripeKey}` },
    })
    const found = await lookup.json()
    const priceId = found?.data?.[0]?.id ?? (interval === 'month' ? Deno.env.get('STRIPE_PRICE_ID_PLUS') : undefined)
    if (!priceId) throw new Error(`No active price for plus_${interval}`)

    // Call Stripe REST API directly using fetch (No library dependencies)
    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        'customer_email': email,
        'mode': 'subscription',
        'success_url': `${returnUrl}?upgrade=success`,
        'cancel_url': `${returnUrl}?upgrade=cancel`,
        'line_items[0][price]': priceId,
        'line_items[0][quantity]': '1',
        'allow_promotion_codes': 'true',
        'metadata[supabase_user_id]': userId,
      }),
    })

    const session = await response.json()

    if (!response.ok) {
      throw new Error(session.error?.message || 'Stripe API error')
    }

    return new Response(
      JSON.stringify({ url: session.url }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error('[stripe-checkout] Error:', error.message)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
