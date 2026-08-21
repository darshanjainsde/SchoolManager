import type { Tier } from '@prisma/client';
export type FeatureKey = 'PUBLIC_SITE' | 'GALLERY' | 'ENQUIRY' | 'SOCIAL' | 'ABOUT_CONTACT' | 'EVENTS' | 'MANAGEMENT' | 'BLOG' | 'HIRING';
export declare const TIER_FEATURES: Record<Tier, FeatureKey[]>;
export declare function resolveFeatures(tier: Tier, overrides: {
    featureKey: string;
    enabled: boolean;
}[]): Set<FeatureKey>;
//# sourceMappingURL=features.d.ts.map