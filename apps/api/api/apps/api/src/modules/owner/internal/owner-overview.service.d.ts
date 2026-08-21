export interface SchoolMetrics {
    id: string;
    name: string;
    slug: string;
    tier: 'BASIC' | 'STANDARD' | 'PRO';
    status: string;
    primaryDomain: string | null;
    storageBytes: number;
    enquiries: number;
    newEnquiries: number;
    events: number;
    students: number;
    images: number;
}
export interface OverviewResponse {
    totals: {
        schools: number;
        live: number;
        storageBytes: number;
        enquiriesThisMonth: number;
        newLeads: number;
        students: number;
        images: number;
    };
    schools: SchoolMetrics[];
}
/** Escapes one CSV field per RFC 4180 (quote when it contains , " or newline). */
export declare function csvField(v: string | null | undefined): string;
export declare class OwnerOverviewService {
    private readonly env;
    private readonly redis;
    private static readonly CACHE_KEY;
    private static readonly TTL;
    overview(): Promise<OverviewResponse>;
    private computeOverview;
    /** All of one school's enquiries as a CSV attachment body. */
    enquiriesCsv(schoolId: string): Promise<{
        filename: string;
        body: string;
    }>;
}
//# sourceMappingURL=owner-overview.service.d.ts.map