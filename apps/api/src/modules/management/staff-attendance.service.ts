import { Injectable } from '@nestjs/common';
import { withTenant, type PersonAttendanceStatus } from '@skoolos/db';
import { ApiError } from '../../common/errors/api-error';
import type { StaffRoleValue } from './management.dto';
import type { SaveStaffAttendanceDto } from './management.dto';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

/**
 * Mirrors `PortalService`'s `IST_DAY_FORMATTER` (duplicated, not imported —
 * same convention `leave-dates.ts` already follows for this school): the
 * default month for a self-service "mine" read is the IST calendar month
 * containing "now", not the server's local month.
 */
const IST_DAY_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

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
  person: { id: string; firstName: string; lastName: string; role: StaffRoleValue };
  summary: PersonAttendanceSummary;
}

function assertDate(date: string): Date {
  if (!DATE_RE.test(date)) {
    throw new ApiError('VALIDATION', 'date must be formatted as YYYY-MM-DD', 400, 'date');
  }
  return new Date(date);
}

function assertKind(kind: string): PersonKind {
  if (kind !== 'TEACHER' && kind !== 'STAFF') {
    throw new ApiError('VALIDATION', 'kind must be TEACHER or STAFF', 400, 'kind');
  }
  return kind;
}

/**
 * Validates a `YYYY-MM` string and turns it into the half-open UTC date
 * range `[first of month, first of next month)` used to query
 * `StaffAttendance` — shared by `person()` and `mine()` (was duplicated
 * inline in `person()` before `mine()` needed the same math).
 */
function parseMonth(month: string): { start: Date; end: Date } {
  if (!MONTH_RE.test(month)) {
    throw new ApiError('VALIDATION', 'month must be formatted as YYYY-MM', 400, 'month');
  }
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7)) - 1;
  if (monthIndex < 0 || monthIndex > 11) {
    throw new ApiError('VALIDATION', 'month must be between 01 and 12', 400, 'month');
  }
  return { start: new Date(Date.UTC(year, monthIndex, 1)), end: new Date(Date.UTC(year, monthIndex + 1, 1)) };
}

/** `Date` (stored as `@db.Date`, i.e. UTC midnight) → `YYYY-MM-DD`. */
function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

@Injectable()
export class StaffAttendanceService {
  /**
   * Every teacher + non-teaching staff member at the school, each paired with
   * their mark for `date` (defaulting to PRESENT when unmarked) — so the
   * "mark everyone" screen always renders one row per person on the payroll,
   * the same "unmarked = PRESENT" convention as the student attendance list.
   */
  async list(schoolId: string, date: string): Promise<StaffAttendanceListResult> {
    const day = assertDate(date);

    return withTenant(schoolId, async (tx) => {
      const [teachers, staff, marks] = await Promise.all([
        tx.teacher.findMany({
          where: { schoolId },
          orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
          select: { id: true, firstName: true, lastName: true },
        }),
        tx.staff.findMany({
          where: { schoolId },
          orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
          select: { id: true, firstName: true, lastName: true, role: true },
        }),
        // `StaffAttendance` has no RLS of its own (see the migration that
        // added it — Teacher is covered, Staff/StaffAttendance are not), so
        // the `schoolId` filter here is load-bearing, not defensive.
        tx.staffAttendance.findMany({
          where: { schoolId, date: day },
          select: { teacherId: true, staffId: true, status: true },
        }),
      ]);

      const byTeacher = new Map<string, PersonAttendanceStatus>();
      const byStaff = new Map<string, PersonAttendanceStatus>();
      for (const m of marks) {
        if (m.teacherId) byTeacher.set(m.teacherId, m.status);
        else if (m.staffId) byStaff.set(m.staffId, m.status);
      }

      const people: StaffAttendanceRosterPerson[] = [
        ...teachers.map((t) => ({
          id: t.id,
          name: `${t.firstName} ${t.lastName}`,
          kind: 'TEACHER' as const,
          status: byTeacher.get(t.id) ?? ('PRESENT' as PersonAttendanceStatus),
        })),
        ...staff.map((s) => ({
          id: s.id,
          name: `${s.firstName} ${s.lastName}`,
          kind: 'STAFF' as const,
          role: s.role,
          status: byStaff.get(s.id) ?? ('PRESENT' as PersonAttendanceStatus),
        })),
      ];

      return { people };
    });
  }

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
  async save(
    schoolId: string,
    callerUserId: string,
    dto: SaveStaffAttendanceDto,
  ): Promise<SaveStaffAttendanceResult> {
    const day = assertDate(dto.date);

    return withTenant(schoolId, async (tx) => {
      const [teachers, staff] = await Promise.all([
        tx.teacher.findMany({ where: { schoolId }, select: { id: true } }),
        tx.staff.findMany({ where: { schoolId }, select: { id: true } }),
      ]);
      const teacherIds = new Set(teachers.map((t) => t.id));
      const staffIds = new Set(staff.map((s) => s.id));

      for (const mark of dto.marks) {
        const roster = mark.kind === 'TEACHER' ? teacherIds : staffIds;
        if (!roster.has(mark.personId)) {
          throw new ApiError(
            'VALIDATION',
            'One or more people do not belong to this school',
            400,
          );
        }
      }

      let absentees = 0;
      for (const mark of dto.marks) {
        if (mark.kind === 'TEACHER') {
          await tx.staffAttendance.upsert({
            where: { one_teacher_mark_per_day: { teacherId: mark.personId, date: day } },
            create: {
              schoolId,
              teacherId: mark.personId,
              date: day,
              status: mark.status,
              markedById: callerUserId,
            },
            update: { status: mark.status, markedById: callerUserId },
          });
        } else {
          await tx.staffAttendance.upsert({
            where: { one_staff_mark_per_day: { staffId: mark.personId, date: day } },
            create: {
              schoolId,
              staffId: mark.personId,
              date: day,
              status: mark.status,
              markedById: callerUserId,
            },
            update: { status: mark.status, markedById: callerUserId },
          });
        }
        if (mark.status === 'ABSENT') absentees += 1;
      }

      return { saved: dto.marks.length, absentees };
    });
  }

  /**
   * One person's monthly attendance record — the data behind the attendance
   * CARD opened from the roster ("click a name → see monthly data"). Mirrors
   * PortalService.attendance's month-range math (half-open `[first of
   * month, first of next month)` in UTC, since the date column is stored as
   * UTC midnight).
   */
  async person(
    schoolId: string,
    kindRaw: string,
    id: string,
    month: string,
  ): Promise<PersonAttendanceSummary> {
    const kind = assertKind(kindRaw);
    const { start, end } = parseMonth(month);

    return withTenant(schoolId, async (tx) => {
      // Confirms `id` belongs to THIS school before ever querying
      // StaffAttendance — required for Staff (no RLS); harmless-but-cheap
      // for Teacher (which does have RLS).
      const exists =
        kind === 'TEACHER'
          ? await tx.teacher.findFirst({ where: { id, schoolId }, select: { id: true } })
          : await tx.staff.findFirst({ where: { id, schoolId }, select: { id: true } });
      if (!exists) {
        throw new ApiError(
          'NOT_FOUND',
          kind === 'TEACHER' ? 'Teacher not found' : 'Staff member not found',
          404,
        );
      }

      const rows = await tx.staffAttendance.findMany({
        where: {
          schoolId,
          date: { gte: start, lt: end },
          ...(kind === 'TEACHER' ? { teacherId: id } : { staffId: id }),
        },
        orderBy: { date: 'asc' },
        select: { date: true, status: true },
      });

      return summarizeRows(rows);
    });
  }

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
  async mine(schoolId: string, callerUserId: string, monthRaw?: string): Promise<MyStaffAttendanceResult> {
    const month = monthRaw?.trim() || IST_DAY_FORMATTER.format(new Date()).slice(0, 7);
    const { start, end } = parseMonth(month);

    return withTenant(schoolId, async (tx) => {
      const staff = await tx.staff.findFirst({
        where: { userId: callerUserId, schoolId },
        select: { id: true, firstName: true, lastName: true, role: true },
      });
      if (!staff) {
        throw new ApiError('NOT_STAFF', 'Only staff can view their own attendance', 403);
      }

      const rows = await tx.staffAttendance.findMany({
        where: { schoolId, staffId: staff.id, date: { gte: start, lt: end } },
        orderBy: { date: 'asc' },
        select: { date: true, status: true },
      });

      return {
        person: { id: staff.id, firstName: staff.firstName, lastName: staff.lastName, role: staff.role },
        summary: summarizeRows(rows),
      };
    });
  }
}

/**
 * `onLeave` is deliberately excluded from the `percent` denominator — a day
 * the person was on approved leave shouldn't drag down their attendance
 * percentage the way an unexcused absence would. Shared by `person()` and
 * `mine()`.
 */
function summarizeRows(rows: { date: Date; status: PersonAttendanceStatus }[]): PersonAttendanceSummary {
  let present = 0;
  let absent = 0;
  let late = 0;
  let onLeave = 0;
  for (const row of rows) {
    if (row.status === 'PRESENT') present += 1;
    else if (row.status === 'ABSENT') absent += 1;
    else if (row.status === 'LATE') late += 1;
    else if (row.status === 'ON_LEAVE') onLeave += 1;
  }

  const nonLeaveTotal = present + absent + late;
  const percent = nonLeaveTotal === 0 ? 0 : Math.round((present / nonLeaveTotal) * 100);

  return {
    present,
    absent,
    late,
    onLeave,
    percent,
    days: rows.map((r) => ({ date: toDateKey(r.date), status: r.status })),
  };
}
