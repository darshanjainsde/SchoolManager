import { Injectable, NotFoundException } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import { ApiError } from '../../common/errors/api-error';
import { dateRangeInclusive, isValidDateStr, isoWeekdayOf, toDateStr } from './internal/leave-dates';
import type { AssignSubstitutionDto, CreateLeaveDto } from './management.dto';

const LEAVE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
type LeaveStatusValue = (typeof LEAVE_STATUSES)[number];

@Injectable()
export class LeaveService {
  /**
   * Creates a PENDING leave application for the CALLER's own Teacher record
   * (resolved from the JWT's `userId` via `Teacher.userId`). A caller with no
   * linked Teacher row — e.g. a SCHOOL_ADMIN who isn't also a teacher — gets
   * `NOT_A_TEACHER` rather than silently creating a bogus application.
   */
  async apply(schoolId: string, callerUserId: string, dto: CreateLeaveDto) {
    if (dto.endDate < dto.startDate) {
      throw new ApiError('VALIDATION', 'endDate must be on or after startDate', 400, 'endDate');
    }

    return withTenant(schoolId, async (tx) => {
      const teacher = await tx.teacher.findFirst({ where: { userId: callerUserId } });
      if (!teacher) {
        throw new ApiError('NOT_A_TEACHER', 'Only teachers can apply for leave', 403);
      }

      return tx.leaveApplication.create({
        data: {
          schoolId,
          teacherId: teacher.id,
          type: dto.type,
          startDate: new Date(dto.startDate),
          endDate: new Date(dto.endDate),
          reason: dto.reason,
        },
      });
    });
  }

  /** The caller's own leave applications, most recent first. */
  async mine(schoolId: string, callerUserId: string) {
    return withTenant(schoolId, async (tx) => {
      const teacher = await tx.teacher.findFirst({ where: { userId: callerUserId } });
      if (!teacher) return [];

      return tx.leaveApplication.findMany({
        where: { schoolId, teacherId: teacher.id },
        orderBy: { createdAt: 'desc' },
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
      const apps = await tx.leaveApplication.findMany({
        where: { schoolId, status: resolved },
        orderBy: { createdAt: 'desc' },
      });
      if (apps.length === 0) return [];

      const teacherIds = [...new Set(apps.map((a) => a.teacherId))];
      const teachers = await tx.teacher.findMany({
        where: { id: { in: teacherIds } },
        select: { id: true, firstName: true, lastName: true },
      });
      const byId = new Map(teachers.map((t) => [t.id, t]));

      return apps.map((a) => {
        const t = byId.get(a.teacherId);
        return { ...a, teacherName: t ? `${t.firstName} ${t.lastName}` : 'Unknown teacher' };
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

      return tx.leaveApplication.update({
        where: { id },
        data: { status: 'REJECTED', reviewedById: adminUserId, reviewedAt: new Date() },
      });
    });
  }

  /**
   * Approves the application, then generates a coverage gap — an unfilled
   * `Substitution` row — for every one of the teacher's ACTIVE timetable
   * slots (`effectiveTo IS NULL`) on every weekday the leave spans.
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

      let gaps = 0;
      for (const dateStr of dates) {
        const weekday = isoWeekdayOf(dateStr);
        const date = new Date(dateStr);

        const slots = await tx.timetableSlot.findMany({
          where: { schoolId, teacherId: app.teacherId, dayOfWeek: weekday, effectiveTo: null },
          select: { classSectionId: true, periodId: true },
        });

        for (const slot of slots) {
          const existing = await tx.substitution.findFirst({
            where: { classSectionId: slot.classSectionId, periodId: slot.periodId, date },
          });
          if (existing) continue;

          await tx.substitution.create({
            data: {
              schoolId,
              classSectionId: slot.classSectionId,
              periodId: slot.periodId,
              date,
              originalTeacherId: app.teacherId,
              reason: 'leave',
            },
          });
          gaps += 1;
        }
      }

      return { gaps };
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
      const rows = await tx.substitution.findMany({
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
        tx.classSection.findMany({ where: { id: { in: classSectionIds } }, select: { id: true, name: true } }),
        tx.period.findMany({ where: { id: { in: periodIds } }, select: { id: true, label: true, order: true } }),
        tx.teacher.findMany({
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

      return rows
        .map((r) => ({
          id: r.id,
          date: r.date,
          classSectionId: r.classSectionId,
          classSectionName: sectionById.get(r.classSectionId)?.name ?? 'Unknown class',
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

      return tx.substitution.update({
        where: { id },
        data: { substituteTeacherId: dto.substituteTeacherId },
      });
    });
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
    throw new ApiError('VALIDATION', 'status must be one of PENDING, APPROVED, REJECTED', 400, 'status');
  }
}
