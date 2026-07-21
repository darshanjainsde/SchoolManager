import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import { PasswordService } from '../auth';
import { isP2002, isP2003, isP2025 } from './internal/prisma-errors';
import type { CreateStudentDto, UpdateStudentDto } from './management.dto';

/**
 * How much of a Student row the caller is allowed to see.
 *
 * - `full`   — every column plus the class/grade names. SCHOOL_ADMIN only.
 * - `roster` — the four fields needed to render a name next to a studentId
 *              (attendance / exam-result entry). Deliberately excludes the
 *              minor's PII: guardianName, guardianPhone, dob, gender,
 *              admissionNo, userId.
 *
 * The caller (controller) decides which projection applies — this service
 * never reads the request/role itself.
 */
export type StudentProjection = 'full' | 'roster';

/** Exactly the columns a `roster` projection may return. */
export const ROSTER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  rollNo: true,
} as const;

export interface RosterStudent {
  id: string;
  firstName: string;
  lastName: string;
  rollNo: string | null;
}

interface ListFilters {
  classSectionId?: string;
  projection?: StudentProjection;
}

@Injectable()
export class StudentsService {
  constructor(private readonly passwords: PasswordService) {}

  async list(schoolId: string, filters: ListFilters = {}) {
    const where = {
      schoolId,
      ...(filters.classSectionId ? { classSectionId: filters.classSectionId } : {}),
    };
    const orderBy = [{ admissionNo: 'asc' as const }];

    if (filters.projection === 'roster') {
      // Narrow projection: nothing here is minor PII, so a TEACHER may read it
      // for the one class section they asked about.
      return withTenant(schoolId, (tx) =>
        tx.student.findMany({ where, orderBy, select: { ...ROSTER_SELECT } }),
      ) as Promise<RosterStudent[]>;
    }

    return withTenant(schoolId, (tx) =>
      tx.student.findMany({
        where,
        orderBy,
        include: {
          classSection: {
            select: {
              name: true,
              grade: { select: { name: true } },
            },
          },
        },
      }),
    );
  }

  async create(schoolId: string, dto: CreateStudentDto) {
    if (dto.classSectionId !== undefined) {
      await this.validateClassSection(schoolId, dto.classSectionId);
    }
    const { dob, ...rest } = dto;
    try {
      return await withTenant(schoolId, (tx) =>
        tx.student.create({
          data: {
            ...rest,
            schoolId,
            dob: dob ? new Date(dob) : undefined,
          },
        }),
      );
    } catch (e) {
      if (isP2002(e))
        throw new ConflictException('A student with that admission number already exists');
      throw e;
    }
  }

  async update(schoolId: string, id: string, dto: UpdateStudentDto) {
    if (dto.classSectionId !== undefined) {
      await this.validateClassSection(schoolId, dto.classSectionId);
    }
    const { dob, ...rest } = dto;
    try {
      return await withTenant(schoolId, (tx) =>
        tx.student.update({
          where: { id },
          data: {
            ...rest,
            ...(dob !== undefined ? { dob: new Date(dob) } : {}),
          },
        }),
      );
    } catch (e) {
      if (isP2025(e)) throw new NotFoundException('Student not found');
      if (isP2002(e))
        throw new ConflictException('A student with that admission number already exists');
      throw e;
    }
  }

  async remove(schoolId: string, id: string) {
    try {
      await withTenant(schoolId, (tx) => tx.student.delete({ where: { id } }));
    } catch (e) {
      if (isP2025(e)) throw new NotFoundException('Student not found');
      if (isP2003(e))
        throw new ConflictException('Cannot delete: other records still reference this student');
      throw e;
    }
  }

  async createLogin(schoolId: string, studentId: string): Promise<{ email: string; tempPassword: string }> {
    return withTenant(schoolId, async (tx) => {
      const student = await tx.student.findFirst({ where: { id: studentId } });
      if (!student) throw new NotFoundException('Student not found');
      if (student.userId) throw new ConflictException('Student already has a login');

      // The synthetic email must pass @IsEmail() at /auth/login, but admissionNo
      // allows any characters (spaces, slashes, etc.). Slugify it to a safe local
      // part and append a student-id fragment so distinct students never collide
      // even if their admission numbers slugify to the same value.
      const slug = student.admissionNo.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      const localPart = `${slug || 'student'}-${studentId.slice(0, 8)}`;
      const email = `student.${localPart}@${schoolId}.students.local`;
      const tempPassword = randomBytes(8).toString('base64url');
      const passwordHash = await this.passwords.hash(tempPassword);

      let user: { id: string };
      try {
        user = await tx.user.create({
          data: { schoolId, email, passwordHash, role: 'STUDENT' },
        });
      } catch (e) {
        if (isP2002(e)) throw new ConflictException('Login already exists');
        throw e;
      }

      await tx.student.update({ where: { id: studentId }, data: { userId: user.id } });
      return { email, tempPassword };
    });
  }

  private async validateClassSection(schoolId: string, classSectionId: string) {
    await withTenant(schoolId, async (tx) => {
      const cs = await tx.classSection.findUnique({ where: { id: classSectionId } });
      if (!cs) throw new BadRequestException('classSection not found');
    });
  }
}
