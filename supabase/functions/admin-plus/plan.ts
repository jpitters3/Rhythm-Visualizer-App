// Rules for setting a client's Plus access by hand from the Clients page.
// Free of Deno/Supabase imports so tests/admin-plus.spec.js can run it.

export interface Profile {
  username?: string | null
  subscription_tier?: string | null
  subscription_status?: string | null
  subscription_source?: string | null
  subscription_expires_at?: string | null
}

export interface AdminRequest {
  tier: 'player_plus' | 'pro' | 'none'
  expiresAt?: string
}

export class PlanError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

const PLUS_TIERS = ['player_plus', 'pro']
const MAX_DAYS = 5 * 366

function hasPlus(p: Profile, now: Date) {
  if (!PLUS_TIERS.includes(p.subscription_tier ?? '')) return false
  return !p.subscription_expires_at || new Date(p.subscription_expires_at) > now
}

// What the Clients page shows for an account.
export function accessSummary(p: Profile, now = new Date()) {
  return {
    username: p.username ?? null,
    tier: p.subscription_tier ?? 'player',
    expiresAt: p.subscription_expires_at ?? null,
    source: p.subscription_source ?? null,
    active: hasPlus(p, now),
    stripe: p.subscription_source === 'stripe' && hasPlus(p, now),
  }
}

// The profile update to apply, or null when nothing changes. Grants are
// recorded like Tekmatix program access, so removing the client tag ends them.
export function planAdminChange(profile: Profile, req: AdminRequest, now = new Date()) {
  if (profile.subscription_source === 'stripe' && hasPlus(profile, now)) {
    throw new PlanError('This member pays through Stripe; manage it in Stripe instead.', 409)
  }

  if (req.tier === 'none') {
    if (!hasPlus(profile, now)) return null
    return { subscription_status: 'canceled', subscription_expires_at: now.toISOString() }
  }

  if (!PLUS_TIERS.includes(req.tier)) throw new PlanError('tier must be player_plus, pro or none')
  const until = new Date(req.expiresAt ?? '')
  if (isNaN(until.getTime())) throw new PlanError('Pick an end date.')
  if (until <= now) throw new PlanError('The end date must be in the future.')
  if (until.getTime() - now.getTime() > MAX_DAYS * 86400000) throw new PlanError('The end date must be within 5 years.')

  return {
    subscription_tier: req.tier,
    subscription_status: 'active',
    subscription_source: 'tekmatix',
    subscription_expires_at: until.toISOString(),
  }
}
