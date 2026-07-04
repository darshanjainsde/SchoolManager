import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import { isP2002, isP2003, isP2025 } from './internal/prisma-errors';
import type { CreateTeacherDto, UpdateTeacherDto } from './management.dto';

@Injectable()
export class TeachersService {
  async list(schoolId: string) {
    return withTenant(schoolId, (tx) =>
      tx.teacher.findMany({
        where: { schoolId },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        include: {
          school: false,
        },
      }),
    );
  }

  async create(schoolId: string, dto: CreateTeacherDto) {
    try {
      return await withTenant(schoolId, (tx) =>
        tx.teacher.create({
          data: { ...dto, schoolId },
        }),
      );
    } catch (e) {
      if (isP2002(e)) throw new ConflictException('A teacher with those details already exists');
      throw e;
    }
  }

  async update(schoolId: string, id: string, dto: UpdateTeacherDto) {
    try {
      return await withTenant(schoolId, (tx) =>
        tx.teacher.update({ where: { id }, data: dto }),
      );
    } catch (e) {
      if (isP2025(e)) throw new NotFoundException('Teacher not found');
      if (isP2002(e)) throw new ConflictException('A teacher with those details already exists');
      throw e;
    }
  }

  async remove(schoolId: string, id: string) {
    try {
      await withTenant(schoolId, (tx) => tx.teacher.delete({ where: { id } }));
    } catch (e) {
      if (isP2025(e)) throw new NotFoundException('Teacher not found');
      if (isP2003(e)) throw new ConflictException('Cannot delete: other records still reference this teacher');
      throw e;
    }
  }
}
