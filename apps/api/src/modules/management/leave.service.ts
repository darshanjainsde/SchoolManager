import { Injectable, NotFoundException } from '@nestjs/common';
import { withTenant, type TenantTx, type UserRole } from '@skoolos/db';
import { LEAVE_STATUSES, type LeaveApplication, type LeaveStatusValue } from '@skoolos/types';
import { ApiError } from '../../common/errors/api-error';
import { dateRangeInclusive, inHalf, isValidDateStr, isoWeekdayOf, toDateStr, todayIstDateStr } from './internal/leave-dates';
import { workingDates } from './internal/school-calendar';
import { freeTeachersFor, type CoverCandidate } from './internal/free-teachers';
import { liveSlotWhere } from './internal/timetable-date';
import type { AssignSubstitutionDto, CreateLeaveDto } from './management.dto';
import { LIST_CEILING } from '../../common/lists/list-ceiling';
import { resolveLeaveDeskRecipients } from '../../common/notifications/recipients';
import { requestOutboxDrain } from '../../common/notifications/outbox-signal';
import { shortDayDate } from '../../common/dates/timetable-date';
import type { CoverCancelledPayload } from '../../common/notifications/notification.types';

export type { LeaveApplication };

/** The most days one leave request may cover. */
export const MAX_LEAVE_DAYS = 60;

/** Raw `LeaveApplication` row shape as Prisma returns it — dates still `Date`. */
type LeaveApplicationRow = {
  id: string;
  type: string;
  startDate: Date;
  endDate: Date;
  reason: string | null;
  status: string;
  halfDay?: boolean;
  halfDayPart?: string | null;
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
      halfDayPart: (a.halfDayPart as 'AM' | 'PM' | null | undefined) ?? null,
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
    const start = dto.startDate.slice(0, 10);
    const end = dto.endDate.slice(0, 10);
    if (end < start) {
      throw new ApiError('VALIDATION', 'endDate must be on or after startDate', 400, 'endDate');
    }
    // The DB carries this as a CHECK. Refusing it here means the person is
    // told what is wrong instead of being shown a constraint violation.
    if (dto.halfDay && end !== start) {
      throw new ApiError('VALIDATION', 'A half day is one day. Pick the same date for both, or turn the half day off.', 400, 'halfDay');
    }
    if (dto.halfDayPart && !dto.halfDay) {
      throw new ApiError('VALIDATION', 'Morning or afternoon is only for a half day.', 400, 'halfDayPart');
    }
    // School days are IST days: at 23:00 IST "today" is still today.
    if (start < todayIstDateStr(new Date())) {
      throw new ApiError('LEAVE_IN_PAST', 'Leave cannot start on a day that has already gone. Ask the office to record it.', 400, 'startDate');
    }
    if (dateRangeInclusive(start, end).length > MAX_LEAVE_DAYS) {
      throw new ApiError('LEAVE_TOO_LONG', `One request can cover at most ${MAX_LEAVE_DAYS} days. Apply for a longer leave in parts.`, 400, 'endDate');
    }

    const out = await withTenant(schoolId, async (tx) => {
      const person = await LeaveService.personFor(tx, schoolId, callerUserId);
      if (!person) {
        throw new ApiError('NOT_A_TEACHER', 'Only a teacher or a staff member can apply for leave', 403);
      }
      if (person.isActive === false) {
        throw new ApiError('LEAVE_INACTIVE', 'This login belongs to someone who no longer works here, so it cannot apply for leave.', 403);
      }
      const clash = await LeaveService.overlapping(tx, schoolId, person, start, end, dto);
      if (clash) {
        const word = clash.status === 'APPROVED' ? 'approved' : 'pending';
        throw new ApiError('LEAVE_OVERLAP', `You already have ${word} leave for ${LeaveService.datesLabel(toDateStr(clash.startDate), toDateStr(clash.endDate))}. Cancel it or pick other dates.`, 409, 'startDate');
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
          halfDayPart: dto.halfDay ? (dto.halfDayPart ?? null) : null,
          reason: dto.reason,
        },
      });
      await this.tellDeskApplied(tx, schoolId, callerUserId, created.id, person, start, end, dto.reason ?? null, dto);
      return LeaveService.toRow(created);
    });
    requestOutboxDrain();
    return out;
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
  ): Promise<{ kind: 'TEACHER' | 'STAFF'; id: string; firstName: string; lastName: string | null; isActive: boolean } | null> {
    const teacher = await tx.teacher.findFirst({
      where: { schoolId, userId },
      select: { id: true, firstName: true, lastName: true, isActive: true },
    });
    if (teacher) return { kind: 'TEACHER', ...teacher };
    const staff = await tx.staff.findFirst({
      where: { schoolId, userId },
      select: { id: true, firstName: true, lastName: true, isActive: true },
    });
    return staff ? { kind: 'STAFF', ...staff } : null;
  }

  /** The one-person filter for whichever record this login turned out to be. */
  private static whereIs(person: { kind: 'TEACHER' | 'STAFF'; id: string }) {
    return person.kind === 'TEACHER' ? { teacherId: person.id } : { staffId: person.id };
  }

  /**
   * Leave of the same person that shares a date with [start, end]. The morning
   * and the afternoon of one date are two halves, not a clash.
   */
  private static async overlapping(
    tx: TenantTx,
    schoolId: string,
    person: { kind: 'TEACHER' | 'STAFF'; id: string },
    start: string,
    end: string,
    dto: { halfDay?: boolean; halfDayPart?: 'AM' | 'PM' },
  ) {
    const rows = await tx.leaveApplication.findMany({
      take: 5,
      where: {
        schoolId,
        ...LeaveService.whereIs(person),
        status: { in: ['PENDING', 'APPROVED'] },
        startDate: { lte: new Date(end) },
        endDate: { gte: new Date(start) },
      },
      select: { startDate: true, endDate: true, status: true, halfDay: true, halfDayPart: true },
    });
    return rows.find((r) => !(dto.halfDay && r.halfDay && dto.halfDayPart && r.halfDayPart && dto.halfDayPart !== r.halfDayPart)) ?? null;
  }

  /**
   * THE DECISION, RACE-SAFE. Two desks — the admin on the console, the
   * officer on WhatsApp — can tap within the same second. The update only
   * matches a row still PENDING, so Postgres lets exactly one through (READ
   * COMMITTED: the loser's update waits on the winner's row lock, then
   * re-checks the WHERE against the committed row and matches nothing); the
   * other is told who decided and when. The loser throws BEFORE any side
   * effect, so its transaction writes nothing at all.
   */
  private static async decide(tx: TenantTx, schoolId: string, id: string, deciderUserId: string, to: 'APPROVED' | 'REJECTED') {
    const app = await tx.leaveApplication.findFirst({ where: { id, schoolId } });
    if (!app) throw new NotFoundException('Leave application not found');
    if (app.status !== 'PENDING') throw await LeaveService.alreadyDecided(tx, schoolId, id);
    await LeaveService.refuseOwn(tx, schoolId, app, deciderUserId);
    const decided = { status: to, reviewedById: deciderUserId, reviewedAt: new Date() };
    const { count } = await tx.leaveApplication.updateMany({
      where: { id, schoolId, status: 'PENDING' },
      data: decided,
    });
    if (count === 0) throw await LeaveService.alreadyDecided(tx, schoolId, id);
    // The row as the update left it — what `update()` used to return.
    return { ...app, ...decided };
  }

  /**
   * Nobody decides their own leave — on the console or on WhatsApp. The
   * applicant's login is the Teacher.userId or Staff.userId of the person the
   * row belongs to. (A school whose only admin applies for leave can then not
   * have it decided by that admin; that is the rule, not a gap.)
   */
  private static async refuseOwn(tx: TenantTx, schoolId: string, app: { teacherId: string | null; staffId: string | null }, deciderUserId: string): Promise<void> {
    const owner = app.teacherId
      ? await tx.teacher.findFirst({ where: { id: app.teacherId, schoolId }, select: { userId: true } })
      : app.staffId
        ? await tx.staff.findFirst({ where: { id: app.staffId, schoolId }, select: { userId: true } })
        : null;
    if (owner?.userId && owner.userId === deciderUserId) {
      throw new ApiError('LEAVE_OWN_DECISION', 'You cannot decide your own leave. Another admin or the accounts officer has to.', 403);
    }
  }

  /** The 409 for a decision that lost — read AFTER the winner committed, so it names the winner. */
  private static async alreadyDecided(tx: TenantTx, schoolId: string, id: string): Promise<ApiError> {
    const fresh = await tx.leaveApplication.findFirst({ where: { id, schoolId }, select: { status: true, reviewedById: true, reviewedAt: true } });
    // A cancel stamps no reviewer: on a CANCELLED row, reviewedBy/At are the
    // earlier APPROVER's, so naming them would credit the wrong person.
    const reviewed = fresh?.status === 'APPROVED' || fresh?.status === 'REJECTED';
    const by = reviewed && fresh?.reviewedById ? await LeaveService.nameOf(tx, schoolId, fresh.reviewedById) : null;
    return new ApiError('LEAVE_NOT_PENDING', LeaveService.decidedSentence(fresh?.status, by, reviewed ? fresh?.reviewedAt ?? null : null), 409);
  }

  private static async nameOf(tx: TenantTx, schoolId: string, userId: string): Promise<string | null> {
    const u = await tx.user.findFirst({ where: { id: userId, schoolId }, select: { name: true, email: true } });
    return u ? (u.name?.trim() || u.email.split('@')[0]) : null;
  }

  /**
   * "Already approved by Darshan Jain at 9:42 am. Nothing changed." — and
   * "… on Tue 6 Oct at 9:42 am …" when the decision was not today. Always the
   * IST clock and the IST calendar day, whatever the server's TZ. IST has no
   * daylight saving, so a fixed +05:30 is exact, and it avoids ICU's
   * locale-dependent "am"/"AM" and narrow no-break space.
   */
  static decidedSentence(status: string | undefined, byName: string | null, at: Date | null, now: Date = new Date()): string {
    const word = status === 'APPROVED' ? 'approved' : status === 'REJECTED' ? 'rejected' : status === 'CANCELLED' ? 'withdrawn' : 'decided';
    const by = byName ? ` by ${byName}` : '';
    return `Already ${word}${by}${at ? LeaveService.istWhen(at, now) : ''}. Nothing changed.`;
  }

  /** " at 9:42 am" today (IST), " on Tue 6 Oct at 9:42 am" another day, with the year only when it differs. */
  private static istWhen(at: Date, now: Date): string {
    const IST_MS = 330 * 60_000;
    const a = new Date(at.getTime() + IST_MS); // UTC fields of `a` = IST wall clock of `at`
    const n = new Date(now.getTime() + IST_MS);
    const h24 = a.getUTCHours();
    const clock = `${h24 % 12 === 0 ? 12 : h24 % 12}:${String(a.getUTCMinutes()).padStart(2, '0')} ${h24 < 12 ? 'am' : 'pm'}`;
    const sameDay = a.toISOString().slice(0, 10) === n.toISOString().slice(0, 10);
    if (sameDay) return ` at ${clock}`;
    const full = shortDayDate(a); // "Tue 6 Oct 2026" — reads the UTC fields, i.e. the IST day
    const day = a.getUTCFullYear() === n.getUTCFullYear() ? full.replace(/ \d{4}$/, '') : full;
    return ` on ${day} at ${clock}`;
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
          ? tx.teacher.findMany({ take: LIST_CEILING.STRUCTURE, where: { id: { in: [...new Set(teacherIds)] } }, select: { id: true, firstName: true, lastName: true, userId: true } })
          : Promise.resolve([]),
        staffIds.length
          ? tx.staff.findMany({ take: LIST_CEILING.STRUCTURE, where: { id: { in: [...new Set(staffIds)] } }, select: { id: true, firstName: true, lastName: true, role: true, userId: true } })
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
          // The applicant's own login, so a desk can keep the viewer off their
          // own leave before the API has to refuse it (LEAVE_OWN_DECISION).
          personUserId: who?.userId ?? null,
        };
      });
    });
  }

  async reject(schoolId: string, id: string, adminUserId: string) {
    const out = await withTenant(schoolId, async (tx) => {
      const app = await LeaveService.decide(tx, schoolId, id, adminUserId, 'REJECTED');
      await this.tellTeacherDecided(tx, schoolId, app, 'REJECTED', adminUserId);
      return app;
    });
    requestOutboxDrain();
    return out;
  }

  /**
   * Approves the application, then — for every WORKING day of the leave
   * (School.workingDays minus holidays) — opens one gap (an unfilled
   * `Substitution` row) per timetable slot LIVE on that date (only the away
   * half's periods on a half day), linked to this leave by
   * `leaveApplicationId`, AND marks the teacher `ON_LEAVE` in
   * `StaffAttendance` for every working date that is today-or-later (IST) —
   * see `markOnLeaveIfDue` below. A half day keeps the whole day's ON_LEAVE
   * mark (there is no half-day attendance status).
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
    const out = await withTenant(schoolId, async (tx) => {
      // Only the winner gets past this line: a losing desk throws the 409
      // here, before any gap, attendance mark or notice is written.
      const app = await LeaveService.decide(tx, schoolId, id, adminUserId, 'APPROVED');

      // Only WORKING days: a Sunday or Diwali inside the span has no class to
      // cover and no attendance to mark (the same calendar the balance uses).
      const dates = await workingDates(tx, schoolId, toDateStr(app.startDate), toDateStr(app.endDate));
      const todayStr = todayIstDateStr(new Date());

      // Substitutions and the staff-attendance mark are TEACHER work: a driver
      // has no timetable to cover and no class waiting for one. A staff leave
      // is approved and that is the whole of it.
      const teacherId = app.teacherId;
      let gaps = 0;
      const gapIds: string[] = [];
      for (const dateStr of teacherId ? dates : []) {
        const date = new Date(dateStr);
        for (const slot of await LeaveService.slotsOfTheDay(tx, schoolId, teacherId!, dateStr, app)) {
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
              leaveApplicationId: app.id,
            },
          });
          gaps += 1;
          gapIds.push(gap.id);
        }

        if (dateStr >= todayStr) {
          await this.markOnLeaveIfDue(tx, schoolId, teacherId!, date, adminUserId);
        }
      }

      // A teacher who was covering someone else on these days cannot now: those
      // covers reopen, the teacher is told, and the desk hears how many.
      if (teacherId) await LeaveService.reopenCoversOf(tx, schoolId, teacherId, dates.filter((d) => d >= todayStr), app);

      await this.tellTeacherDecided(tx, schoolId, app, 'APPROVED', adminUserId);
      return { gaps, gapIds };
    });
    requestOutboxDrain();
    return out;
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
   * The teacher's slots LIVE on that date (`effectiveFrom <= date AND
   * (effectiveTo IS NULL OR effectiveTo > date)` — a timetable published
   * mid-leave changes the answer from that date on), cut to the half they are
   * away for.
   */
  private static async slotsOfTheDay(
    tx: TenantTx,
    schoolId: string,
    teacherId: string,
    dateStr: string,
    app: { halfDay?: boolean | null; halfDayPart?: string | null },
  ) {
    const slots = await tx.timetableSlot.findMany({
      take: LIST_CEILING.ACTIVITY,
      where: { schoolId, teacherId, dayOfWeek: isoWeekdayOf(dateStr), ...liveSlotWhere(dateStr) },
      select: { classSectionId: true, periodId: true, period: { select: { startTime: true } } },
    });
    return slots.filter((s) => inHalf(app, s.period?.startTime));
  }

  /**
   * Cancels a leave application — no approval step, unlike reject. Allowed
   * for the OWNING teacher (`callerRole === 'TEACHER'` and their own
   * `Teacher.id === app.teacherId`) or any `SCHOOL_ADMIN`; anyone else gets
   * `LEAVE_CANCEL_FORBIDDEN`. `REJECTED`/already-`CANCELLED` applications
   * have nothing to cancel (`LEAVE_NOT_CANCELLABLE`).
   *
   * - `PENDING` → straight to `CANCELLED`; nothing was generated for it, but
   *   the leave desk was holding Approve/Reject buttons, so it is told.
   * - `APPROVED` → for every date in `[startDate, endDate]` that is
   *   today-or-later (IST) — PAST dates are immutable and are left exactly
   *   as they were — deletes THIS leave's `Substitution` gaps (by
   *   `leaveApplicationId`; an old gap from before that column, NULL, falls
   *   back to the teacher-and-date rule), covered or not: removing the
   *   override row restores the original teacher on the recurring timetable.
   *   Each substitute who had one of those covers is told it is off. The
   *   `ON_LEAVE` mark for a date is cleared IF it is still `ON_LEAVE` and no
   *   other approved leave of the same teacher still covers that date (a
   *   morning and an afternoon are two leaves). The desk is told, minus the
   *   person who cancelled.
   * - Raced: a PENDING cancel that loses to an approve unwinds that approval
   *   in the same transaction; one that loses to a reject or another cancel
   *   is a 409 `LEAVE_NOT_PENDING` naming who decided. Two cancels of one
   *   APPROVED leave unwind it exactly once.
   *
   * Returns `{ status: 'CANCELLED', restoredDates }` — `restoredDates` is
   * the count of today-or-later dates that were processed (0 for a
   * `PENDING` cancel, or for an `APPROVED` cancel whose whole window is
   * already in the past).
   */
  async cancel(schoolId: string, id: string, callerUserId: string, callerRole: UserRole) {
    const out = await withTenant(schoolId, async (tx) => {
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

      // RACE-SAFE, like decide(): every status change matches the status this
      // transaction believes in, so a desk approving in the same second can
      // never be overwritten blind.
      if (app.status === 'PENDING') {
        const { count } = await tx.leaveApplication.updateMany({
          where: { id, schoolId, status: 'PENDING' },
          data: { status: 'CANCELLED' },
        });
        if (count === 1) {
          // Nothing was generated for a pending request — but the desk was
          // holding Approve/Reject buttons for it.
          await LeaveService.tellDeskCancelled(tx, schoolId, app, 0, callerUserId);
          return { status: 'CANCELLED' as const, restoredDates: 0 };
        }
        // Somebody decided first. If they APPROVED, their gaps and ON_LEAVE
        // marks are committed and the teacher was told "approved" — cancel
        // the approved leave properly (below) rather than strand them. A
        // rejection or another cancel is final: say who, and change nothing.
        const fresh = await tx.leaveApplication.findFirst({ where: { id, schoolId }, select: { status: true } });
        if (fresh?.status !== 'APPROVED') throw await LeaveService.alreadyDecided(tx, schoolId, id);
      }

      // APPROVED. Claim the row FIRST: the conditional update takes the row
      // lock, so of two concurrent cancels exactly one matches APPROVED and
      // unwinds; the other waits, re-checks, matches nothing and is told.
      const { count: claimed } = await tx.leaveApplication.updateMany({
        where: { id, schoolId, status: 'APPROVED' },
        data: { status: 'CANCELLED' },
      });
      if (claimed === 0) throw await LeaveService.alreadyDecided(tx, schoolId, id);

      // Restore every today-or-later date, leaving past dates untouched.
      const todayStr = todayIstDateStr(new Date());
      const dates = dateRangeInclusive(toDateStr(app.startDate), toDateStr(app.endDate)).filter(
        (d) => d >= todayStr,
      );

      // Same split as approve: only a teacher has substitutions to unwind.
      const cancelTeacherId = app.teacherId;
      let released = 0;
      if (cancelTeacherId && dates.length > 0) {
        // Only THIS leave's gaps — a second leave overlapping these dates keeps
        // its own. Gaps from before leaveApplicationId existed (NULL) fall back
        // to the old teacher-and-date rule.
        const gaps = await tx.substitution.findMany({
          take: LIST_CEILING.ACTIVITY,
          where: {
            schoolId,
            date: { in: dates.map((d) => new Date(d)) },
            OR: [{ leaveApplicationId: id }, { leaveApplicationId: null, originalTeacherId: cancelTeacherId }],
          },
          select: { id: true, date: true, periodId: true, classSectionId: true, substituteTeacherId: true },
        });
        await LeaveService.tellSubstitutes(tx, schoolId, gaps, 'LEAVE_CANCELLED');
        released = gaps.filter((g) => g.substituteTeacherId).length;
        if (gaps.length > 0) await tx.substitution.deleteMany({ where: { id: { in: gaps.map((g) => g.id) }, schoolId } });

        // A date another approved leave of this teacher still covers (the
        // afternoon half of the same day) keeps its ON_LEAVE mark.
        const stillAway = await LeaveService.datesOfOtherLeave(tx, schoolId, cancelTeacherId, id, dates);
        for (const dateStr of dates) {
          if (stillAway.has(dateStr)) continue;
          const date = new Date(dateStr);
          const mark = await tx.staffAttendance.findFirst({ where: { schoolId, teacherId: cancelTeacherId, date } });
          if (mark && mark.status === 'ON_LEAVE') {
            await tx.staffAttendance.delete({ where: { id: mark.id } });
          }
        }
      }

      await LeaveService.tellDeskCancelled(tx, schoolId, app, released, callerUserId);
      return { status: 'CANCELLED' as const, restoredDates: dates.length };
    });
    requestOutboxDrain();
    return out;
  }

  /** The dates (of `dates`) that another APPROVED leave of this teacher still covers. */
  private static async datesOfOtherLeave(tx: TenantTx, schoolId: string, teacherId: string, exceptLeaveId: string, dates: string[]): Promise<Set<string>> {
    const others = await tx.leaveApplication.findMany({
      take: LIST_CEILING.ACTIVITY,
      where: {
        schoolId,
        teacherId,
        status: 'APPROVED',
        id: { not: exceptLeaveId },
        startDate: { lte: new Date(dates[dates.length - 1]) },
        endDate: { gte: new Date(dates[0]) },
      },
      select: { startDate: true, endDate: true },
    });
    return new Set(dates.filter((d) => others.some((o) => toDateStr(o.startDate) <= d && d <= toDateStr(o.endDate))));
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
          // When the substitute tapped "Got it" — null until they do, and again after any reassignment.
          acknowledgedAt: r.acknowledgedAt ?? null,
        }))
        .sort((a, b) => a.date.getTime() - b.date.getTime() || a._periodOrder - b._periodOrder)
        .map(({ _periodOrder, ...rest }) => rest);
    });
  }

  /** Who is free for this gap — the same answer the dropdown, WhatsApp and assign() use. */
  async candidates(schoolId: string, substitutionId: string): Promise<CoverCandidate[]> {
    return withTenant(schoolId, async (tx) => {
      const sub = await tx.substitution.findFirst({ where: { id: substitutionId, schoolId } });
      if (!sub) throw new NotFoundException('Substitution not found');
      return freeTeachersFor(tx, schoolId, sub);
    });
  }

  /**
   * Assigns a substitute to a coverage gap. The substitute must be one
   * `freeTeachersFor()` offers for this gap — so the console, WhatsApp and the
   * API agree on "free" by construction. A new substitute has not seen it
   * yet, so any earlier "seen" is cleared; a substitute it is taken from is
   * told.
   *
   * RACE-SAFE, like decide(): two desks can pick a teacher for the same gap in
   * the same second. The write is a compare-and-set on the substitute THIS
   * desk saw, so exactly one wins (READ COMMITTED: the loser's update waits on
   * the winner's row lock, re-checks, and matches nothing). The loser throws
   * before any notice, so only ONE cover card goes out — and a loser who
   * wanted the very teacher the winner chose is simply told it is done.
   */
  async assign(schoolId: string, id: string, dto: AssignSubstitutionDto) {
    const out = await withTenant(schoolId, async (tx) => {
      const sub = await tx.substitution.findFirst({ where: { id, schoolId } });
      if (!sub) throw new NotFoundException('Substitution not found');
      // Already theirs: nothing to change, and no second card.
      if (sub.substituteTeacherId === dto.substituteTeacherId) return sub;

      // ONE definition of "free": whoever freeTeachersFor would not offer is refused.
      const free = await freeTeachersFor(tx, schoolId, sub);
      if (!free.some((c) => c.id === dto.substituteTeacherId)) {
        throw new ApiError('TEACHER_CONFLICT', 'That teacher is not free then — they teach, cover or are on leave in that period.', 409, 'substituteTeacherId');
      }

      const { count } = await tx.substitution.updateMany({
        where: { id, schoolId, substituteTeacherId: sub.substituteTeacherId },
        // A new substitute has not seen it yet.
        data: { substituteTeacherId: dto.substituteTeacherId, acknowledgedAt: null },
      });
      if (count === 0) return LeaveService.changedMeanwhile(tx, schoolId, id, dto.substituteTeacherId);

      // Taking the period from one teacher to give it to another: tell the first.
      if (sub.substituteTeacherId) await LeaveService.tellSubstitutes(tx, schoolId, [sub], 'CHANGED');
      await this.tellSubstituteAssigned(tx, schoolId, sub, dto.substituteTeacherId);
      return { ...sub, substituteTeacherId: dto.substituteTeacherId, acknowledgedAt: null };
    });
    requestOutboxDrain();
    return out;
  }

  // ── the substitute answers (WhatsApp "Got it" / "Can't") ──────────────────

  /** The covering teacher, by login — or a refusal that names no one else. */
  private static async substituteOf(tx: TenantTx, schoolId: string, userId: string) {
    const teacher = await tx.teacher.findFirst({ where: { schoolId, userId }, select: { id: true, firstName: true, lastName: true } });
    if (!teacher) throw new ApiError('NOT_THE_SUBSTITUTE', 'Only the teacher covering this period can answer for it.', 403);
    return teacher;
  }

  /** "Got it" — the first tap's time is kept; only the teacher covering it now can say it. */
  async acknowledge(schoolId: string, substitutionId: string, teacherUserId: string): Promise<{ acknowledgedAt: Date }> {
    return withTenant(schoolId, async (tx) => {
      const teacher = await LeaveService.substituteOf(tx, schoolId, teacherUserId);
      const sub = await tx.substitution.findFirst({ where: { id: substitutionId, schoolId, substituteTeacherId: teacher.id }, select: { acknowledgedAt: true } });
      if (!sub) throw new ApiError('NOT_THE_SUBSTITUTE', 'This cover is no longer yours.', 409);
      if (sub.acknowledgedAt) return { acknowledgedAt: sub.acknowledgedAt };
      const acknowledgedAt = new Date();
      // Compare-and-set like every other write to a gap: a Got it racing a
      // reassignment never marks the NEW substitute as having seen it.
      const { count } = await tx.substitution.updateMany({
        where: { id: substitutionId, schoolId, substituteTeacherId: teacher.id, acknowledgedAt: null },
        data: { acknowledgedAt },
      });
      if (count === 0) {
        const again = await tx.substitution.findFirst({ where: { id: substitutionId, schoolId, substituteTeacherId: teacher.id }, select: { acknowledgedAt: true } });
        if (again?.acknowledgedAt) return { acknowledgedAt: again.acknowledgedAt };
        throw new ApiError('NOT_THE_SUBSTITUTE', 'This cover is no longer yours.', 409);
      }
      return { acknowledgedAt };
    });
  }

  /**
   * "Can't" — the cover goes back to the desk, which is told at once.
   * Compare-and-set on THIS teacher: a Can't tapped after the desk gave the
   * period to someone else matches nothing and changes nothing (409).
   */
  async decline(schoolId: string, substitutionId: string, teacherUserId: string): Promise<{ declined: true }> {
    const out = await withTenant(schoolId, async (tx) => {
      const teacher = await LeaveService.substituteOf(tx, schoolId, teacherUserId);
      const { count } = await tx.substitution.updateMany({
        where: { id: substitutionId, schoolId, substituteTeacherId: teacher.id },
        data: { substituteTeacherId: null, acknowledgedAt: null },
      });
      if (count === 0) throw new ApiError('NOT_THE_SUBSTITUTE', 'This cover is no longer yours, so nothing changed.', 409);
      const sub = await tx.substitution.findFirst({ where: { id: substitutionId, schoolId }, select: { id: true, date: true, periodId: true, classSectionId: true } });
      if (!sub) return { declined: true as const };
      const [school, described] = await Promise.all([
        tx.school.findFirst({ where: { id: schoolId }, select: { name: true } }),
        LeaveService.describeGaps(tx, schoolId, [sub]),
      ]);
      const d = described.get(sub.id)!;
      const name = `${teacher.firstName} ${teacher.lastName ?? ''}`.trim();
      const day = toDateStr(sub.date);
      await LeaveService.tellDesk(tx, schoolId, {
        kind: 'COVER_UNFILLED',
        payload: { schoolName: school?.name ?? 'Your school', gaps: 1, forDate: day, forWhen: LeaveService.datesLabel(day, day), note: `${name} can't take ${d.className}, ${d.when}.` },
        title: `${name} can't cover ${d.className}`,
        body: d.when,
        linkId: null,
        // A substitute who also runs the desk does not need telling what they just said.
        exceptUserId: teacherUserId,
      });
      return { declined: true as const };
    });
    requestOutboxDrain();
    return out;
  }

  /**
   * A compare-and-set on a gap matched nothing: someone changed it between
   * this desk's read and its write. If it now holds exactly what this desk
   * wanted, that is success (and nobody is told twice); otherwise a 409 that
   * says where the period went.
   */
  private static async changedMeanwhile(tx: TenantTx, schoolId: string, id: string, wanted: string | null) {
    const fresh = await tx.substitution.findFirst({ where: { id, schoolId } });
    if (!fresh) throw new NotFoundException('Substitution not found');
    if (fresh.substituteTeacherId === wanted) return fresh;
    const now = fresh.substituteTeacherId
      ? await tx.teacher.findFirst({ where: { id: fresh.substituteTeacherId, schoolId }, select: { firstName: true, lastName: true } })
      : null;
    const where = now ? `it is now with ${`${now.firstName} ${now.lastName ?? ''}`.trim()}` : 'it has just been cleared';
    throw new ApiError('TEACHER_CONFLICT', `Someone changed this cover a moment ago — ${where}. Nothing was changed; look again and pick.`, 409, 'substituteTeacherId');
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

  private async tellDeskApplied(
    tx: TenantTx,
    schoolId: string,
    applicantUserId: string,
    leaveId: string,
    person: { kind: 'TEACHER' | 'STAFF'; id: string; firstName: string; lastName: string | null },
    startDate: string,
    endDate: string,
    reason: string | null,
    half: { halfDay?: boolean | null; halfDayPart?: string | null },
  ): Promise<void> {
    const [school, desk] = await Promise.all([
      tx.school.findFirst({ where: { id: schoolId }, select: { name: true } }),
      resolveLeaveDeskRecipients(tx, schoolId, { exceptUserId: applicantUserId }),
    ]);
    if (desk.length === 0) return;
    const dates = dateRangeInclusive(startDate, endDate);
    // "N periods to cover" is exactly the gaps approve() would open: working
    // days only, slots live THAT day, only the away half — the same two
    // helpers, so the request and the approval can never disagree. Only a
    // teacher has periods; asking the timetable about a staff id joins nothing.
    let periodsAffected = 0;
    if (person.kind === 'TEACHER') {
      for (const d of await workingDates(tx, schoolId, startDate, endDate)) {
        periodsAffected += (await LeaveService.slotsOfTheDay(tx, schoolId, person.id, d, half)).length;
      }
    }
    const teacherName = `${person.firstName} ${person.lastName ?? ''}`.trim();
    const label = LeaveService.datesLabel(startDate, endDate);
    const payload = { schoolName: school?.name ?? 'Your school', leaveId, teacherName, dates: label, days: dates.length, reason, periodsAffected };
    const title = `${teacherName} has applied for leave`;
    const body = `${label} · ${dates.length} day${dates.length === 1 ? '' : 's'}${periodsAffected ? ` · ${periodsAffected} periods to cover` : ''}`;
    for (const a of desk) {
      await tx.notification.create({ data: { schoolId, userId: a.userId, kind: 'LEAVE_APPLIED', title, body, linkType: 'leave', linkId: leaveId } });
      await tx.notificationOutbox.create({ data: { schoolId, kind: 'LEAVE_APPLIED', payload, targetUserId: a.userId }, select: { id: true } });
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
    const payload = { schoolName: school?.name ?? 'Your school', leaveId: app.id, decision, dates: label, byName: await LeaveService.nameOf(tx, schoolId, adminUserId), byUserId: adminUserId };
    await tx.notification.create({ data: { schoolId, userId: teacher.userId, kind: 'LEAVE_DECIDED', title: `Leave ${word}`, body: label, linkType: 'leave', linkId: app.id } });
    await tx.notificationOutbox.create({ data: { schoolId, kind: 'LEAVE_DECIDED', payload, targetUserId: teacher.userId }, select: { id: true } });
  }

  private async tellSubstituteAssigned(tx: TenantTx, schoolId: string, sub: { id: string; date: Date; periodId: string; classSectionId: string; originalTeacherId: string }, substituteTeacherId: string): Promise<void> {
    const [substitute, original, school, period, section, slot] = await Promise.all([
      tx.teacher.findFirst({ where: { id: substituteTeacherId, schoolId }, select: { userId: true } }),
      tx.teacher.findFirst({ where: { id: sub.originalTeacherId, schoolId }, select: { firstName: true, lastName: true } }),
      tx.school.findFirst({ where: { id: schoolId }, select: { name: true } }),
      tx.period.findFirst({ where: { id: sub.periodId, schoolId }, select: { label: true, startTime: true, endTime: true } }),
      tx.classSection.findFirst({ where: { id: sub.classSectionId, schoolId }, select: { name: true, grade: { select: { name: true } } } }),
      // The subject of the slot LIVE that date — the same rule as the gap itself.
      tx.timetableSlot.findFirst({ where: { schoolId, classSectionId: sub.classSectionId, periodId: sub.periodId, dayOfWeek: isoWeekdayOf(toDateStr(sub.date)), ...liveSlotWhere(toDateStr(sub.date)) }, select: { subject: { select: { name: true } } } }),
    ]);
    if (!substitute?.userId) return;
    const when = `${LeaveService.datesLabel(toDateStr(sub.date), toDateStr(sub.date))}, ${period ? `${period.label} (${period.startTime}–${period.endTime})` : 'a period'}`;
    // "9-A", as every other leave-desk notice names a class — "A" alone names nothing.
    const className = section ? (section.grade?.name ? `${section.grade.name}-${section.name}` : section.name) : 'a class';
    // substituteTeacherId: who the card is FOR — the Can't button is signed with it at send time.
    const payload = { schoolName: school?.name ?? 'Your school', substitutionId: sub.id, substituteTeacherId, when, className, subjectName: slot?.subject?.name ?? null, originalTeacherName: original ? `${original.firstName} ${original.lastName ?? ''}`.trim() : 'a colleague' };
    await tx.notification.create({ data: { schoolId, userId: substitute.userId, kind: 'COVER_ASSIGNED', title: `You cover ${className}`, body: when, linkType: 'timetable', linkId: sub.id } });
    await tx.notificationOutbox.create({ data: { schoolId, kind: 'COVER_ASSIGNED', payload, targetUserId: substitute.userId }, select: { id: true } });
  }

  /** "Mon 22 Sep 2026, Period 3 (10:15–11:00)" and "9-A" for each gap — two queries, not one per gap. */
  private static async describeGaps(tx: TenantTx, schoolId: string, subs: { id: string; date: Date; periodId: string; classSectionId: string }[]) {
    const [periods, sections] = await Promise.all([
      tx.period.findMany({ take: LIST_CEILING.STRUCTURE, where: { schoolId, id: { in: [...new Set(subs.map((s) => s.periodId))] } }, select: { id: true, label: true, startTime: true, endTime: true } }),
      tx.classSection.findMany({ take: LIST_CEILING.STRUCTURE, where: { schoolId, id: { in: [...new Set(subs.map((s) => s.classSectionId))] } }, select: { id: true, name: true, grade: { select: { name: true } } } }),
    ]);
    const periodOf = new Map(periods.map((p) => [p.id, p]));
    const sectionOf = new Map(sections.map((c) => [c.id, c]));
    return new Map(
      subs.map((s) => {
        const p = periodOf.get(s.periodId);
        const c = sectionOf.get(s.classSectionId);
        const day = LeaveService.datesLabel(toDateStr(s.date), toDateStr(s.date));
        return [s.id, { when: `${day}, ${p ? `${p.label} (${p.startTime}–${p.endTime})` : 'a period'}`, className: c ? `${c.grade.name}-${c.name}` : 'a class' }];
      }),
    );
  }

  /**
   * "Your cover is off" — one bell row and one outbox row per substitute who
   * HAD the cover. A gap nobody was covering tells nobody; a substitute with
   * no login has no inbox to reach.
   */
  static async tellSubstitutes(
    tx: TenantTx,
    schoolId: string,
    subs: { id: string; date: Date; periodId: string; classSectionId: string; substituteTeacherId: string | null }[],
    why: CoverCancelledPayload['why'],
  ): Promise<void> {
    const covered = subs.filter((s) => s.substituteTeacherId);
    if (covered.length === 0) return;
    const [school, teachers, described] = await Promise.all([
      tx.school.findFirst({ where: { id: schoolId }, select: { name: true } }),
      tx.teacher.findMany({ take: LIST_CEILING.STRUCTURE, where: { schoolId, id: { in: [...new Set(covered.map((s) => s.substituteTeacherId!))] } }, select: { id: true, userId: true } }),
      LeaveService.describeGaps(tx, schoolId, covered),
    ]);
    const userOf = new Map(teachers.map((t) => [t.id, t.userId]));
    for (const s of covered) {
      const userId = userOf.get(s.substituteTeacherId!);
      const d = described.get(s.id);
      if (!userId || !d) continue;
      const payload = { schoolName: school?.name ?? 'Your school', substitutionId: s.id, when: d.when, className: d.className, why };
      // Bell kind COVER_ASSIGNED: every client already has its icon and link; the title says it is off.
      await tx.notification.create({ data: { schoolId, userId, kind: 'COVER_ASSIGNED', title: `Cover called off: ${d.className}`, body: d.when, linkType: 'timetable', linkId: s.id } });
      await tx.notificationOutbox.create({ data: { schoolId, kind: 'COVER_CANCELLED', payload, targetUserId: userId }, select: { id: true } });
    }
  }

  /**
   * A notice to everyone who runs the leave desk (admins + accounts officers),
   * minus the person whose own action caused it. Bell kind LEAVE_APPLIED so
   * every client already has an icon and a link for it; the title says what
   * happened. Returns how many were told. Public: the 18:00 nudge uses it.
   */
  static async tellDesk(
    db: TenantTx,
    schoolId: string,
    n: { kind: 'LEAVE_CANCELLED' | 'COVER_UNFILLED'; payload: Record<string, string | number | null>; title: string; body: string; linkId: string | null; exceptUserId?: string | null },
  ): Promise<number> {
    const desk = await resolveLeaveDeskRecipients(db, schoolId, n.exceptUserId ? { exceptUserId: n.exceptUserId } : {});
    for (const d of desk) {
      await db.notification.create({ data: { schoolId, userId: d.userId, kind: 'LEAVE_APPLIED', title: n.title, body: n.body, linkType: 'leave', linkId: n.linkId } });
      await db.notificationOutbox.create({ data: { schoolId, kind: n.kind, payload: n.payload, targetUserId: d.userId }, select: { id: true } });
    }
    return desk.length;
  }

  /**
   * A teacher going on leave cannot cover anyone else those days: their covers
   * (on the away half) reopen, they are told, and the desk is told how many
   * classes are empty again. `dates` are the working, today-or-later dates.
   */
  private static async reopenCoversOf(
    tx: TenantTx,
    schoolId: string,
    teacherId: string,
    dates: string[],
    app: { id: string; halfDay?: boolean | null; halfDayPart?: string | null },
  ): Promise<number> {
    if (dates.length === 0) return 0;
    const covers = await tx.substitution.findMany({
      take: LIST_CEILING.ACTIVITY,
      where: { schoolId, substituteTeacherId: teacherId, date: { in: dates.map((d) => new Date(d)) } },
      select: { id: true, date: true, periodId: true, classSectionId: true, substituteTeacherId: true },
    });
    if (covers.length === 0) return 0;
    const periods = await tx.period.findMany({ take: LIST_CEILING.STRUCTURE, where: { schoolId, id: { in: [...new Set(covers.map((c) => c.periodId))] } }, select: { id: true, startTime: true } });
    const startOf = new Map(periods.map((p) => [p.id, p.startTime]));
    // A half day frees only the other half: a morning leave keeps their afternoon covers.
    const away = covers.filter((c) => inHalf(app, startOf.get(c.periodId)));
    if (away.length === 0) return 0;
    // Compare-and-set: only covers that are still theirs.
    await tx.substitution.updateMany({ where: { id: { in: away.map((c) => c.id) }, schoolId, substituteTeacherId: teacherId }, data: { substituteTeacherId: null, acknowledgedAt: null } });
    await LeaveService.tellSubstitutes(tx, schoolId, away, 'TEACHER_ON_LEAVE');

    const days = [...new Set(away.map((c) => toDateStr(c.date)))].sort();
    const [school, who] = await Promise.all([
      tx.school.findFirst({ where: { id: schoolId }, select: { name: true } }),
      tx.teacher.findFirst({ where: { id: teacherId, schoolId }, select: { firstName: true, lastName: true } }),
    ]);
    const name = who ? `${who.firstName} ${who.lastName ?? ''}`.trim() : 'A teacher';
    const n = away.length;
    await LeaveService.tellDesk(tx, schoolId, {
      kind: 'COVER_UNFILLED',
      payload: {
        schoolName: school?.name ?? 'Your school',
        gaps: n,
        forDate: days[0],
        forWhen: LeaveService.datesLabel(days[0], days[days.length - 1]),
        note: `${name} is on leave, so ${n === 1 ? 'one of their covers has' : `${n} of their covers have`} reopened.`,
      },
      title: `${n} cover${n === 1 ? '' : 's'} reopened`,
      body: `${name} is on leave`,
      linkId: app.id,
      // The approver too: approving a leave does not show them the teacher was covering for others.
    });
    return n;
  }

  /** "Priya Nair withdrew their leave" — to the desk, minus whoever withdrew it. */
  private static async tellDeskCancelled(
    tx: TenantTx,
    schoolId: string,
    app: { id: string; teacherId: string | null; staffId: string | null; startDate: Date; endDate: Date },
    releasedCovers: number,
    exceptUserId: string,
  ): Promise<void> {
    const [school, who] = await Promise.all([
      tx.school.findFirst({ where: { id: schoolId }, select: { name: true } }),
      app.teacherId
        ? tx.teacher.findFirst({ where: { id: app.teacherId, schoolId }, select: { firstName: true, lastName: true } })
        : app.staffId
          ? tx.staff.findFirst({ where: { id: app.staffId, schoolId }, select: { firstName: true, lastName: true } })
          : null,
    ]);
    const teacherName = who ? `${who.firstName} ${who.lastName ?? ''}`.trim() : 'A colleague';
    const dates = LeaveService.datesLabel(toDateStr(app.startDate), toDateStr(app.endDate));
    await LeaveService.tellDesk(tx, schoolId, {
      kind: 'LEAVE_CANCELLED',
      payload: { schoolName: school?.name ?? 'Your school', leaveId: app.id, teacherName, dates, releasedCovers },
      title: `${teacherName} withdrew their leave`,
      body: releasedCovers ? `${dates} · ${releasedCovers} cover${releasedCovers === 1 ? '' : 's'} released` : dates,
      linkId: app.id,
      exceptUserId,
    });
  }

  /**
   * Takes the substitute off a gap (the desk's "clear"). The teacher who was
   * covering is told; an empty gap tells nobody. Compare-and-set like
   * assign(): a clear racing a reassignment never clears the NEW cover blind.
   */
  async clear(schoolId: string, id: string) {
    const out = await withTenant(schoolId, async (tx) => {
      const sub = await tx.substitution.findFirst({ where: { id, schoolId } });
      if (!sub) throw new NotFoundException('Substitution not found');
      if (!sub.substituteTeacherId) return sub;

      const { count } = await tx.substitution.updateMany({
        where: { id, schoolId, substituteTeacherId: sub.substituteTeacherId },
        data: { substituteTeacherId: null, acknowledgedAt: null },
      });
      if (count === 0) return LeaveService.changedMeanwhile(tx, schoolId, id, null);
      await LeaveService.tellSubstitutes(tx, schoolId, [sub], 'CHANGED');
      return { ...sub, substituteTeacherId: null, acknowledgedAt: null };
    });
    requestOutboxDrain();
    return out;
  }

  private resolveStatus(status: string | undefined): LeaveStatusValue {
    if (!status) return 'PENDING';
    if ((LEAVE_STATUSES as readonly string[]).includes(status)) return status as LeaveStatusValue;
    throw new ApiError('VALIDATION', 'status must be one of PENDING, APPROVED, REJECTED, CANCELLED', 400, 'status');
  }
}
