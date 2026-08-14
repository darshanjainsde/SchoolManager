import { type Assignment, type AssignmentList, type AssignmentUploadResponse } from '@skoolos/types';
import { StorageService } from '../../common/storage/storage.service';
import { AttendanceService } from './attendance.service';
import type { CreateAssignmentDto } from './management.dto';
export type { Assignment, AssignmentList, AssignmentUploadResponse };
/**
 * Vercel serverless functions cap a request body at roughly 4.5MB. This is
 * kept comfortably under that (multipart framing adds a little overhead on
 * top of the raw file). The client (web/mobile) enforces the SAME cap
 * BEFORE ever attempting the upload — a request that would 413 must never
 * leave the device — but this server-side check is the one that actually
 * matters: it is what stops a client-side bug or a bypassed UI from ever
 * reaching `StorageService` with an oversized buffer already in memory.
 */
export declare const MAX_ATTACHMENT_BYTES: number;
export declare class AssignmentsService {
    private readonly attendance;
    private readonly storage;
    private readonly logger;
    constructor(attendance: AttendanceService, storage: StorageService);
    /**
     * The SAME ownership rule `ExamsService.assertClassOwned` enforces —
     * copied here rather than shared, matching how every management service
     * that needs this (`AnnouncementsService`, `ExamsService`) owns its own
     * copy rather than importing a shared helper. A TEACHER caller may only
     * act on a class section they actually teach, resolved via
     * `AttendanceService.myClassSections` with `covering` sections excluded
     * (a one-day substitute does not post assignments for a class they cover
     * once). SCHOOL_ADMIN is exempt and always passes.
     */
    private assertClassOwned;
    private static toAssignment;
    /**
     * Validates and stores one attachment via the shared `StorageService`
     * (S3/MinIO — the SAME client `MediaService` uses), under
     * `schools/<id>/assignments/`. Deliberately NOT `MediaService`/
     * `MediaAsset`: that service is scoped to a fixed site-content `kind`
     * taxonomy (LOGO/HERO/GALLERY/…), rejects anything but an image, and
     * (today) carries no `@Roles` guard at all — none of which fits a
     * teacher-facing PDF/image attachment. See `AssignmentsController`'s
     * docstring for the full ACL comparison.
     *
     * Server-side validation never trusts the client: `dto`'s declared
     * mimetype/size are checked again here even though the web/mobile UI also
     * enforces `MAX_ATTACHMENT_BYTES` before ever attempting the request.
     */
    upload(schoolId: string, file: {
        originalname: string;
        buffer: Buffer;
        mimetype: string;
        size: number;
    }): Promise<AssignmentUploadResponse>;
    /**
     * Creates an Assignment for a class section, after confirming the
     * section actually belongs to this school. A TEACHER caller may only
     * target a class section they own (see `assertClassOwned`).
     *
     * Writes one `NotificationOutbox` row (`kind: 'ASSIGNMENT_POSTED'`) IN THE
     * SAME transaction as the `Assignment` row — mirrors
     * `ExamsService.create()` exactly: if anything past this point throws,
     * Prisma rolls the whole transaction back and the outbox row is never
     * written either, so a posted assignment is never visible without its
     * notification row existing (see assignments.service.spec.ts's rollback
     * test). There is no separate best-effort real-time email for this event
     * (unlike exams/results) — push is delivered EXCLUSIVELY through the
     * outbox drain, on the cadence `NotificationOutboxService` already runs.
     */
    create(schoolId: string, callerUserId: string, role: string, dto: CreateAssignmentDto): Promise<Assignment>;
    /**
     * Every Assignment for a class section, split into `upcoming` (due today
     * or later) and `past`, each ordered by dueDate ascending. Today counts as
     * upcoming — a same-day due date has not passed yet.
     *
     * A TEACHER caller may only list assignments for a class section they own
     * (see `assertClassOwned`). Each row's `seenCount` is the count of its
     * `AssignmentSeen` rows (`_count`), included in the SAME query — never a
     * second round trip.
     */
    list(schoolId: string, classSectionId: string, callerUserId: string, role: string): Promise<AssignmentList>;
    /**
     * Deletes an Assignment. Ownership is resolved from the STORED row's
     * `classSectionId` — never a caller-supplied one — through the SAME
     * `assertClassOwned` check `create()`/`list()` use, not a separate
     * creator-based rule: `createdByTeacherId` is attribution only (mirrors
     * `Exam.createdById`), never the authorization gate. Any teacher who owns
     * the class section may delete an assignment posted to it, matching how
     * every other class-owned resource in this codebase works.
     */
    remove(schoolId: string, id: string, callerUserId: string, role: string): Promise<{
        ok: true;
    }>;
}
//# sourceMappingURL=assignments.service.d.ts.map