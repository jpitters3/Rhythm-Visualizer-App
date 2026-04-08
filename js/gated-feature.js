import { currentUser, isAdminUser } from './state.js';
import { currentProfile } from './profile.js';

class GatedFeature {
  constructor(slug, name) {
    this.slug = slug;
    this.name = name;
  }
  getName() { return this.name; }
  getSlug() { return this.slug; }
  toString() { return this.slug; }
}

export const FEATURE = {
  AI_ASSISTANT: new GatedFeature('ai_assistant', 'AI Assistant'),
  CUSTOM_SCALES: new GatedFeature('custom_scales', 'Custom Handpan Scales'),
  UNLIMITED_PATTERNS: new GatedFeature('unlimited_patterns', 'Unlimited Cloud Patterns'),
  MIDI_EXPORT: new GatedFeature('midi_export', 'MIDI Export'),
  DOWNLOAD_WAV: new GatedFeature('download_wav', 'Download Audio')
};

export function canAccess(feature, context = {}) {
  const slug = (typeof feature === 'string') ? feature : feature?.slug;
  if (!slug) return true;

  if (isAdminUser(currentUser)) return true;

  // TEST BYPASS: If in automated test mode
  if (document.documentElement.getAttribute('data-gp-test-mode') === 'true') return true;

  const tier = currentProfile?.subscription_tier || 'player';
  if (tier === 'player_plus' || tier === 'pro') return true; // 'pro' retained for legacy rows

  const accessMap = {
    'ai_assistant': false,
    'custom_scales': false,
    'midi_export': false,
    'download_wav': false,
    'unlimited_patterns': (context.count || 0) < 5
  };

  return accessMap[slug] ?? true;
}