import { type AttendanceStatus } from '@skoolos/db';
import type { ClassDayStatus, MyClassSection } from '@skoolos/types';
import { AuditService } from '../../common/audit/audit.service';
import { NotificationService } from '../../common/notifications/notification.service';
import type { SaveAttendanceDto } from './management.dto';
export interface AttendanceMarkResult {
    studentId: string;
    status: AttendanceStatus;
}
export interface SaveAttendanceResult {
    saved: number;
    absentees: number;
}
export type { ClassDayStatus, MyClassSection };
export declare class AttendanceService {
    private readonly notifications;
    private readonly audit;
    private readonly logger;
    constructor(notifications: NotificationService, audit: AuditService);
    /**
     * The students in `classSectionId`, each paired with their stored mark for
     * `date` (an unmarked student defaults to PRESENT rather than being
     * omitted, so the teacher UI always renders one row per roster student).
     */
    list(schoolId: string, classSectionId: string, date: string): Promise<AttendanceMarkResult[]>;
    /** Shared select/mapping so `myClassSections` and `dayStatus` render the same `name`/`studentCount` for a section. */
    private static readonly CLASS_SELECT;
    private static toMyClassSection;
    /**
     * The sections a caller may take/view attendance for on `date` (default
     * today, IST). SCHOOL_ADMIN sees every section. A TEACHER sees the sections
     * where they are the class teacher OR hold a timetable slot, PLUS any
     * section they are covering as a substitute on that specific date — a
     * substitution is a one-day grant, so it never widens access on any other
     * day.
     */
    myClassSections(schoolId: string, userId: string, role: string, opts?: {
        date?: string;
        scheduledOnly?: boolean;
    }): Promise<MyClassSection[]>;
    /**
     * Per-class attendance status for `date`, across the caller's sections
     * (see `myClassSections`). `taken` is true once at least one Attendance
     * row exists for that section+date. When taken, `total` is the number of
     * rows actually marked that day — NOT the section's current live roster
     * count, which can drift after the fact (transfers, new admissions) and
     * would otherwise make a past day's "26/28" silently stop matching what
     * was really marked; only an untaken day falls back to the live roster
     * count (there is nothing else to report). `markedBy` resolves the
     * EARLIEST-surviving row's `markedById` to a Teacher name, falling back
     * to `'School admin'` when it does not resolve to a Teacher row — the
     * same fallback `save` uses when a SCHOOL_ADMIN caller has no linked
     * Teacher and `markedById` ends up holding their raw User.id. Because
     * `save` deletes and recreates every row on each save, only one save's
     * rows are ever alive at a time — "earliest" here means "first in the
     * current, surviving batch", i.e. the marker of the latest save, not
     * necessarily whoever marked the class first that day.
     *
     * Exactly two queries regardless of how many sections are returned: one
     * `attendance.findMany` covering every section's rows for `date` in a
     * single `classSectionId IN (...)` call, and one `teacher.findMany` for
     * the distinct `markedById`s found. This matters most for SCHOOL_ADMIN,
     * who can see every section in the school — a per-section loop there
     * would have scaled with school size instead of staying constant.
     */
    dayStatus(schoolId: string, userId: string, role: string, date: string): Promise<ClassDayStatus[]>;
    /**
     * Upserts every mark for a class/date inside one tenant transaction, keyed
     * on the `one_mark_per_student_day` unique so re-submitting the same day is
     * idempotent (a second save corrects the row rather than duplicating it).
     *
     * `callerUserId` is the JWT `sub` (User.id). We resolve it to the caller's
     * Teacher.id when a Teacher row links back via `userId` — the normal case
     * for TEACHER-role callers. SCHOOL_ADMIN callers typically have no Teacher
     * row, so we fall back to storing their own User.id in `markedById`; either
     * way the column always holds a real identity for audit purposes.
     *
     * After the transaction commits, an ABSENCE_NOTICE is fired best-effort to
     * the linked-user emails of students who became ABSENT in *this* call —
     * i.e. whose stored status for the day was previously something other than
     * ABSENT (or who had no row at all). Re-saving the same roster therefore
     * never re-emails a guardian whose child was already recorded absent; the
     * de-duplication lives here, on the server, so it holds for every client.
     * Never blocks or fails this method: notification errors are logged and
     * swallowed.
     */
    save(schoolId: string, callerUserId: string, dto: SaveAttendanceDto, callerRole?: string): Promise<SaveAttendanceResult>;
}
//# sourceMappingURL=attendance.service.d.ts.map