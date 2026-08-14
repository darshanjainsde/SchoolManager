import type { Announcement, AttendanceDay, AttendanceSummary, Holiday, Profile, DiarySignResult, PublishedResult, StudentAssignment, StudentAssignmentList, StudentDiaryResult, TimetableSlot, UpcomingExam } from '@skoolos/types';
import { TenantContextService } from '../tenancy';
import { RegistrationsService } from '../community';
import { TimetableService } from '../management';
import { HolidaysService } from '../management';
import { DiaryService } from '../management';
export type { Announcement, AttendanceDay, AttendanceSummary, Profile, DiarySignResult, PublishedResult, StudentAssignment, StudentAssignmentList, StudentDiaryResult, UpcomingExam, };
export declare class PortalService {
    private readonly tenant;
    private readonly timetableSvc;
    private readonly holidaysSvc;
    private readonly diarySvc;
    private readonly registrations;
    constructor(tenant: TenantContextService, timetableSvc: TimetableService, holidaysSvc: HolidaysService, diarySvc: DiaryService, registrations: RegistrationsService);
    /**
     * A signed-in family taking a place at an event.
     *
     * The public door (`POST /public/events/:id/register`) can only file a GUEST
     * row: a name, an email, and no link to anybody the school already knows.
     * When the family is signed in the school can have the real record — the
     * pupil, their class, their admission number — and can tell its own families
     * from walk-ins on the desk.
     *
     * Like every other route on this controller the pupil comes from the caller's
     * own JWT, never from the request, and no guest fields are forwarded: there
     * is nothing here a caller could say to be filed as somebody else.
     */
    registerForEvent(userId: string, eventId: string, quantity?: number): Promise<{
        id: string;
        status: import("@skoolos/db").$Enums.RegistrationStatus;
        waitlistPos: number | null;
        quantity: number;
    }>;
    /**
     * The child's own diary page(s) — see `DiaryService.studentDiary`, which
     * resolves the Student row from this JWT `sub` exactly like `myStudent`
     * does and never takes a student id from the caller.
     */
    diary(userId: string, date?: string): Promise<StudentDiaryResult>;
    /** The parent's signature on a red-ink remark. */
    signDiary(userId: string, id: string, signedName: string): Promise<DiarySignResult>;
    /**
     * Upcoming school holidays for the CALLING user — any authenticated school
     * role, not just STUDENT. Deliberately does NOT go through `myStudent`
     * (same caution as `registerPushToken` above): a TEACHER/STAFF/
     * SCHOOL_ADMIN login has no `Student` row at all, and the holiday
     * calendar is school-wide, not per-student. `HolidaysService.list` is the
     * SAME query `/manage/holidays` (admin CRUD) reads with — one upcoming
     * list, two callers.
     */
    holidays(): Promise<Holiday[]>;
    /**
     * Registers (or refreshes) an Expo device token for the CALLING user —
     * any authenticated school role, not just STUDENT. Deliberately does NOT
     * go through `myStudent`: a TEACHER/STAFF/SCHOOL_ADMIN login has no
     * `Student` row at all, and this endpoint must work for every role the
     * mobile app supports.
     *
     * Upserts by `token` (its own unique key — Expo issues one per
     * app-install) inside this school's tenant scope, so a re-registering
     * device just refreshes its existing row's owner/timestamp rather than
     * accumulating duplicates. `PushChannel` later reads these rows by email
     * with the platform (cross-tenant) client — see push.channel.ts — but
     * writing them stays tenant-scoped like every other portal mutation.
     *
     * CROSS-TENANT REASSIGNMENT: `token` is globally unique, but the upsert
     * below runs RLS-bound to THIS school. If the same physical device
     * previously registered under a DIFFERENT school (a shared/demo device, or
     * someone who is staff at one school and a guardian at another), that row
     * is invisible to this transaction's tenant scope — yet Postgres's
     * (RLS-blind) unique index still reports a conflict that `ON CONFLICT DO
     * UPDATE` cannot resolve, so Prisma throws P2002. A device token is a
     * per-DEVICE identity, not a per-tenant one, so the correct response is to
     * REASSIGN the row to the new registrant (last-writer-wins) rather than
     * error — erroring would leave that device stuck receiving the OLD
     * tenant's push notifications on every retry. The reassignment itself uses
     * `getPlatformPrisma()` (BYPASSRLS, the same client `PushChannel` reads
     * with) since updating a row outside this transaction's tenant scope
     * requires bypassing RLS by design, not as a workaround.
     */
    registerPushToken(userId: string, token: string, platform: string): Promise<{
        platform: string;
        email: string;
        id: string;
        createdAt: Date;
        schoolId: string;
        token: string;
        userId: string;
        lastSeenAt: Date;
    }>;
    private myStudent;
    profile(userId: string): Promise<Profile>;
    timetable(userId: string): Promise<TimetableSlot[]>;
    announcements(userId: string): Promise<Announcement[]>;
    /**
     * This student's own attendance for one calendar month, plus the summary
     * counts the portal header renders.
     *
     * `month` is `YYYY-MM` and defaults to the current IST month. The range is
     * built as `[first of month, first of next month)` in UTC because
     * `Attendance.date` is a `@db.Date` column (stored at UTC midnight), so a
     * half-open range never double-counts or drops a boundary day.
     *
     * The `studentId` filter is the caller's OWN `Student.id`, resolved from
     * their JWT `sub` via `myStudent` — never a client-supplied id. `Attendance`
     * carries no RLS of its own, so both `schoolId` and `studentId` here are
     * load-bearing, not defensive.
     */
    attendance(userId: string, month?: string): Promise<AttendanceSummary>;
    /**
     * Tests still ahead of the student, for their OWN class section only.
     *
     * A student with no section has no exams to sit — `[]`, not an error.
     * `Exam` has no RLS, so the `schoolId` filter is load-bearing alongside the
     * `classSectionId` (itself read off the caller's own Student row, never
     * supplied by the client).
     */
    exams(userId: string): Promise<UpcomingExam[]>;
    /**
     * The student's OWN published results, each with the class average for that
     * exam so they can see where they landed.
     *
     * Two privacy rules are enforced here:
     *  1. Only rows keyed on the caller's own `Student.id` are ever read as
     *     individual marks — `studentId` comes from `myStudent`, never the
     *     client.
     *  2. The class average is computed with `groupBy` + `_avg` in the database,
     *     so no other student's individual mark is ever loaded into this
     *     process, let alone serialised into the response.
     *
     * Unpublished results (`publishedAt = null`) are excluded from BOTH the
     * student's own rows and the average — an in-progress marking run must not
     * leak through the average either.
     */
    results(userId: string): Promise<PublishedResult[]>;
    /**
     * The student's own class section's Assignments, split into `upcoming`
     * (due today or later) and `past`, each ordered by dueDate ascending —
     * same split rule `AssignmentsService.list` uses on the teacher side
     * (today counts as upcoming; a same-day due date has not passed yet).
     *
     * A student with no section has no assignments to see — `[]`/`[]`, not an
     * error. `subjectName` is resolved here (a student has no
     * `/manage/subjects` access, unlike the teacher-facing `Assignment`
     * contract which leaves that to the caller).
     */
    assignments(userId: string): Promise<StudentAssignmentList>;
    /**
     * Marks one Assignment as "seen" by the calling student — idempotent by
     * construction (upserts on `AssignmentSeen`'s unique `(assignmentId,
     * studentId)` pair, so re-opening the same assignment twice never creates
     * a second row or errors).
     *
     * The assignment must belong to the CALLER'S OWN class section — resolved
     * from the student's stored `classSectionId`, never trusted from the
     * client beyond the id itself. Without this check a student could mark an
     * assignment from a class they don't belong to as "seen", corrupting that
     * other class's teacher-facing seen-count.
     */
    markAssignmentSeen(userId: string, assignmentId: string): Promise<{
        ok: true;
    }>;
    /**
     * `subjectId -> Subject.name` for the ids given, in one query, scoped to
     * this school. `Exam` has no `subject` relation in the schema, so the name
     * has to be resolved separately rather than `include`d.
     */
    private subjectNames;
}
//# sourceMappingURL=portal.service.d.ts.map