import { type Exam, type ExamList, type PublishResultsResponse, type SavedResult, type SaveResultsResponse } from '@skoolos/types';
import { NotificationService } from '../../common/notifications/notification.service';
import { AttendanceService } from './attendance.service';
import type { CreateExamDto, SaveExamResultsDto } from './management.dto';
export type { Exam, ExamList, PublishResultsResponse, SavedResult, SaveResultsResponse };
export declare class ExamsService {
    private readonly notifications;
    private readonly attendance;
    private readonly logger;
    constructor(notifications: NotificationService, attendance: AttendanceService);
    /**
     * A TEACHER caller may only act on a class section they actually teach —
     * the SAME rule `AnnouncementsService.create` enforces for broadcast
     * rights, reused here via `AttendanceService.myClassSections` (the SAME
     * ownership query `attendance.service.ts`/`announcements.service.ts`
     * already use) rather than a fourth copy of the ownership predicate.
     *
     * `covering` rows are dropped before checking: a one-day substitute does
     * not schedule tests, enter marks, or publish results for a class they
     * cover once (announcements applies the identical exclusion for the same
     * reason). SCHOOL_ADMIN (the only other role `RolesGuard` admits to
     * `ExamsController`) is exempt and always passes.
     *
     * Throws `ApiError('CLASS_NOT_OWNED', ..., 403)` — never returns a
     * boolean, so a caller cannot forget to branch on it.
     */
    private assertClassOwned;
    /**
     * Loads just enough of an Exam row to resolve TEACHER ownership BEFORE the
     * caller-visible mutation/read below runs its own transaction. `Exam`
     * carries no RLS, so scoping by `{ id, schoolId }` is load-bearing — a
     * foreign-school examId 404s here, before ownership is ever checked
     * against it.
     *
     * Deliberately a SEPARATE `withTenant` call rather than reusing the tx the
     * caller opens next: `AttendanceService.myClassSections` (called from
     * `assertClassOwned` between this and the caller's own transaction) opens
     * its OWN `withTenant`, and Prisma's interactive transactions cannot be
     * nested inside one another without risking a pool-exhaustion deadlock —
     * the same reason `AnnouncementsService.create` and `TeacherDayService`
     * call `AttendanceService` methods outside of, never inside, their own
     * `withTenant` blocks.
     */
    private loadExamForOwnership;
    /**
     * Prisma types `scheduledAt`/`createdAt` as `Date`; the shared `Exam`
     * contract (`@skoolos/types`) types them as ISO strings — the shape every
     * consumer (web, mobile) actually receives once Nest's JSON serializer
     * runs `Date.prototype.toJSON`. Converting here makes the service's own
     * return type match the wire contract instead of leaving the two silently
     * out of sync (mirrors HolidaysService.toRow).
     */
    private static toExam;
    private static toSavedResult;
    /**
     * Everything the exam notification composers need beyond the exam row
     * itself: the school's and subject's display names, plus the section's
     * recipient emails.
     *
     * Deliberately runs in its OWN transaction, AFTER the caller's mutation has
     * committed: a transient failure reading a School/Subject/User row must
     * never roll back an exam the teacher just created.
     */
    private loadNotificationContext;
    /**
     * Creates an Exam for a class section, after confirming the section
     * actually belongs to this school (ClassSection has RLS, so a foreign
     * classSectionId simply won't be found rather than leaking a row from
     * another tenant).
     *
     * A TEACHER caller may only target a class section they own (see
     * `assertClassOwned`) — otherwise any teacher who learns another class's
     * UUID could schedule an exam for it, which fans out a TEST_SCHEDULED
     * email to that class's students/guardians.
     */
    create(schoolId: string, callerUserId: string, role: string, dto: CreateExamDto): Promise<Exam>;
    /**
     * All exams for a class section, split into `upcoming` (scheduledAt in the
     * future or right now) and `past`, each ordered by scheduledAt ascending so
     * the UI can render a simple two-group list without further sorting.
     *
     * `Exam` has no RLS (see migration 20260721_010000), so the schoolId filter
     * here is load-bearing, not defensive — without it a foreign exam row for
     * the same classSectionId (an unlikely but possible UUID collision-free
     * scenario across schools sharing no relation) would still be excluded
     * because classSectionId itself is scoped by the caller's own tenant
     * (validated via the RLS-protected ClassSection lookup below).
     *
     * A TEACHER caller may only list exams for a class section they own (see
     * `assertClassOwned`) — otherwise any teacher who learns another class's
     * UUID could enumerate its scheduled/past exams.
     */
    list(schoolId: string, classSectionId: string, callerUserId: string, role: string): Promise<ExamList>;
    /**
     * The marks already stored for an exam, so the results-entry screen can
     * prefill rather than showing a fully-marked exam as blank (which invites a
     * teacher to re-key every mark).
     *
     * `Exam`/`Result` carry no RLS, so loading the exam via `{ id, schoolId }`
     * is load-bearing: a foreign exam id must 404 rather than leak another
     * school's marks. Students with no stored mark are simply absent from the
     * array — the caller pairs it against the roster it already has.
     *
     * A TEACHER caller may only view results for an exam whose STORED
     * `classSectionId` they own (see `assertClassOwned` / `loadExamForOwnership`)
     * — resolved from the exam row itself, since this endpoint takes no
     * classSectionId a caller could otherwise try to substitute in.
     */
    results(schoolId: string, examId: string, callerUserId: string, role: string): Promise<SavedResult[]>;
    /**
     * Upserts Results for an exam inside one tenant transaction. `Exam`/`Result`
     * carry no RLS, so both the school ownership check (below) and the
     * roster-membership check are load-bearing — without them a caller could
     * write Results against a foreign school's exam or student.
     *
     * Every studentId must belong to the exam's own classSectionId roster
     * (checked via `tx.student.findMany` + Set, matching the AttendanceService
     * pattern) — this also blocks cross-tenant writes since `Student` has
     * active RLS, so a foreign-school studentId can never appear in the roster
     * result set at all. On any foreign studentId we reject the whole batch
     * with VALIDATION and write nothing.
     *
     * Each mark must fall within `0..exam.maxMarks` (inclusive) or the whole
     * batch is rejected with VALIDATION — marks are validated up front, not
     * silently coerced, so a bad batch never leaves partial writes behind.
     *
     * A TEACHER caller may only enter results for an exam whose STORED
     * `classSectionId` they own (see `assertClassOwned` / `loadExamForOwnership`)
     * — resolved from the exam row itself, never from any caller input, so a
     * teacher cannot bypass ownership by supplying a different
     * classSectionId (this endpoint doesn't even accept one).
     */
    saveResults(schoolId: string, examId: string, dto: SaveExamResultsDto, callerUserId: string, role: string): Promise<SaveResultsResponse>;
    /**
     * Marks every Result for an exam as published (sets `publishedAt = now()`)
     * in one tenant transaction. Loading the exam via `{ id, schoolId }` is
     * again load-bearing since `Exam` carries no RLS.
     *
     * A TEACHER caller may only publish results for an exam whose STORED
     * `classSectionId` they own (see `assertClassOwned` / `loadExamForOwnership`)
     * — resolved from the exam row itself, never from any caller input.
     */
    publish(schoolId: string, examId: string, callerUserId: string, role: string): Promise<PublishResultsResponse>;
}
//# sourceMappingURL=exams.service.d.ts.map