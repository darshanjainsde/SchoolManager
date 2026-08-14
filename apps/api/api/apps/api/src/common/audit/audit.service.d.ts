export interface AuditEntry {
    schoolId: string | null;
    actorUserId: string | null;
    action: string;
    entity: string;
    entityId?: string | null;
    meta?: Record<string, unknown> | null;
}
/**
 * Writes audit rows via the platform Prisma client so a tenant connection
 * (and its RLS rules) never blocks an audit insert.
 */
export declare class AuditService {
    private readonly logger;
    record(entry: AuditEntry): Promise<void>;
}
//# sourceMappingURL=audit.service.d.ts.map