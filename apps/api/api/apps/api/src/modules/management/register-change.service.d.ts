import type { RegisterChangeRow as SharedRegisterChangeRow } from '@skoolos/types';
import { AuditService } from '../../common/audit/audit.service';
import type { CreateRegisterChangeDto } from './management.dto';
export type { RegisterChangeStatusValue } from '@skoolos/types';
/**
 * The shared `RegisterChangeRow` plus one admin-only field. `reviewedByUserId`
 * is the reviewer's own User.id — real data this service returns and the
 * spec asserts against, but no client screen renders it, so it stays a local
 * intersection instead of widening the contract every importer of
 * `@skoolos/types` pulls in.
 */
export interface RegisterChangeRow extends SharedRegisterChangeRow {
    reviewedByUserId: string | null;
}
/**
 * The request/review lifecycle around a locked register (see
 * `AttendanceService.save`'s past-day lock). A teacher files a
 * `RegisterChangeRequest` explaining why a closed day needs reopening; a
 * SCHOOL_ADMIN approves or rejects it. Approval is the ONLY thing that ever
 * sets `expiresAt` — a PENDING row always has a null `expiresAt` and must
 * never be treated as an unlock (see `AttendanceService.save`'s comment on
 * why the unlock lookup requires `status: 'APPROVED'` explicitly rather than
 * trusting `expiresAt` alone).
 */
export declare class RegisterChangeService {
    private readonly audit;
    constructor(audit: AuditService);
    /** Same rule as taking the register, including substitution cover — see internal/class-access.ts. */
    private requireTeacherFor;
    private static readonly ROW_INCLUDE;
    private static toRow;
    request(schoolId: string, userId: string, dto: CreateRegisterChangeDto): Promise<RegisterChangeRow>;
    mine(schoolId: string, userId: string): Promise<RegisterChangeRow[]>;
    /** How many of the caller's OWN register-change requests are still PENDING —
     *  the other half of the teacher "Requests" badge (see `RequestsController`). */
    pendingCount(schoolId: string, userId: string): Promise<number>;
    pending(schoolId: string): Promise<RegisterChangeRow[]>;
    review(schoolId: string, reviewerUserId: string, id: string, approve: boolean): Promise<RegisterChangeRow>;
}
//# sourceMappingURL=register-change.service.d.ts.map