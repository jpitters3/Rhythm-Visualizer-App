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
    const { userId, email, returnUrl } = await req.json()
    
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
    const priceId = Deno.env.get('STRIPE_PRICE_ID_PRO')

    if (!stripeKey || !priceId) {
      throw new Error('Missing Stripe configuration')
    }

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
