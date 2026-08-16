import type { Tier } from '@prisma/client';

export type FeatureKey =
  | 'PUBLIC_SITE' | 'GALLERY' | 'ENQUIRY' | 'SOCIAL'
  | 'ABOUT_CONTACT' | 'EVENTS' | 'MANAGEMENT' | 'BLOG' | 'HIRING' | 'LIBRARY';

const ALL_KEYS: FeatureKey[] = ['PUBLIC_SITE','GALLERY','ENQUIRY','SOCIAL','ABOUT_CONTACT','EVENTS','MANAGEMENT','BLOG','HIRING','LIBRARY'];
const isFeatureKey = (k: string): k is FeatureKey => (ALL_KEYS as string[]).includes(k);

const BASIC: FeatureKey[] = ['PUBLIC_SITE', 'GALLERY', 'ENQUIRY', 'SOCIAL'];
const STANDARD: FeatureKey[] = [...BASIC, 'ABOUT_CONTACT', 'EVENTS', 'BLOG'];
const PRO: FeatureKey[] = [...STANDARD, 'MANAGEMENT', 'HIRING', 'LIBRARY'];

export const TIER_FEATURES: Record<Tier, FeatureKey[]> = {
  BASIC, STANDARD, PRO,
};

export function resolveFeatures(
  tier: Tier,
  overrides: { featureKey: string; enabled: boolean }[],
): Set<FeatureKey> {
  const set = new Set<FeatureKey>(TIER_FEATURES[tier]);
  for (const o of overrides) {
    if (!isFeatureKey(o.featureKey)) continue;
    if (o.enabled) set.add(o.featureKey);
    else set.delete(o.featureKey);
  }
  return set;
}
