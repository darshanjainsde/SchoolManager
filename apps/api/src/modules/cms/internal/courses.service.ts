import { Injectable, NotFoundException } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import type { UpsertCourseDto, UpsertCourseFeeDto } from './cms.dto';

@Injectable()
export class CoursesService {
  list(schoolId: string) {
    return withTenant(schoolId, (tx) =>
      tx.course.findMany({
        where: { schoolId },
        orderBy: { order: 'asc' },
        include: { fee: true },
      }),
    );
  }

  create(schoolId: string, dto: UpsertCourseDto) {
    return withTenant(schoolId, (tx) =>
      tx.course.create({ data: { ...dto, schoolId } }),
    );
  }

  async update(schoolId: string, id: string, dto: UpsertCourseDto) {
    await this.mustOwn(schoolId, id);
    return withTenant(schoolId, (tx) =>
      tx.course.update({ where: { id }, data: dto }),
    );
  }

  async remove(schoolId: string, id: string) {
    await this.mustOwn(schoolId, id);
    await withTenant(schoolId, (tx) => tx.course.delete({ where: { id } }));
    return { ok: true };
  }

  async setFee(schoolId: string, courseId: string, dto: UpsertCourseFeeDto) {
    await this.mustOwn(schoolId, courseId);
    return withTenant(schoolId, (tx) =>
      tx.courseFee.upsert({
        where: { courseId },
        create: { ...dto, courseId, schoolId },
        update: dto,
      }),
    );
  }

  private async mustOwn(schoolId: string, id: string) {
    const row = await withTenant(schoolId, (tx) =>
      tx.course.findUnique({ where: { id } }),
    );
    if (!row || row.schoolId !== schoolId) throw new NotFoundException('Course not found');
  }
}
