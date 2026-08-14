export interface DirectoryEntry {
    name: string;
    slug: string;
    tier: 'BASIC' | 'STANDARD' | 'PRO';
    host: string;
}
/**
 * Platform-level directory of LIVE schools for the launcher/landing page.
 * This is intentionally cross-tenant, non-tenant-scoped public data (school
 * name, slug, tier, primary host) — so it lives in a platform module and uses
 * getPlatformPrisma, NOT the tenant `public` module (which forbids it).
 */
export declare class DirectoryService {
    listLiveSchools(): Promise<DirectoryEntry[]>;
}
//# sourceMappingURL=directory.service.d.ts.map