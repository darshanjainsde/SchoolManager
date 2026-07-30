import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import type { ClassNoteVisibilityValue, Subject } from '@skoolos/types';
import { isP2002, isP2003, isP2025 } from '../../common/errors/prisma-errors';
import type {
  CreateYearDto,
  CreateGradeDto,
  UpdateGradeDto,
  CreateSubjectDto,
  UpdateSubjectDto,
  CreatePeriodDto,
  UpdatePeriodDto,
} from './management.dto';

/** Dedupe + ascending-sort a raw day-of-week list (1=Mon … 7=Sun). */
function normalizeWorkingDays(days: number[]): number[] {
  return Array.from(new Set(days)).sort((a, b) => a - b);
}

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
    try {
      return await withTenant(schoolId, (tx) =>
        tx.grade.update({ where: { id }, data: dto }),
      );
    } catch (e) {
      if (isP2025(e)) throw new NotFoundException('Grade not found');
      if (isP2002(e)) throw new ConflictException('A grade with that name already exists');
      throw e;
    }
  }

  async deleteGrade(schoolId: string, id: string) {
    try {
      await withTenant(schoolId, (tx) => tx.grade.delete({ where: { id } }));
    } catch (e) {
      if (isP2025(e)) throw new NotFoundException('Grade not found');
      if (isP2003(e)) throw new ConflictException('Cannot delete: other records still reference this grade');
      throw e;
    }
  }

  // ── Subjects ───────────────────────────────────────────────────────────────

  /** Matches the shared `Subject` contract (`@skoolos/types`) field for field — `GET /manage/subjects`. */
  async listSubjects(schoolId: string): Promise<Subject[]> {
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
    try {
      return await withTenant(schoolId, (tx) =>
        tx.subject.update({ where: { id }, data: dto }),
      );
    } catch (e) {
      if (isP2025(e)) throw new NotFoundException('Subject not found');
      if (isP2002(e)) throw new ConflictException('A subject with that code already exists');
      throw e;
    }
  }

  async deleteSubject(schoolId: string, id: string) {
    try {
      await withTenant(schoolId, (tx) => tx.subject.delete({ where: { id } }));
    } catch (e) {
      if (isP2025(e)) throw new NotFoundException('Subject not found');
      if (isP2003(e)) throw new ConflictException('Cannot delete: other records still reference this subject');
      throw e;
    }
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
    try {
      return await withTenant(schoolId, (tx) =>
        tx.period.update({ where: { id }, data: dto }),
      );
    } catch (e) {
      if (isP2025(e)) throw new NotFoundException('Period not found');
      if (isP2002(e)) throw new ConflictException('A period with that order already exists');
      throw e;
    }
  }

  async deletePeriod(schoolId: string, id: string) {
    try {
      await withTenant(schoolId, (tx) => tx.period.delete({ where: { id } }));
    } catch (e) {
      if (isP2025(e)) throw new NotFoundException('Period not found');
      if (isP2003(e)) throw new ConflictException('Cannot delete: other records still reference this period');
      throw e;
    }
  }

  // ── Working days ─────────────────────────────────────────────────────────────

  async getWorkingDays(schoolId: string) {
    const school = await withTenant(schoolId, (tx) =>
      tx.school.findUnique({ where: { id: schoolId }, select: { workingDays: true } }),
    );
    if (!school) throw new NotFoundException('School not found');
    return { workingDays: school.workingDays };
  }

  async updateWorkingDays(schoolId: string, workingDays: number[]) {
    const normalized = normalizeWorkingDays(workingDays);
    try {
      const school = await withTenant(schoolId, (tx) =>
        tx.school.update({ where: { id: schoolId }, data: { workingDays: normalized } }),
      );
      return { workingDays: school.workingDays };
    } catch (e) {
      if (isP2025(e)) throw new NotFoundException('School not found');
      throw e;
    }
  }

  // ── Class note visibility ─────────────────────────────────────────────────

  async getClassNoteVisibility(schoolId: string) {
    const school = await withTenant(schoolId, (tx) =>
      tx.school.findUnique({ where: { id: schoolId }, select: { classNoteVisibility: true } }),
    );
    if (!school) throw new NotFoundException('School not found');
    return { classNoteVisibility: school.classNoteVisibility };
  }

  async updateClassNoteVisibility(schoolId: string, classNoteVisibility: ClassNoteVisibilityValue) {
    try {
      const school = await withTenant(schoolId, (tx) =>
        tx.school.update({ where: { id: schoolId }, data: { classNoteVisibility } }),
      );
      return { classNoteVisibility: school.classNoteVisibility };
    } catch (e) {
      if (isP2025(e)) throw new NotFoundException('School not found');
      throw e;
    }
  }
}
