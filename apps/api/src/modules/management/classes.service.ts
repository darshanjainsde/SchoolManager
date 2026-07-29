import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import type { ClassSectionSummary } from '@skoolos/types';
import { isP2002, isP2003, isP2025 } from '../../common/errors/prisma-errors';
import type { CreateClassDto, UpdateClassDto } from './management.dto';

interface RefOptions {
  gradeId?: string;
  academicYearId?: string;
  classTeacherId?: string;
}

/**
 * The full `list()` row: `ClassSectionSummary` (`@skoolos/types`) plus the
 * admin-only fields (`classTeacher`, student `_count`) the SCHOOL_ADMIN
 * classes screen also reads off this same response.
 */
type ClassSectionAdminRow = ClassSectionSummary & {
  classTeacher: { firstName: string; lastName: string } | null;
  _count: { students: number };
};

@Injectable()
export class ClassesService {
  async list(schoolId: string): Promise<ClassSectionAdminRow[]> {
    return withTenant(schoolId, (tx) =>
      tx.classSection.findMany({
        where: { schoolId },
        orderBy: [{ grade: { order: 'asc' } }, { name: 'asc' }],
        include: {
          grade: { select: { name: true } },
          classTeacher: { select: { firstName: true, lastName: true } },
          _count: { select: { students: true } },
        },
      }),
    );
  }

  async create(schoolId: string, dto: CreateClassDto) {
    await this.validateRefs(schoolId, {
      gradeId: dto.gradeId,
      academicYearId: dto.academicYearId,
      classTeacherId: dto.classTeacherId,
    });
    try {
      return await withTenant(schoolId, (tx) =>
        tx.classSection.create({
          data: { ...dto, schoolId },
        }),
      );
    } catch (e) {
      if (isP2002(e))
        throw new ConflictException('A class with that grade/section/year already exists');
      throw e;
    }
  }

  async update(schoolId: string, id: string, dto: UpdateClassDto) {
    // Only validate refs that are actually being changed
    const refs: RefOptions = {};
    if (dto.gradeId !== undefined) refs.gradeId = dto.gradeId;
    if (dto.academicYearId !== undefined) refs.academicYearId = dto.academicYearId;
    if (dto.classTeacherId !== undefined) refs.classTeacherId = dto.classTeacherId;
    if (Object.keys(refs).length > 0) {
      await this.validateRefs(schoolId, refs);
    }

    try {
      return await withTenant(schoolId, (tx) =>
        tx.classSection.update({ where: { id }, data: dto }),
      );
    } catch (e) {
      if (isP2025(e)) throw new NotFoundException('Class section not found');
      if (isP2002(e))
        throw new ConflictException('A class with that grade/section/year already exists');
      throw e;
    }
  }

  async remove(schoolId: string, id: string) {
    try {
      await withTenant(schoolId, (tx) => tx.classSection.delete({ where: { id } }));
    } catch (e) {
      if (isP2025(e)) throw new NotFoundException('Class section not found');
      if (isP2003(e))
        throw new ConflictException(
          'Cannot delete: other records still reference this class section',
        );
      throw e;
    }
  }

  /**
   * Validates that the referenced grade, academicYear, and (optionally) classTeacher
   * all belong to the same school. Uses withTenant so RLS scopes lookups — a foreign
   * id returns null and we surface a 400 instead of a FK 500.
   */
  private async validateRefs(schoolId: string, refs: RefOptions) {
    await withTenant(schoolId, async (tx) => {
      if (refs.gradeId !== undefined) {
        const grade = await tx.grade.findUnique({ where: { id: refs.gradeId } });
        if (!grade) throw new BadRequestException('grade not found');
      }
      if (refs.academicYearId !== undefined) {
        const year = await tx.academicYear.findUnique({ where: { id: refs.academicYearId } });
        if (!year) throw new BadRequestException('academicYear not found');
      }
      if (refs.classTeacherId !== undefined) {
        const teacher = await tx.teacher.findUnique({ where: { id: refs.classTeacherId } });
        if (!teacher) throw new BadRequestException('classTeacher not found');
      }
    });
  }
}
