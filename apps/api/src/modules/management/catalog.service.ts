import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import { isP2002 } from './internal/prisma-errors';
import type {
  CreateYearDto,
  CreateGradeDto,
  UpdateGradeDto,
  CreateSubjectDto,
  UpdateSubjectDto,
  CreatePeriodDto,
  UpdatePeriodDto,
} from './management.dto';

@Injectable()
export class CatalogService {
  // ── Academic Years ─────────────────────────────────────────────────────────

  async listYears(schoolId: string) {
    return withTenant(schoolId, (tx) =>
      tx.academicYear.findMany({
        where: { schoolId },
        orderBy: { startDate: 'asc' },
      }),
    );
  }

  async createYear(schoolId: string, dto: CreateYearDto) {
    try {
      return await withTenant(schoolId, (tx) =>
        tx.academicYear.create({
          data: {
            ...dto,
            startDate: new Date(dto.startDate),
            endDate: new Date(dto.endDate),
            schoolId,
          },
        }),
      );
    } catch (e) {
      if (isP2002(e)) throw new ConflictException('An academic year with that name already exists');
      throw e;
    }
  }

  // ── Grades ─────────────────────────────────────────────────────────────────

  async listGrades(schoolId: string) {
    return withTenant(schoolId, (tx) =>
      tx.grade.findMany({ where: { schoolId }, orderBy: { order: 'asc' } }),
    );
  }

  async createGrade(schoolId: string, dto: CreateGradeDto) {
    try {
      return await withTenant(schoolId, (tx) =>
        tx.grade.create({ data: { ...dto, schoolId } }),
      );
    } catch (e) {
      if (isP2002(e)) throw new ConflictException('A grade with that name already exists');
      throw e;
    }
  }

  async updateGrade(schoolId: string, id: string, dto: UpdateGradeDto) {
    await withTenant(schoolId, async (tx) => {
      const existing = await tx.grade.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException(`Grade ${id} not found`);
    });
    try {
      return await withTenant(schoolId, (tx) =>
        tx.grade.update({ where: { id }, data: dto }),
      );
    } catch (e) {
      if (isP2002(e)) throw new ConflictException('A grade with that name already exists');
      throw e;
    }
  }

  async deleteGrade(schoolId: string, id: string) {
    await withTenant(schoolId, async (tx) => {
      const existing = await tx.grade.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException(`Grade ${id} not found`);
      await tx.grade.delete({ where: { id } });
    });
  }

  // ── Subjects ───────────────────────────────────────────────────────────────

  async listSubjects(schoolId: string) {
    return withTenant(schoolId, (tx) =>
      tx.subject.findMany({ where: { schoolId }, orderBy: { name: 'asc' } }),
    );
  }

  async createSubject(schoolId: string, dto: CreateSubjectDto) {
    try {
      return await withTenant(schoolId, (tx) =>
        tx.subject.create({ data: { ...dto, schoolId } }),
      );
    } catch (e) {
      if (isP2002(e)) throw new ConflictException('A subject with that code already exists');
      throw e;
    }
  }

  async updateSubject(schoolId: string, id: string, dto: UpdateSubjectDto) {
    await withTenant(schoolId, async (tx) => {
      const existing = await tx.subject.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException(`Subject ${id} not found`);
    });
    try {
      return await withTenant(schoolId, (tx) =>
        tx.subject.update({ where: { id }, data: dto }),
      );
    } catch (e) {
      if (isP2002(e)) throw new ConflictException('A subject with that code already exists');
      throw e;
    }
  }

  async deleteSubject(schoolId: string, id: string) {
    await withTenant(schoolId, async (tx) => {
      const existing = await tx.subject.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException(`Subject ${id} not found`);
      await tx.subject.delete({ where: { id } });
    });
  }

  // ── Periods ────────────────────────────────────────────────────────────────

  async listPeriods(schoolId: string) {
    return withTenant(schoolId, (tx) =>
      tx.period.findMany({ where: { schoolId }, orderBy: { order: 'asc' } }),
    );
  }

  async createPeriod(schoolId: string, dto: CreatePeriodDto) {
    try {
      return await withTenant(schoolId, (tx) =>
        tx.period.create({ data: { ...dto, schoolId } }),
      );
    } catch (e) {
      if (isP2002(e)) throw new ConflictException('A period with that order already exists');
      throw e;
    }
  }

  async updatePeriod(schoolId: string, id: string, dto: UpdatePeriodDto) {
    await withTenant(schoolId, async (tx) => {
      const existing = await tx.period.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException(`Period ${id} not found`);
    });
    try {
      return await withTenant(schoolId, (tx) =>
        tx.period.update({ where: { id }, data: dto }),
      );
    } catch (e) {
      if (isP2002(e)) throw new ConflictException('A period with that order already exists');
      throw e;
    }
  }

  async deletePeriod(schoolId: string, id: string) {
    await withTenant(schoolId, async (tx) => {
      const existing = await tx.period.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException(`Period ${id} not found`);
      await tx.period.delete({ where: { id } });
    });
  }
}
