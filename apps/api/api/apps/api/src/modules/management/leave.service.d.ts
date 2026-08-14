import { type UserRole } from '@skoolos/db';
import { type LeaveApplication } from '@skoolos/types';
import type { AssignSubstitutionDto, CreateLeaveDto } from './management.dto';
export type { LeaveApplication };
export declare class LeaveService {
    /**
     * Prisma types `startDate`/`endDate`/`createdAt` as `Date`; the shared
     * `LeaveApplication` contract types them as ISO strings — the shape every
     * consumer (web, mobile) actually receives once Nest's JSON serializer
     * runs `Date.prototype.toJSON` (mirrors HolidaysService.toRow).
     */
    private static toRow;
    /**
     * Creates a PENDING leave application for the CALLER's own Teacher record
     * (resolved from the JWT's `userId` via `Teacher.userId`). A caller with no
     * linked Teacher row — e.g. a SCHOOL_ADMIN who isn't also a teacher — gets
     * `NOT_A_TEACHER` rather than silently creating a bogus application.
     */
    apply(schoolId: string, callerUserId: string, dto: CreateLeaveDto): Promise<LeaveApplication>;
    /** The caller's own leave applications, most recent first. */
    mine(schoolId: string, callerUserId: string): Promise<LeaveApplication[]>;
    /** How many of the caller's OWN leave applications are still PENDING — half
     *  of the teacher "Requests" badge (see `RequestsController`). */
    pendingCount(schoolId: string, callerUserId: string): Promise<number>;
    /**
     * All applications for the school, most recent first, defaulting to
     * PENDING only. `Teacher` name is joined in JS — `LeaveApplication` has no
     * Prisma relation to `Teacher` (only to `School`), matching the pattern
     * already used for `Substitution` below.
     */
    list(schoolId: string, status?: string): Promise<{
        teacherName: string;
        status: import("@skoolos/db").$Enums.LeaveStatus;
        type: import("@skoolos/db").$Enums.LeaveType;
        id: string;
        createdAt: Date;
        schoolId: string;
        startDate: Date;
        endDate: Date;
        reason: string | null;
        teacherId: string;
        reviewedAt: Date | null;
        reviewedById: string | null;
    }[]>;
    reject(schoolId: string, id: string, adminUserId: string): Promise<{
        status: import("@skoolos/db").$Enums.LeaveStatus;
        type: import("@skoolos/db").$Enums.LeaveType;
        id: string;
        createdAt: Date;
        schoolId: string;
        startDate: Date;
        endDate: Date;
        reason: string | null;
        teacherId: string;
        reviewedAt: Date | null;
        reviewedById: string | null;
    }>;
    /**
     * Approves the application, then generates a coverage gap — an unfilled
     * `Substitution` row — for every one of the teacher's ACTIVE timetable
     * slots (`effectiveTo IS NULL`) on every weekday the leave spans, AND
     * marks the teacher `ON_LEAVE` in `StaffAttendance` for every calendar
     * date the leave spans that is today-or-later (IST) — see
     * `markOnLeaveIfDue` below.
     *
     * Idempotent by construction: for each (classSectionId, periodId, date) we
     * check for an existing `Substitution` row before creating one, so
     * re-approving (impossible once APPROVED, but also overlapping leave
     * windows across two different applications) never double-creates a gap.
     * We deliberately do NOT lean on catching the `one_sub_per_slot_date`
     * unique-constraint error here: `withTenant` runs this whole method in one
     * real Postgres transaction, and a unique violation aborts that
     * transaction outright — every later statement (including this very
     * APPROVED update) would then fail with "current transaction is aborted".
     * A pre-check read is what stays safely idempotent inside a single
     * transaction; see `timetable.service.ts#assign` for the doc on why
     * catching P2002 is fine there (that catch lives OUTSIDE the transaction).
     */
    approve(schoolId: string, id: string, adminUserId: string): Promise<{
        gaps: number;
    }>;
    /**
     * Marks `teacherId` `ON_LEAVE` in `StaffAttendance` for `date`, unless a
     * mark already exists for that day and is anything other than the default
     * `PRESENT` — an `ABSENT`/`LATE` mark was set deliberately (e.g. by the
     * daily roster) and must not be clobbered by this approve-time side
     * effect. Re-approving is impossible (see class doc above), and marking
     * the same date twice via overlapping applications is a no-op the second
     * time since the row is by then already `ON_LEAVE`.
     */
    private markOnLeaveIfDue;
    /**
     * Cancels a leave application — no approval step, unlike reject. Allowed
     * for the OWNING teacher (`callerRole === 'TEACHER'` and their own
     * `Teacher.id === app.teacherId`) or any `SCHOOL_ADMIN`; anyone else gets
     * `LEAVE_CANCEL_FORBIDDEN`. `REJECTED`/already-`CANCELLED` applications
     * have nothing to cancel (`LEAVE_NOT_CANCELLABLE`).
     *
     * - `PENDING` → straight to `CANCELLED`, no side effects (nothing was ever
     *   generated for a pending application).
     * - `APPROVED` → for every date in `[startDate, endDate]` that is
     *   today-or-later (IST) — PAST dates are immutable and are left exactly
     *   as they were — deletes that teacher's `Substitution` gaps for the
     *   date (covered or not: removing the override row restores the
     *   original teacher on the recurring timetable with no further write
     *   needed) and clears the `ON_LEAVE` `StaffAttendance` mark for the date
     *   IF it is still `ON_LEAVE` (a mark since changed by hand, e.g. to
     *   `ABSENT`, is left alone). Then the application itself is set to
     *   `CANCELLED`.
     *
     * Returns `{ status: 'CANCELLED', restoredDates }` — `restoredDates` is
     * the count of today-or-later dates that were processed (0 for a
     * `PENDING` cancel, or for an `APPROVED` cancel whose whole window is
     * already in the past).
     */
    cancel(schoolId: string, id: string, callerUserId: string, callerRole: UserRole): Promise<{
        status: "CANCELLED";
        restoredDates: number;
    }>;
    /**
     * The open + filled coverage gaps in `[from, to]`, ordered by date then
     * period. `Substitution` has no Prisma relations beyond `School`, so
     * classSection/period/teacher names are joined in JS from separate lookups
     * rather than Prisma `include`.
     */
    coverage(schoolId: string, from: string, to: string): Promise<{
        id: string;
        date: Date;
        classSectionId: string;
        classSectionName: string;
        periodId: string;
        periodLabel: string;
        originalTeacherName: string;
        substituteTeacherId: string | null;
        substituteTeacherName: string | null;
    }[]>;
    /**
     * Assigns a substitute to a coverage gap. The substitute must actually be
     * free at that date+period: no ACTIVE timetable slot of their own in the
     * same weekday+period (reusing the same "busy" definition as
     * `TimetableService.availability`), and not already covering a different
     * gap at that exact date+period.
     */
    assign(schoolId: string, id: string, dto: AssignSubstitutionDto): Promise<{
        date: Date;
        id: string;
        createdAt: Date;
        schoolId: string;
        classSectionId: string;
        periodId: string;
        originalTeacherId: string;
        substituteTeacherId: string | null;
        reason: string | null;
    }>;
    clear(schoolId: string, id: string): Promise<{
        date: Date;
        id: string;
        createdAt: Date;
        schoolId: string;
        classSectionId: string;
        periodId: string;
        originalTeacherId: string;
        substituteTeacherId: string | null;
        reason: string | null;
    }>;
    private resolveStatus;
}
//# sourceMappingURL=leave.service.d.ts.map