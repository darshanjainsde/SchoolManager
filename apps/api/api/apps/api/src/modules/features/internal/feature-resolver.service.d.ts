import { type FeatureKey } from '@skoolos/db';
import type { Tier } from '@skoolos/db';
export declare class FeatureResolverService {
    private readonly env;
    private readonly redis;
    private static readonly TTL;
    /** Pure merge — unit-testable without IO. */
    computeFor(tier: Tier, overrides: {
        featureKey: string;
        enabled: boolean;
    }[]): Set<FeatureKey>;
    getFeatures(schoolId: string): Promise<Set<FeatureKey>>;
    invalidate(schoolId: string): Promise<void>;
    private connect;
}
//# sourceMappingURL=feature-resolver.service.d.ts.map