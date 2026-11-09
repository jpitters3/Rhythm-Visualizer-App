// Stripe helpers shared by stripe-webhook and stripe-subscription.

export async function stripeRequest(path: string, params?: Record<string, string>) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: params ? 'POST' : 'GET',
    headers: {
      'Authorization': `Bearer ${Deno.env.get('STRIPE_SECRET_KEY')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params ? new URLSearchParams(params) : undefined,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error?.message || `Stripe ${path} failed`)
  return data
}

// Newer Stripe API versions moved the period end onto the subscription item.
export function periodEnd(sub: any): number | null {
  return sub?.current_period_end ?? sub?.items?.data?.[0]?.current_period_end ?? null
}

export function toIso(seconds: number | null | undefined): string | null {
  return seconds ? new Date(seconds * 1000).toISOString() : null
}

// Profile fields for a live subscription's pause/cancel state, or null if it isn't live.
// Never extends expiry: only a paid invoice does that.
export function subscriptionChanges(sub: any): Record<string, unknown> | null {
  if (sub.status !== 'active' && sub.status !== 'trialing') return null
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
  return changes
}
