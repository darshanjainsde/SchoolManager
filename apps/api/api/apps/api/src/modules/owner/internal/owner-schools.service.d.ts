import { PasswordService } from '../../auth';
import { FeatureResolverService } from '../../features';
import { StorageService } from '../../../common/storage/storage.service';
import { CreateSchoolDto } from './owner.dto';
export interface StatsResponse {
    schools: {
        total: number;
        byTier: {
            BASIC: number;
            STANDARD: number;
            PRO: number;
        };
        live: number;
        suspended: number;
    };
    domains: {
        live: number;
    };
}
export interface SchoolRow {
    id: string;
    name: string;
    slug: string;
    tier: 'BASIC' | 'STANDARD' | 'PRO';
    status: string;
    primaryDomain: string | null;
    features: string[];
}
export interface SchoolDetail extends SchoolRow {
    domains: {
        hostname: string;
        status: string;
        isPrimary: boolean;
    }[];
}
export declare class OwnerSchoolsService {
    private readonly featureResolver;
    private readonly passwords;
    private readonly storage;
    private readonly logger;
    constructor(featureResolver: FeatureResolverService, passwords: PasswordService, storage: StorageService);
    /**
     * Permanently removes a school and everything under it. Guarded to
     * SUSPENDED schools so deletion is always a deliberate two-step
     * (suspend → delete). DB rows cascade from School; uploaded files are
     * removed best-effort; the tenant-lookup cache expires on its own TTL.
     */
    deleteSchool(id: string): Promise<{
        ok: true;
    }>;
    stats(): Promise<StatsResponse>;
    list(): Promise<SchoolRow[]>;
    detail(id: string): Promise<SchoolDetail>;
    create(dto: CreateSchoolDto): Promise<{
        id: string;
        slug: string;
        tempPassword: string;
    }>;
    setTier(id: string, tier: 'BASIC' | 'STANDARD' | 'PRO'): Promise<SchoolDetail>;
    /**
     * Publish / unpublish a school. The public site (`getSite`) reads `status`
     * fresh per request, so the change takes effect immediately — no cache flush
     * needed for the SETUP→LIVE (go-live) path.
     */
    setStatus(id: string, status: 'SETUP' | 'LIVE' | 'SUSPENDED'): Promise<SchoolDetail>;
    setFeature(id: string, featureKey: string, enabled: boolean): Promise<SchoolDetail>;
}
//# sourceMappingURL=owner-schools.service.d.ts.map