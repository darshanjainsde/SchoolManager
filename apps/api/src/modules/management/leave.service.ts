import { Injectable, NotFoundException } from '@nestjs/common';
import { withTenant, type TenantTx, type UserRole } from '@skoolos/db';
import { LEAVE_STATUSES, type LeaveApplication, type LeaveStatusValue } from '@skoolos/types';
import { ApiError } from '../../common/errors/api-error';
import { dateRangeInclusive, isValidDateStr, isoWeekdayOf, toDateStr, todayIstDateStr } from './internal/leave-dates';
import type { AssignSubstitutionDto, CreateLeaveDto } from './management.dto';
import { LIST_CEILING } from '../../common/lists/list-ceiling';
import { resolveAdminRecipients } from '../../common/notifications/recipients';

export type { LeaveApplication };

/** Raw `LeaveApplication` row shape as Prisma returns it — dates still `Date`. */
type LeaveApplicationRow = {
  id: string;
  type: string;
  startDate: Date;
  endDate: Date;
  reason: string | null;
  status: string;
  halfDay?: boolean;
  createdAt: Date;
};

@Injectable()
export class LeaveService {
  /**
   * Prisma types `startDate`/`endDate`/`createdAt` as `Date`; the shared
   * `LeaveApplication` contract types them as ISO strings — the shape every
   * consumer (web, mobile) actually receives once Nest's JSON serializer
   * runs `Date.prototype.toJSON` (mirrors HolidaysService.toRow).
   */
  private static toRow(a: LeaveApplicationRow): LeaveApplication {
    return {
      id: a.id,
      type: a.type as LeaveApplication['type'],
      startDate: a.startDate.toISOString(),
      endDate: a.endDate.toISOString(),
      reason: a.reason,
      status: a.status as LeaveApplication['status'],
      halfDay: a.halfDay ?? false,
      createdAt: a.createdAt.toISOString(),
    };
  }

  /**
   * Creates a PENDING leave application for the CALLER's own Teacher record
   * (resolved from the JWT's `userId` via `Teacher.userId`). A caller with no
   * linked Teacher row — e.g. a SCHOOL_ADMIN who isn't also a teacher — gets
   * `NOT_A_TEACHER` rather than silently creating a bogus application.
   */
  async apply(schoolId: string, callerUserId: string, dto: CreateLeaveDto): Promise<LeaveApplication> {
    if (dto.endDate < dto.startDate) {
      throw new ApiError('VALIDATION', 'endDate must be on or after startDate', 400, 'endDate');
    }
    // The DB carries this as a CHECK. Refusing it here means the person is
    // told what is wrong instead of being shown a constraint violation.
    if (dto.halfDay && dto.endDate !== dto.startDate) {
      throw new ApiError('VALIDATION', 'A half day is one day. Pick the same date for both, or turn the half day off.', 400, 'halfDay');
    }

    return withTenant(schoolId, async (tx) => {
      const person = await LeaveService.personFor(tx, schoolId, callerUserId);
      if (!person) {
        throw new ApiError('NOT_A_TEACHER', 'Only a teacher or a staff member can apply for leave', 403);
      }

      // Link the application to the school's own leave-type row (if the
      // policy has been set up) so it counts against the right balance.
      const typeDef = await tx.leaveTypeDef.findFirst({
        where: { schoolId, builtin: dto.type },
        select: { id: true },
      });

      const created = await tx.leaveApplication.create({
        data: {
          schoolId,
          // Exactly one of these, enforced by `LeaveApplication_one_person`.
          teacherId: person.kind === 'TEACHER' ? person.id : null,
          staffId: person.kind === 'STAFF' ? person.id : null,
          type: dto.type,
          typeDefId: typeDef?.id ?? null,
          startDate: new Date(dto.startDate),
          endDate: new Date(dto.endDate),
          halfDay: dto.halfDay ?? false,
          reason: dto.reason,
        },
      });
      await this.tellAdminsApplied(tx, schoolId, created.id, person, dto.startDate, dto.endDate, dto.reason ?? null);
      return LeaveService.toRow(created);
    });
  }

  /**
   * WHO IS ASKING — a teacher, a staff member, or neither.
   *
   * Leave used to be a teachers-only idea, so every read resolved
   * `Teacher.userId` and a driver simply had no way in. A school's leave
   * policy covers everybody it employs, and pay deducts for everybody, so the
   * question this answers is "which person record is this login", not "which
   * teacher". A login that is both is a teacher first: that is the record
   * with a timetable to cover.
   */
  private static async personFor(
    tx: TenantTx,
    schoolId: string,
    userId: string,
  ): Promise<{ kind: 'TEACHER' | 'STAFF'; id: string; firstName: string; lastName: string | null } | null> {
    const teacher = await tx.teacher.findFirst({
      where: { schoolId, userId },
      select: { id: true, firstName: true, lastName: true },
    });
    if (teacher) return { kind: 'TEACHER', ...teacher };
    const staff = await tx.staff.findFirst({
      where: { schoolId, userId, isActive: true },
      select: { id: true, firstName: true, lastName: true },
    });
    return staff ? { kind: 'STAFF', ...staff } : null;
  }

  /** The one-person filter for whichever record this login turned out to be. */
  private static whereIs(person: { kind: 'TEACHER' | 'STAFF'; id: string }) {
    return person.kind === 'TEACHER' ? { teacherId: person.id } : { staffId: person.id };
  }

  /** The caller's own leave applications, most recent first. */
  async mine(schoolId: string, callerUserId: string): Promise<LeaveApplication[]> {
    return withTenant(schoolId, async (tx) => {
      const person = await LeaveService.personFor(tx, schoolId, callerUserId);
      if (!person) return [];

      const rows = await tx.leaveApplication.findMany({ take: LIST_CEILING.ACTIVITY,
        where: { schoolId, ...LeaveService.whereIs(person) },
        orderBy: { createdAt: 'desc' },
      });
      return rows.map(LeaveService.toRow);
    });
  }

  /** How many of the caller's OWN leave applications are still PENDING — half
   *  of the teacher "Requests" badge (see `RequestsController`). */
  async pendingCount(schoolId: string, callerUserId: string): Promise<number> {
    return withTenant(schoolId, async (tx) => {
      const person = await LeaveService.personFor(tx, schoolId, callerUserId);
      if (!person) return 0;
      return tx.leaveApplication.count({
        where: { schoolId, ...LeaveService.whereIs(person), status: 'PENDING' },
      });
    });
  }

  /**
   * All applications for the school, most recent first, defaulting to
   * PENDING only. `Teacher` name is joined in JS — `LeaveApplication` has no
   * Prisma relation to `Teacher` (only to `School`), matching the pattern
   * already used for `Substitution` below.
   */
  async list(schoolId: string, status?: string) {
    const resolved = this.resolveStatus(status);

    return withTenant(schoolId, async (tx) => {
      const apps = await tx.leaveApplication.findMany({ take: LIST_CEILING.ACTIVITY,
        where: { schoolId, status: resolved },
        orderBy: { createdAt: 'desc' },
      });
      if (apps.length === 0) return [];

      // A row belongs to a teacher OR a staff member — never both, never
      // neither (a CHECK enforces it). Both names are joined in JS, the way
      // this file already joined the teacher's.
      const teacherIds = apps.map((a) => a.teacherId).filter((id): id is string => !!id);
      const staffIds = apps.map((a) => a.staffId).filter((id): id is string => !!id);
      const [teachers, staff] = await Promise.all([
        teacherIds.length
          ? tx.teacher.findMany({ take: LIST_CEILING.STRUCTURE, where: { id: { in: [...new Set(teacherIds)] } }, select: { id: true, firstName: true, lastName: true } })
          : Promise.resolve([]),
        staffIds.length
          ? tx.staff.findMany({ take: LIST_CEILING.STRUCTURE, where: { id: { in: [...new Set(staffIds)] } }, select: { id: true, firstName: true, lastName: true, role: true } })
          : Promise.resolve([]),
      ]);
      const byTeacher = new Map(teachers.map((t) => [t.id, t]));
      const byStaff = new Map(staff.map((s) => [s.id, s]));

      return apps.map((a) => {
        const t = a.teacherId ? byTeacher.get(a.teacherId) : null;
        const s = a.staffId ? byStaff.get(a.staffId) : null;
        const who = t ?? s;
        return {
          ...a,
          personKind: a.staffId ? ('STAFF' as const) : ('TEACHER' as const),
          teacherName: who ? `${who.firstName} ${who.lastName}`.trim() : 'Unknown',
        };
      });
    });
  }

  async reject(schoolId: string, id: string, adminUserId: string) {
    return withTenant(schoolId, async (tx) => {
      const app = await tx.leaveApplication.findFirst({ where: { id, schoolId } });
      if (!app) throw new NotFoundException('Leave application not found');
      if (app.status !== 'PENDING') {
        throw new ApiError('LEAVE_NOT_PENDING', 'This application has already been reviewed', 409);
      }

      const updated = await tx.leaveApplication.update({
        where: { id },
        data: { status: 'REJECTED', reviewedById: adminUserId, reviewedAt: new Date() },
      });
      await this.tellTeacherDecided(tx, schoolId, app, 'REJECTED', adminUserId);
      return updated;
    });
  }

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
  async approve(schoolId: string, id: string, adminUserId: string) {
    return withTenant(schoolId, async (tx) => {
      const app = await tx.leaveApplication.findFirst({ where: { id, schoolId } });
      if (!app) throw new NotFoundException('Leave application not found');
      if (app.status !== 'PENDING') {
        throw new ApiError('LEAVE_NOT_PENDING', 'This application has already been reviewed', 409);
      }

      await tx.leaveApplication.update({
        where: { id },
        data: { status: 'APPROVED', reviewedById: adminUserId, reviewedAt: new Date() },
      });

      const dates = dateRangeInclusive(toDateStr(app.startDate), toDateStr(app.endDate));
      const todayStr = todayIstDateStr(new Date());

      // Substitutions and the staff-attendance mark are TEACHER work: a driver
      // has no timetable to cover and no class waiting for one. A staff leave
      // is approved and that is the whole of it.
      const teacherId = app.teacherId;
      let gaps = 0;
      const gapIds: string[] = [];
      for (const dateStr of teacherId ? dates : []) {
        const weekday = isoWeekdayOf(dateStr);
        const date = new Date(dateStr);

        const slots = await tx.timetableSlot.findMany({ take: LIST_CEILING.ACTIVITY,
          where: { schoolId, teacherId: teacherId!, dayOfWeek: weekday, effectiveTo: null },
          select: { classSectionId: true, periodId: true },
        });

        for (const slot of slots) {
          const existing = await tx.substitution.findFirst({
            where: { schoolId, classSectionId: slot.classSectionId, periodId: slot.periodId, date },
          });
          if (existing) continue;

          const gap = await tx.substitution.create({
            data: {
              schoolId,
              classSectionId: slot.classSectionId,
              periodId: slot.periodId,
              date,
              originalTeacherId: teacherId!,
              reason: 'leave',
            },
          });
          gaps += 1;
          gapIds.push(gap.id);
        }

        if (dateStr >= todayStr) {
          await this.markOnLeaveIfDue(tx, schoolId, teacherId!, date, adminUserId);
        }
      }

      await this.tellTeacherDecided(tx, schoolId, app, 'APPROVED', adminUserId);
      return { gaps, gapIds };
    });
  }

  /**
   * Marks `teacherId` `ON_LEAVE` in `StaffAttendance` for `date`, unless a
   * mark already exists for that day and is anything other than the default
   * `PRESENT` — an `ABSENT`/`LATE` mark was set deliberately (e.g. by the
   * daily roster) and must not be clobbered by this approve-time side
   * effect. Re-approving is impossible (see class doc above), and marking
   * the same date twice via overlapping applications is a no-op the second
   * time since the row is by then already `ON_LEAVE`.
   */
  private async markOnLeaveIfDue(
    tx: TenantTx,
    schoolId: string,
    teacherId: string,
    date: Date,
    markedById: string,
  ): Promise<void> {
    const existing = await tx.staffAttendance.findFirst({ where: { schoolId, teacherId, date } });
    if (!existing) {
      await tx.staffAttendance.create({
        data: { schoolId, teacherId, date, status: 'ON_LEAVE', markedById },
      });
    } else if (existing.status === 'PRESENT') {
      await tx.staffAttendance.update({
        where: { id: existing.id },
        data: { status: 'ON_LEAVE', markedById },
      });
    }
  }

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
  async cancel(schoolId: string, id: string, callerUserId: string, callerRole: UserRole) {
    return withTenant(schoolId, async (tx) => {
      const app = await tx.leaveApplication.findFirst({ where: { id, schoolId } });
      if (!app) throw new NotFoundException('Leave application not found');

      if (callerRole !== 'SCHOOL_ADMIN') {
        const person = await LeaveService.personFor(tx, schoolId, callerUserId);
        const isMine = person !== null
          && (person.kind === 'TEACHER' ? person.id === app.teacherId : person.id === app.staffId);
        if (!isMine) {
          throw new ApiError('LEAVE_CANCEL_FORBIDDEN', 'You can only cancel your own leave', 403);
        }
      }

      if (app.status === 'REJECTED' || app.status === 'CANCELLED') {
        throw new ApiError('LEAVE_NOT_CANCELLABLE', 'This application has nothing to cancel', 409);
      }

      if (app.status === 'PENDING') {
        await tx.leaveApplication.update({ where: { id }, data: { status: 'CANCELLED' } });
        return { status: 'CANCELLED' as const, restoredDates: 0 };
      }

      // APPROVED: restore every today-or-later date, leaving past dates untouched.
      const todayStr = todayIstDateStr(new Date());
      const dates = dateRangeInclusive(toDateStr(app.startDate), toDateStr(app.endDate)).filter(
        (d) => d >= todayStr,
      );

      // Same split as approve: only a teacher has substitutions to unwind.
      const cancelTeacherId = app.teacherId;
      for (const dateStr of cancelTeacherId ? dates : []) {
        const date = new Date(dateStr);

        await tx.substitution.deleteMany({
          where: { schoolId, originalTeacherId: cancelTeacherId!, date },
        });

        const mark = await tx.staffAttendance.findFirst({ where: { schoolId, teacherId: cancelTeacherId!, date } });
        if (mark && mark.status === 'ON_LEAVE') {
          await tx.staffAttendance.delete({ where: { id: mark.id } });
        }
      }

      await tx.leaveApplication.update({ where: { id }, data: { status: 'CANCELLED' } });

      return { status: 'CANCELLED' as const, restoredDates: dates.length };
    });
  }

  /**
   * The open + filled coverage gaps in `[from, to]`, ordered by date then
   * period. `Substitution` has no Prisma relations beyond `School`, so
   * classSection/period/teacher names are joined in JS from separate lookups
   * rather than Prisma `include`.
   */
  async coverage(schoolId: string, from: string, to: string) {
    if (!isValidDateStr(from) || !isValidDateStr(to)) {
      throw new ApiError('VALIDATION', 'from/to must be formatted as YYYY-MM-DD', 400);
    }

    return withTenant(schoolId, async (tx) => {
      const rows = await tx.substitution.findMany({ take: LIST_CEILING.ACTIVITY,
        where: { schoolId, date: { gte: new Date(from), lte: new Date(to) } },
      });
      if (rows.length === 0) return [];

      const classSectionIds = [...new Set(rows.map((r) => r.classSectionId))];
      const periodIds = [...new Set(rows.map((r) => r.periodId))];
      const teacherIds = [
        ...new Set(
          rows.flatMap((r) => [r.originalTeacherId, r.substituteTeacherId]).filter((v): v is string => !!v),
        ),
      ];

      const [sections, periods, teachers] = await Promise.all([
        tx.classSection.findMany({ take: LIST_CEILING.STRUCTURE,
          where: { id: { in: classSectionIds } },
          select: { id: true, name: true, grade: { select: { name: true } } },
        }),
        tx.period.findMany({ take: LIST_CEILING.STRUCTURE, where: { id: { in: periodIds } }, select: { id: true, label: true, order: true } }),
        tx.teacher.findMany({ take: LIST_CEILING.STRUCTURE,
          where: { id: { in: teacherIds } },
          select: { id: true, firstName: true, lastName: true },
        }),
      ]);
      const sectionById = new Map(sections.map((s) => [s.id, s]));
      const periodById = new Map(periods.map((p) => [p.id, p]));
      const teacherById = new Map(teachers.map((t) => [t.id, t]));
      const teacherName = (teacherId: string | null): string | null => {
        if (!teacherId) return null;
        const t = teacherById.get(teacherId);
        return t ? `${t.firstName} ${t.lastName}` : 'Unknown teacher';
      };
      // "Grade 6 — A", matching how the timetable page's class picker labels
      // a section — the bare section name ("A") identifies nothing on its own.
      const sectionName = (sectionId: string): string => {
        const s = sectionById.get(sectionId);
        return s ? `${s.grade.name} — ${s.name}` : 'Unknown class';
      };

      return rows
        .map((r) => ({
          id: r.id,
          date: r.date,
          classSectionId: r.classSectionId,
          classSectionName: sectionName(r.classSectionId),
          periodId: r.periodId,
          periodLabel: periodById.get(r.periodId)?.label ?? 'Unknown period',
          _periodOrder: periodById.get(r.periodId)?.order ?? 0,
          originalTeacherName: teacherName(r.originalTeacherId) ?? 'Unknown teacher',
          substituteTeacherId: r.substituteTeacherId,
          substituteTeacherName: teacherName(r.substituteTeacherId),
        }))
        .sort((a, b) => a.date.getTime() - b.date.getTime() || a._periodOrder - b._periodOrder)
        .map(({ _periodOrder, ...rest }) => rest);
    });
  }

  /**
   * Assigns a substitute to a coverage gap. The substitute must actually be
   * free at that date+period: no ACTIVE timetable slot of their own in the
   * same weekday+period (reusing the same "busy" definition as
   * `TimetableService.availability`), and not already covering a different
   * gap at that exact date+period.
   */
  async assign(schoolId: string, id: string, dto: AssignSubstitutionDto) {
    return withTenant(schoolId, async (tx) => {
      const sub = await tx.substitution.findFirst({ where: { id, schoolId } });
      if (!sub) throw new NotFoundException('Substitution not found');

      const teacher = await tx.teacher.findFirst({ where: { id: dto.substituteTeacherId, schoolId } });
      if (!teacher) {
        throw new ApiError('VALIDATION', 'substituteTeacherId not found in this school', 400, 'substituteTeacherId');
      }

      const weekday = isoWeekdayOf(toDateStr(sub.date));

      const regularClash = await tx.timetableSlot.findFirst({
        where: {
          schoolId,
          teacherId: dto.substituteTeacherId,
          dayOfWeek: weekday,
          periodId: sub.periodId,
          effectiveTo: null,
        },
      });
      if (regularClash) {
        throw new ApiError(
          'TEACHER_CONFLICT',
          'That teacher already has a class in that period',
          409,
          'substituteTeacherId',
        );
      }

      const substitutionClash = await tx.substitution.findFirst({
        where: {
          schoolId,
          date: sub.date,
          periodId: sub.periodId,
          substituteTeacherId: dto.substituteTeacherId,
          NOT: { id: sub.id },
        },
      });
      if (substitutionClash) {
        throw new ApiError(
          'TEACHER_CONFLICT',
          'That teacher is already covering another class in that period',
          409,
          'substituteTeacherId',
        );
      }

      const updated = await tx.substitution.update({
        where: { id },
        data: { substituteTeacherId: dto.substituteTeacherId },
      });
      await this.tellSubstituteAssigned(tx, schoolId, sub, dto.substituteTeacherId);
      return updated;
    });
  }

  // ── notices ──────────────────────────────────────────────────────────────
  //
  // Written INSIDE the same transaction as the leave row (an in-app bell row
  // plus a guaranteed outbox row per recipient), so a request the admin can
  // see in Requests is a request that WILL reach their phone — never one
  // without the other. The outbox drain renders push + WhatsApp (+ signs the
  // Approve/Reject buttons at send time); email goes with the same facts.

  /** `Mon 22 – Tue 23 Sep 2026`, or one day. */
  static datesLabel(start: string, end: string): string {
    const fmt = (d: string, withYear: boolean) => {
      const x = new Date(`${d}T00:00:00Z`);
      const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][x.getUTCDay()];
      const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][x.getUTCMonth()];
      return `${day} ${x.getUTCDate()} ${mon}${withYear ? ` ${x.getUTCFullYear()}` : ''}`;
    };
    if (start === end) return fmt(start, true);
    // Same month: "Mon 21 – Tue 22 Sep 2026"; otherwise both months are named.
    const a = new Date(`${start}T00:00:00Z`);
    const b = new Date(`${end}T00:00:00Z`);
    if (a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear()) {
      const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][a.getUTCDay()];
      return `${day} ${a.getUTCDate()} – ${fmt(end, true)}`;
    }
    return `${fmt(start, false)} – ${fmt(end, true)}`;
  }

  private async tellAdminsApplied(tx: TenantTx, schoolId: string, leaveId: string, person: { kind: 'TEACHER' | 'STAFF'; id: string; firstName: string; lastName: string | null }, startDate: string, endDate: string, reason: string | null): Promise<void> {
    const [school, admins] = await Promise.all([
      tx.school.findFirst({ where: { id: schoolId }, select: { name: true } }),
      resolveAdminRecipients(tx, schoolId),
    ]);
    if (admins.length === 0) return;
    const dates = dateRangeInclusive(startDate, endDate);
    // How many of the teacher's active periods fall on the leave's weekdays.
    const weekdays = [...new Set(dates.map(isoWeekdayOf))];
    // Only a teacher has periods to cover. A driver's leave is just as real,
    // but asking the timetable about a staff id would join on nothing.
    const perWeekday = person.kind === 'TEACHER'
      ? await tx.timetableSlot.groupBy({ by: ['dayOfWeek'], where: { schoolId, teacherId: person.id, dayOfWeek: { in: weekdays }, effectiveTo: null }, _count: { _all: true } })
      : [];
    const countByDay = new Map(perWeekday.map((g) => [g.dayOfWeek, g._count._all]));
    const periodsAffected = dates.reduce((n, d) => n + (countByDay.get(isoWeekdayOf(d)) ?? 0), 0);
    const teacherName = `${person.firstName} ${person.lastName ?? ''}`.trim();
    const label = LeaveService.datesLabel(startDate, endDate);
    const payload = { schoolName: school?.name ?? 'Your school', leaveId, teacherName, dates: label, days: dates.length, reason, periodsAffected };
    const title = `${teacherName} has applied for leave`;
    const body = `${label} · ${dates.length} day${dates.length === 1 ? '' : 's'}${periodsAffected ? ` · ${periodsAffected} periods to cover` : ''}`;
    for (const a of admins) {
      await tx.notification.create({ data: { schoolId, userId: a.userId, kind: 'LEAVE_APPLIED', title, body, linkType: 'leave', linkId: leaveId } });
      await tx.notificationOutbox.create({ data: { schoolId, kind: 'LEAVE_APPLIED', payload, targetUserId: a.userId } });
    }
  }

  private async tellTeacherDecided(tx: TenantTx, schoolId: string, app: { id: string; teacherId: string | null; staffId: string | null; startDate: Date; endDate: Date }, decision: 'APPROVED' | 'REJECTED', adminUserId: string): Promise<void> {
    // Either kind of person hears back. A driver who is told nothing has to
    // walk to the office to find out, which is the thing this replaces.
    const [teacher, school] = await Promise.all([
      app.teacherId
        ? tx.teacher.findFirst({ where: { id: app.teacherId, schoolId }, select: { userId: true } })
        : tx.staff.findFirst({ where: { id: app.staffId!, schoolId }, select: { userId: true } }),
      tx.school.findFirst({ where: { id: schoolId }, select: { name: true } }),
    ]);
    if (!teacher?.userId) return;
    const label = LeaveService.datesLabel(toDateStr(app.startDate), toDateStr(app.endDate));
    const word = decision === 'APPROVED' ? 'approved' : 'not approved';
    const payload = { schoolName: school?.name ?? 'Your school', leaveId: app.id, decision, dates: label, byName: null as string | null, byUserId: adminUserId };
    await tx.notification.create({ data: { schoolId, userId: teacher.userId, kind: 'LEAVE_DECIDED', title: `Leave ${word}`, body: label, linkType: 'leave', linkId: app.id } });
    await tx.notificationOutbox.create({ data: { schoolId, kind: 'LEAVE_DECIDED', payload, targetUserId: teacher.userId } });
  }

  private async tellSubstituteAssigned(tx: TenantTx, schoolId: string, sub: { id: string; date: Date; periodId: string; classSectionId: string; originalTeacherId: string }, substituteTeacherId: string): Promise<void> {
    const [substitute, original, school, period, section, slot] = await Promise.all([
      tx.teacher.findFirst({ where: { id: substituteTeacherId, schoolId }, select: { userId: true } }),
      tx.teacher.findFirst({ where: { id: sub.originalTeacherId, schoolId }, select: { firstName: true, lastName: true } }),
      tx.school.findFirst({ where: { id: schoolId }, select: { name: true } }),
      tx.period.findFirst({ where: { id: sub.periodId, schoolId }, select: { label: true, startTime: true, endTime: true } }),
      tx.classSection.findFirst({ where: { id: sub.classSectionId, schoolId }, select: { name: true } }),
      tx.timetableSlot.findFirst({ where: { schoolId, classSectionId: sub.classSectionId, periodId: sub.periodId, dayOfWeek: isoWeekdayOf(toDateStr(sub.date)), effectiveTo: null }, select: { subject: { select: { name: true } } } }),
    ]);
    if (!substitute?.userId) return;
    const when = `${LeaveService.datesLabel(toDateStr(sub.date), toDateStr(sub.date))}, ${period ? `${period.label} (${period.startTime}–${period.endTime})` : 'a period'}`;
    const className = section?.name ?? 'a class';
    const payload = { schoolName: school?.name ?? 'Your school', substitutionId: sub.id, when, className, subjectName: slot?.subject?.name ?? null, originalTeacherName: original ? `${original.firstName} ${original.lastName ?? ''}`.trim() : 'a colleague' };
    await tx.notification.create({ data: { schoolId, userId: substitute.userId, kind: 'COVER_ASSIGNED', title: `You cover ${className}`, body: when, linkType: 'timetable', linkId: sub.id } });
    await tx.notificationOutbox.create({ data: { schoolId, kind: 'COVER_ASSIGNED', payload, targetUserId: substitute.userId } });
  }

  async clear(schoolId: string, id: string) {
    return withTenant(schoolId, async (tx) => {
      const sub = await tx.substitution.findFirst({ where: { id, schoolId } });
      if (!sub) throw new NotFoundException('Substitution not found');

      return tx.substitution.update({ where: { id }, data: { substituteTeacherId: null } });
    });
  }

  private resolveStatus(status: string | undefined): LeaveStatusValue {
    if (!status) return 'PENDING';
    if ((LEAVE_STATUSES as readonly string[]).includes(status)) return status as LeaveStatusValue;
    throw new ApiError('VALIDATION', 'status must be one of PENDING, APPROVED, REJECTED, CANCELLED', 400, 'status');
  }
}
