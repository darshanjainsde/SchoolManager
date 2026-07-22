import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import { ApiError } from '../../common/errors/api-error';
import { isP2002, p2002Target } from './internal/prisma-errors';
import { isSameIstDay, resolveAsOfDate, startOfIstDay } from './internal/timetable-date';
import type { AssignSlotDto, AvailabilityQueryDto } from './management.dto';

const SLOT_INCLUDE = {
  period: true,
  subject: { select: { id: true, name: true, code: true } },
  teacher: { select: { id: true, firstName: true, lastName: true } },
  classSection: { select: { id: true, name: true } },
} as const;

@Injectable()
export class TimetableService {
  /**
   * The slot versions ACTIVE on `date` (default: today) for `classSectionId`
   * — i.e. `effectiveFrom <= date AND (effectiveTo IS NULL OR effectiveTo > date)`.
   * Reading a past `date` returns whatever version was active back then, even
   * if it has since been superseded — that's what makes past weeks immutable.
   */
  async listForClass(schoolId: string, classSectionId: string, date?: string) {
    const asOf = resolveAsOfDate(date, new Date());
    return withTenant(schoolId, (tx) =>
      tx.timetableSlot.findMany({
        where: {
          schoolId,
          classSectionId,
          effectiveFrom: { lte: asOf },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: asOf } }],
        },
        orderBy: [{ dayOfWeek: 'asc' }, { period: { order: 'asc' } }],
        include: SLOT_INCLUDE,
      }),
    );
  }

  /**
   * Versioned assign: never mutates an existing slot's teacher/subject in
   * place. For the target (classSectionId, dayOfWeek, periodId, academicYearId):
   *  - no ACTIVE version (effectiveTo IS NULL) → create one, effectiveFrom = today.
   *  - an ACTIVE version exists and differs → close it (effectiveTo = today)
   *    and create a new ACTIVE version (effectiveFrom = today). The old row
   *    is kept forever, so a past `date` read still sees it.
   *  - an ACTIVE version exists, was itself first created today, and differs
   *    → update it in place instead of stacking two versions on the same
   *    calendar day (versioning is day-granular; there is no "past" instant
   *    to preserve within the same day, and the effectiveFrom unique index
   *    would otherwise collide).
   *  - an ACTIVE version exists and matches exactly (same subject + teacher)
   *    → no-op, return it as-is.
   * Teacher-clash detection is unchanged in spirit: a teacher can't hold two
   * ACTIVE slots in the same day+period, excluding the very slot being
   * replaced.
   */
  async assign(schoolId: string, dto: AssignSlotDto) {
    try {
      return await withTenant(schoolId, async (tx) => {
        const [cs, period, subject, teacher, year] = await Promise.all([
          tx.classSection.findUnique({ where: { id: dto.classSectionId } }),
          tx.period.findUnique({ where: { id: dto.periodId } }),
          tx.subject.findUnique({ where: { id: dto.subjectId } }),
          tx.teacher.findUnique({ where: { id: dto.teacherId } }),
          tx.academicYear.findUnique({ where: { id: dto.academicYearId } }),
        ]);
        if (!cs) throw new BadRequestException('classSectionId not found in this school');
        if (!period) throw new BadRequestException('periodId not found in this school');
        if (!subject) throw new BadRequestException('subjectId not found in this school');
        if (!teacher) throw new BadRequestException('teacherId not found in this school');
        if (!year) throw new BadRequestException('academicYearId not found in this school');

        const today = startOfIstDay(new Date());

        const activeForSlot = await tx.timetableSlot.findFirst({
          where: {
            schoolId,
            classSectionId: dto.classSectionId,
            dayOfWeek: dto.dayOfWeek,
            periodId: dto.periodId,
            academicYearId: dto.academicYearId,
            effectiveTo: null,
          },
        });

        const teacherClash = await tx.timetableSlot.findFirst({
          where: {
            schoolId,
            teacherId: dto.teacherId,
            dayOfWeek: dto.dayOfWeek,
            periodId: dto.periodId,
            academicYearId: dto.academicYearId,
            effectiveTo: null,
            ...(activeForSlot ? { NOT: { id: activeForSlot.id } } : {}),
          },
        });
        if (teacherClash) {
          throw new ApiError(
            'TEACHER_CONFLICT',
            'That teacher is already booked in that period',
            409,
            'teacherId',
          );
        }

        if (activeForSlot) {
          const unchanged =
            activeForSlot.subjectId === dto.subjectId && activeForSlot.teacherId === dto.teacherId;
          if (unchanged) {
            return tx.timetableSlot.findUniqueOrThrow({
              where: { id: activeForSlot.id },
              include: SLOT_INCLUDE,
            });
          }

          if (isSameIstDay(activeForSlot.effectiveFrom, today)) {
            // Same-day correction: update in place rather than stacking a
            // second version on the same calendar day.
            return tx.timetableSlot.update({
              where: { id: activeForSlot.id },
              data: { subjectId: dto.subjectId, teacherId: dto.teacherId },
              include: SLOT_INCLUDE,
            });
          }

          await tx.timetableSlot.update({
            where: { id: activeForSlot.id },
            data: { effectiveTo: today },
          });
        }

        return tx.timetableSlot.create({
          data: {
            schoolId,
            classSectionId: dto.classSectionId,
            dayOfWeek: dto.dayOfWeek,
            periodId: dto.periodId,
            subjectId: dto.subjectId,
            teacherId: dto.teacherId,
            academicYearId: dto.academicYearId,
            effectiveFrom: today,
          },
          include: SLOT_INCLUDE,
        });
      });
    } catch (e) {
      // Safety net: a race condition between the pre-checks above and the
      // create/update can still surface as a P2002 on either unique index.
      if (isP2002(e)) {
        const target = p2002Target(e);
        if (target.includes('teacher')) {
          throw new ApiError(
            'TEACHER_CONFLICT',
            'That teacher is already booked in that period',
            409,
            'teacherId',
          );
        }
        if (!target) {
          const teacherExists = await withTenant(schoolId, (tx) =>
            tx.timetableSlot.findFirst({
              where: {
                schoolId,
                teacherId: dto.teacherId,
                dayOfWeek: dto.dayOfWeek,
                periodId: dto.periodId,
                academicYearId: dto.academicYearId,
                effectiveTo: null,
              },
            }),
          );
          if (teacherExists) {
            throw new ApiError(
              'TEACHER_CONFLICT',
              'That teacher is already booked in that period',
              409,
              'teacherId',
            );
          }
        }
        throw new BadRequestException('This slot was just updated by someone else — please retry');
      }
      throw e;
    }
  }

  async availability(schoolId: string, query: AvailabilityQueryDto) {
    return withTenant(schoolId, async (tx) => {
      // Resolve the academic year: use query param if provided, else fall back to isCurrent.
      let academicYearId = query.academicYearId;
      if (!academicYearId) {
        const current = await tx.academicYear.findFirst({
          where: { schoolId, isCurrent: true },
        });
        if (!current) {
          // No current year — return teachers + periods with an empty busy list.
          const [teachers, periods] = await Promise.all([
            tx.teacher.findMany({
              where: { schoolId, isActive: true },
              select: { id: true, firstName: true, lastName: true },
              orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
            }),
            tx.period.findMany({
              where: { schoolId },
              select: { id: true, order: true, label: true },
              orderBy: { order: 'asc' },
            }),
          ]);
          return { teachers, periods, busy: [] };
        }
        academicYearId = current.id;
      }

      const [teachers, periods, slots] = await Promise.all([
        tx.teacher.findMany({
          where: { schoolId, isActive: true },
          select: { id: true, firstName: true, lastName: true },
          orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        }),
        tx.period.findMany({
          where: { schoolId },
          select: { id: true, order: true, label: true },
          orderBy: { order: 'asc' },
        }),
        tx.timetableSlot.findMany({
          where: { schoolId, academicYearId, effectiveTo: null },
          select: { teacherId: true, dayOfWeek: true, periodId: true },
        }),
      ]);

      return { teachers, periods, busy: slots };
    });
  }

  /** Closes the active version (`effectiveTo = today`) rather than deleting — history is preserved. */
  async unassign(schoolId: string, id: string) {
    const today = startOfIstDay(new Date());
    await withTenant(schoolId, async (tx) => {
      const slot = await tx.timetableSlot.findFirst({
        where: { id, schoolId, effectiveTo: null },
      });
      if (!slot) throw new NotFoundException('Timetable slot not found');

      await tx.timetableSlot.update({
        where: { id },
        data: { effectiveTo: today },
      });
    });
  }
}
