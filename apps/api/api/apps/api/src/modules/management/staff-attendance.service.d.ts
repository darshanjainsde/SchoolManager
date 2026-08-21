import { type PersonAttendanceStatus } from '@skoolos/db';
import type { StaffRoleValue } from './management.dto';
import type { SaveStaffAttendanceDto } from './management.dto';
export type PersonKind = 'TEACHER' | 'STAFF';
export interface StaffAttendanceRosterPerson {
    id: string;
    name: string;
    kind: PersonKind;
    role?: string;
    status: PersonAttendanceStatus;
}
export interface StaffAttendanceListResult {
    people: StaffAttendanceRosterPerson[];
}
export interface SaveStaffAttendanceResult {
    saved: number;
    absentees: number;
}
export interface PersonAttendanceDay {
    /** `YYYY-MM-DD` */
    date: string;
    status: PersonAttendanceStatus;
}
export interface PersonAttendanceSummary {
    present: number;
    absent: number;
    late: number;
    onLeave: number;
    /**
     * present / (present + absent + late) * 100, rounded — `onLeave` days are
     * excluded from BOTH sides of the ratio so an approved leave doesn't count
     * against the person's attendance. 0 with no non-leave records (including
     * when every recorded day that month is `ON_LEAVE`).
     */
    percent: number;
    days: PersonAttendanceDay[];
}
export interface MyStaffAttendanceResult {
    person: {
        id: string;
        firstName: string;
        lastName: string;
        role: StaffRoleValue;
    };
    summary: PersonAttendanceSummary;
}
export declare class StaffAttendanceService {
    /**
     * Every teacher + non-teaching staff member at the school, each paired with
     * their mark for `date` (defaulting to PRESENT when unmarked) — so the
     * "mark everyone" screen always renders one row per person on the payroll,
     * the same "unmarked = PRESENT" convention as the student attendance list.
     */
    list(schoolId: string, date: string): Promise<StaffAttendanceListResult>;
    /**
     * Upserts every mark for a day inside one tenant transaction, keyed on the
     * per-teacher/per-staff/day uniques (`one_teacher_mark_per_day`,
     * `one_staff_mark_per_day`) so re-submitting the same day is idempotent —
     * mirrors AttendanceService.save.
     *
     * Both `Staff` and `StaffAttendance` carry no RLS of their own, so the
     * roster-membership check below is load-bearing, not defensive: without it
     * a caller could write an attendance row against another school's
     * teacherId/staffId (Teacher itself has RLS, but the write here targets
     * StaffAttendance, which does not).
     */
    save(schoolId: string, callerUserId: string, dto: SaveStaffAttendanceDto): Promise<SaveStaffAttendanceResult>;
    /**
     * One person's monthly attendance record — the data behind the attendance
     * CARD opened from the roster ("click a name → see monthly data"). Mirrors
     * PortalService.attendance's month-range math (half-open `[first of
     * month, first of next month)` in UTC, since the date column is stored as
     * UTC midnight).
     */
    person(schoolId: string, kindRaw: string, id: string, month: string): Promise<PersonAttendanceSummary>;
    /**
     * The CALLER's own staff-attendance record for `month` (defaulting to the
     * current IST month) — the STAFF-portal counterpart to `person()`, which
     * is admin-only and takes an id/kind the caller chooses. Here the Staff
     * row is resolved from the JWT's `userId` via `Staff.userId`, exactly like
     * `LeaveService.apply`/`mine` resolve a Teacher row — a caller with no
     * linked Staff row (shouldn't happen for a STAFF-role login, but the JWT
     * role claim and the Staff row are two different sources of truth) gets
     * `NOT_STAFF` rather than a confusing empty summary.
     *
     * Bundles the caller's name/role alongside the summary so the STAFF
     * portal's home screen needs only this one call — there is no separate
     * `/me/profile` for non-students (`PortalController` is `@Roles('STUDENT')`
     * only).
     */
    mine(schoolId: string, callerUserId: string, monthRaw?: string): Promise<MyStaffAttendanceResult>;
}
//# sourceMappingURL=staff-attendance.service.d.ts.map