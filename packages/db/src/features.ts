import type { Tier } from '@prisma/client';

export type FeatureKey =
  | 'PUBLIC_SITE' | 'GALLERY' | 'ENQUIRY' | 'SOCIAL'
  | 'ABOUT_CONTACT' | 'EVENTS' | 'MANAGEMENT' | 'BLOG' | 'HIRING' | 'LIBRARY';

const ALL_KEYS: FeatureKey[] = ['PUBLIC_SITE','GALLERY','ENQUIRY','SOCIAL','ABOUT_CONTACT','EVENTS','MANAGEMENT','BLOG','HIRING','LIBRARY'];
const isFeatureKey = (k: string): k is FeatureKey => (ALL_KEYS as string[]).includes(k);

const BASIC: FeatureKey[] = ['PUBLIC_SITE', 'GALLERY', 'ENQUIRY', 'SOCIAL'];
const STANDARD: FeatureKey[] = [...BASIC, 'ABOUT_CONTACT', 'EVENTS', 'BLOG'];
/**
 * LIBRARY is deliberately in NO tier's default set — not even PRO.
 *
 * A large minority of 300–1500-student Indian schools have a room with books
 * and no circulation at all: a cupboard, a bound register, and a teacher who
 * opens it on Saturdays. Shipping them a Library tab makes the product look
 * unfinished, and it makes the schools that DO run a library look like they got
 * a default rather than something they chose. It is switched on per school from
 * the owner console via the existing featureOverrides path.
 *
 * Note this is only the FIRST of two gates. The student and teacher menu items
 * additionally require the library to be live — a librarian assigned and at
 * least one book on the shelf — because the gap between "admin ticked Library"
 * and "there are books in it" is weeks of real work, and a tab opening onto an
 * empty screen is the impression every student forms of the feature.
 */
const PRO: FeatureKey[] = [...STANDARD, 'MANAGEMENT', 'HIRING'];

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
