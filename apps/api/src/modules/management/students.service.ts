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

interface ListFilters {
  classSectionId?: string;
}

@Injectable()
export class StudentsService {
  constructor(private readonly passwords: PasswordService) {}

  async list(schoolId: string, filters: ListFilters = {}) {
    return withTenant(schoolId, (tx) =>
      tx.student.findMany({
        where: {
          schoolId,
          ...(filters.classSectionId ? { classSectionId: filters.classSectionId } : {}),
        },
        orderBy: [{ admissionNo: 'asc' }],
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

      const email = `student.${student.admissionNo.toLowerCase()}@${schoolId}.students.local`;
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
