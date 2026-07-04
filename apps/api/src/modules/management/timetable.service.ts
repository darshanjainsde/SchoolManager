import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import { isP2002, isP2025, p2002Target } from './internal/prisma-errors';
import type { AssignSlotDto, AvailabilityQueryDto } from './management.dto';

@Injectable()
export class TimetableService {
  async listForClass(schoolId: string, classSectionId: string) {
    return withTenant(schoolId, (tx) =>
      tx.timetableSlot.findMany({
        where: { schoolId, classSectionId },
        orderBy: [{ dayOfWeek: 'asc' }, { period: { order: 'asc' } }],
        include: {
          period: true,
          subject: { select: { id: true, name: true, code: true } },
          teacher: { select: { id: true, firstName: true, lastName: true } },
          classSection: { select: { id: true, name: true } },
        },
      }),
    );
  }

  async assign(schoolId: string, dto: AssignSlotDto) {
    // Validate all referenced ids belong to this school (withTenant scopes by RLS).
    await withTenant(schoolId, async (tx) => {
      const cs = await tx.classSection.findUnique({ where: { id: dto.classSectionId } });
      if (!cs) throw new BadRequestException('classSectionId not found in this school');

      const period = await tx.period.findUnique({ where: { id: dto.periodId } });
      if (!period) throw new BadRequestException('periodId not found in this school');

      const subject = await tx.subject.findUnique({ where: { id: dto.subjectId } });
      if (!subject) throw new BadRequestException('subjectId not found in this school');

      const teacher = await tx.teacher.findUnique({ where: { id: dto.teacherId } });
      if (!teacher) throw new BadRequestException('teacherId not found in this school');

      const year = await tx.academicYear.findUnique({ where: { id: dto.academicYearId } });
      if (!year) throw new BadRequestException('academicYearId not found in this school');
    });

    try {
      return await withTenant(schoolId, async (tx) => {
        // Pre-check for class slot clash — gives correct 409 message before hitting DB unique.
        // We must check class clash first, then teacher clash, so error priority is consistent.
        const classClash = await tx.timetableSlot.findFirst({
          where: {
            schoolId,
            classSectionId: dto.classSectionId,
            dayOfWeek: dto.dayOfWeek,
            periodId: dto.periodId,
            academicYearId: dto.academicYearId,
          },
        });
        if (classClash) {
          throw new ConflictException('This class already has a subject in that period');
        }

        const teacherClash = await tx.timetableSlot.findFirst({
          where: {
            schoolId,
            teacherId: dto.teacherId,
            dayOfWeek: dto.dayOfWeek,
            periodId: dto.periodId,
            academicYearId: dto.academicYearId,
          },
        });
        if (teacherClash) {
          throw new ConflictException('That teacher is already booked in that period');
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
          },
          include: {
            period: true,
            subject: { select: { id: true, name: true, code: true } },
            teacher: { select: { id: true, firstName: true, lastName: true } },
            classSection: { select: { id: true, name: true } },
          },
        });
      });
    } catch (e) {
      // Safety net: if a race condition causes a P2002 to slip through the pre-checks,
      // inspect meta.target. On Prisma 5 + PG this version, meta.target is null (constraint
      // name not available in PG error message), so we fall back to a secondary lookup.
      if (isP2002(e)) {
        const target = p2002Target(e);
        // If Prisma did return a usable target, check it first.
        if (target.includes('teacher')) {
          throw new ConflictException('That teacher is already booked in that period');
        }
        // When target is null/empty (observed: meta = { modelName: 'TimetableSlot', target: null }),
        // determine the violated constraint with a secondary query.
        if (!target) {
          const teacherExists = await withTenant(schoolId, (tx) =>
            tx.timetableSlot.findFirst({
              where: {
                schoolId,
                teacherId: dto.teacherId,
                dayOfWeek: dto.dayOfWeek,
                periodId: dto.periodId,
                academicYearId: dto.academicYearId,
              },
            }),
          );
          if (teacherExists) {
            throw new ConflictException('That teacher is already booked in that period');
          }
        }
        throw new ConflictException('This class already has a subject in that period');
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
          where: { schoolId, academicYearId },
          select: { teacherId: true, dayOfWeek: true, periodId: true },
        }),
      ]);

      return { teachers, periods, busy: slots };
    });
  }

  async unassign(schoolId: string, id: string) {
    try {
      await withTenant(schoolId, (tx) =>
        tx.timetableSlot.delete({ where: { id } }),
      );
    } catch (e) {
      if (isP2025(e)) throw new NotFoundException('Timetable slot not found');
      throw e;
    }
  }
}
