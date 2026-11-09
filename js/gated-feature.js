import { currentUser, isAdminUser } from './state.js';
import { currentProfile } from './profile.js';

// Paid tiers in order; a tier unlocks everything below it.
export const TIER_RANK = { player: 0, player_plus: 1, pro: 2 };

// How many a free member can save; the plans table shows the same numbers.
export const FREE_LIMIT = { unlimited_patterns: 5, unlimited_compositions: 1, custom_scales: 1 };

class GatedFeature {
  constructor(slug, name, tier = 'player_plus') {
    this.slug = slug;
    this.name = name;
    this.tier = tier;
  }
  getName() { return this.name; }
  getSlug() { return this.slug; }
  toString() { return this.slug; }
}

export const FEATURE = {
  AI_ASSISTANT: new GatedFeature('ai_assistant', 'AI Assistant', 'pro'),
  CUSTOM_SCALES: new GatedFeature('custom_scales', 'Custom Handpan Scales'),
  UNLIMITED_PATTERNS: new GatedFeature('unlimited_patterns', 'Unlimited Phrases'),
  MIDI_EXPORT: new GatedFeature('midi_export', 'MIDI Export'),
  DOWNLOAD_WAV: new GatedFeature('download_wav', 'Download Audio'),
  UNLIMITED_COMPOSITIONS: new GatedFeature('unlimited_compositions', 'Unlimited Compositions'),
  COACHING_MODE: new GatedFeature('coaching_mode', 'Coach Mode'),
  PAN_HERO: new GatedFeature('pan_hero', 'Pan Hero'),
};

// The tier a feature needs: 'player_plus' or 'pro'.
export function requiredTier(feature) {
  const slug = (typeof feature === 'string') ? feature : feature?.slug;
  return Object.values(FEATURE).find(f => f.slug === slug)?.tier ?? 'player_plus';
}

export function activeTierRank() {
  const tier = currentProfile?.subscription_tier || 'player';
  const expiresAt = currentProfile?.subscription_expires_at;
  if (expiresAt && new Date(expiresAt) < new Date()) return 0;
  return TIER_RANK[tier] ?? 0;
}

export function canAccess(feature, context = {}) {
  const slug = (typeof feature === 'string') ? feature : feature?.slug;
  if (!slug) return true;

  if (isAdminUser(currentUser)) return true;

  // TEST BYPASS: If in automated test mode
  if (document.documentElement.getAttribute('data-gp-test-mode') === 'true') return true;

  if (activeTierRank() >= TIER_RANK[requiredTier(slug)]) return true;

  const accessMap = {
    'ai_assistant': false,
    'midi_export': false,
    'download_wav': false,
    'coaching_mode': false,
    'pan_hero': false,
    'custom_scales': (context.count || 0) < FREE_LIMIT.custom_scales,
    'unlimited_patterns': (context.count || 0) < FREE_LIMIT.unlimited_patterns,
    'unlimited_compositions': (context.count || 0) < FREE_LIMIT.unlimited_compositions,
  };

  return accessMap[slug] ?? true;
}