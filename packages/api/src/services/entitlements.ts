/**
 * Feature entitlements per packaging tier (free / basic / premium).
 *
 * This is the SECOND access axis, orthogonal to plan-guard.ts:
 *   - plan-guard  → "is the account active at all" (lockout / trial / past_due)
 *   - entitlements → "which FEATURES does the tier unlock"
 *
 * Tiers are a linear hierarchy (free < basic < premium), so a feature is
 * gated by the MINIMUM tier that includes it; a tenant has the feature when
 * its tier rank ≥ the feature's required rank. Calendar, channel sync and
 * basic inventory are the free baseline and are intentionally NOT listed here
 * (everyone has them).
 *
 * Single source of truth for: API gating (requireFeature), the frontend
 * (hide/disable + upsell), and the pricing page.
 */
import type { tierEnum } from '@cm/db';

export type Tier = (typeof tierEnum.enumValues)[number]; // 'free' | 'basic' | 'premium'

export type Feature =
  // Basic
  | 'unified_inbox'
  | 'automated_messages'
  | 'cleaning_calendar'
  | 'auto_reviews'
  | 'email_notifications'
  | 'apartment_groups'
  | 'listing_links'
  // Premium
  | 'ai_chatbot'
  | 'dynamic_pricing'
  | 'guest_sms'
  | 'cleaning_sms'
  | 'invoices'
  | 'statistics'
  | 'teammate_roles'
  | 'audit_log'
  | 'website_builder'
  | 'guest_map';

const TIER_RANK: Record<Tier, number> = { free: 0, basic: 1, premium: 2 };

/** Minimum tier that unlocks each feature. */
export const FEATURE_MIN_TIER: Record<Feature, Tier> = {
  // Basic
  unified_inbox: 'basic',
  automated_messages: 'basic',
  cleaning_calendar: 'basic',
  auto_reviews: 'basic',
  email_notifications: 'basic',
  apartment_groups: 'basic',
  listing_links: 'basic',
  // Premium
  ai_chatbot: 'premium',
  dynamic_pricing: 'premium',
  guest_sms: 'premium',
  cleaning_sms: 'premium',
  invoices: 'premium',
  statistics: 'premium',
  teammate_roles: 'premium',
  audit_log: 'premium',
  website_builder: 'premium',
  guest_map: 'premium',
};

/** Hard per-tier limits (null = unlimited). */
export interface TierLimits {
  /** Max connected listings; the free bait is capped to keep it a teaser. */
  maxListings: number | null;
}

export const TIER_LIMITS: Record<Tier, TierLimits> = {
  free: { maxListings: 2 },
  basic: { maxListings: null },
  premium: { maxListings: null },
};

const ALL_FEATURES = Object.keys(FEATURE_MIN_TIER) as Feature[];

/** Whether a tier unlocks a feature. */
export function hasFeature(tier: Tier, feature: Feature): boolean {
  return TIER_RANK[tier] >= TIER_RANK[FEATURE_MIN_TIER[feature]];
}

/** All features unlocked at a tier (for exposing to the frontend). */
export function featuresForTier(tier: Tier): Feature[] {
  return ALL_FEATURES.filter((f) => hasFeature(tier, f));
}

export function limitsForTier(tier: Tier): TierLimits {
  return TIER_LIMITS[tier];
}
