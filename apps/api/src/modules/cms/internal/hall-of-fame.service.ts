import { Injectable, NotFoundException } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import type { HallOfFameEntryDto } from './cms.dto';

@Injectable()
export class HallOfFameService {
  list(schoolId: string) {
    return withTenant(schoolId, (tx) =>
      tx.hallOfFameEntry.findMany({
        where: { schoolId },
        orderBy: [{ courseId: 'asc' }, { rank: 'asc' }],
      }),
    );
  }

  /** Replace the (≤3) podium entries for one course. */
  async setForCourse(schoolId: string, courseId: string, entries: HallOfFameEntryDto[]) {
    const course = await withTenant(schoolId, (tx) =>
      tx.course.findUnique({ where: { id: courseId } }),
    );
    if (!course || course.schoolId !== schoolId) throw new NotFoundException('Course not found');

    await withTenant(schoolId, async (tx) => {
      await tx.hallOfFameEntry.deleteMany({ where: { courseId } });
      if (entries.length)
        await tx.hallOfFameEntry.createMany({
          data: entries.map((e) => ({ ...e, courseId, schoolId })),
        });
    });
    return this.list(schoolId);
  }
}
