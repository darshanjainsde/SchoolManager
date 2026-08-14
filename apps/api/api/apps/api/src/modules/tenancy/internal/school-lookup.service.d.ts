type LookupResult = {
    kind: 'tenant';
    schoolId: string;
    schoolSlug: string;
} | {
    kind: 'platform';
} | {
    kind: 'unknown';
};
/**
 * Resolves a request hostname to a tenant. Reads first from Redis cache,
 * falls back to Postgres (slug match or verified Domain), and back-fills
 * the cache. Cache entries are short-TTL'd so domain changes propagate quickly.
 */
export declare class SchoolLookupService {
    private readonly logger;
    private readonly redis;
    private readonly env;
    constructor();
    resolveByHostname(rawHost: string): Promise<LookupResult>;
    /** Invalidate cache for a hostname — called when a domain changes status. */
    invalidate(hostname: string): Promise<void>;
    private lookupInDb;
    private cacheGet;
    private cacheSet;
    private connectIfNeeded;
}
export {};
//# sourceMappingURL=school-lookup.service.d.ts.map