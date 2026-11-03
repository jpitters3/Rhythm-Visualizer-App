// Decides how a Tekmatix client-tag event changes a profile's Plus access.
// Kept free of Deno/Supabase imports so tests/tekmatix-plus.spec.js can run it.

export const PROGRAM_WEEKS: Record<string, number> = { group: 8, private: 6 }
export const PROGRAM_TIER: Record<string, string> = { group: 'player_plus', private: 'pro' }
const TIER_RANK: Record<string, number> = { player_plus: 1, pro: 2 }

const WEEK_MS = 7 * 86400000

export interface SubscriptionFields {
  subscription_tier?: string | null
  subscription_status?: string | null
  subscription_source?: string | null
  subscription_expires_at?: string | null
}

export interface AccessRequest {
  action: 'grant' | 'revoke'
  program?: string
  weeks?: number
  until?: string
  tier?: string
}

function hasPlus(p: SubscriptionFields, now: Date) {
  const tier = p.subscription_tier
  if (tier !== 'player_plus' && tier !== 'pro') return false
  return !p.subscription_expires_at || new Date(p.subscription_expires_at) > now
}

// Returns the profile update to apply, or null to leave the profile alone.
export function planAccessChange(
  profile: SubscriptionFields,
  req: AccessRequest,
  now = new Date(),
): SubscriptionFields | null {
  // A paying Stripe member is never touched by a tag.
  if (profile.subscription_source === 'stripe' && hasPlus(profile, now)) return null

  if (req.action === 'revoke') {
    if (profile.subscription_source !== 'tekmatix' || !hasPlus(profile, now)) return null
    return { subscription_status: 'canceled', subscription_expires_at: now.toISOString() }
  }

  const weeks = req.weeks ?? PROGRAM_WEEKS[req.program ?? '']
  let target: Date
  if (req.until) {
    target = new Date(req.until)
  } else if (weeks && weeks > 0) {
    target = new Date(now.getTime() + weeks * WEEK_MS)
  } else {
    throw new Error('grant needs a program, weeks or until')
  }
  if (isNaN(target.getTime())) throw new Error('until is not a valid date')

  let tier = req.tier ?? PROGRAM_TIER[req.program ?? ''] ?? 'player_plus'
  if (!TIER_RANK[tier]) throw new Error('tier must be player_plus or pro')

  // Never shorten or downgrade access already granted by an earlier lesson or
  // cycle (e.g. a private student who also joins a group keeps Pro).
  const active = profile.subscription_source === 'tekmatix' && hasPlus(profile, now)
  if (active) {
    const current = new Date(profile.subscription_expires_at!)
    if (current >= target) target = current
    const currentTier = profile.subscription_tier ?? ''
    if ((TIER_RANK[currentTier] ?? 0) > TIER_RANK[tier]) tier = currentTier
  }

  return {
    subscription_tier: tier,
    subscription_status: 'active',
    subscription_source: 'tekmatix',
    subscription_expires_at: target.toISOString(),
  }
}
