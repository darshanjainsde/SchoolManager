import { Injectable, NotFoundException } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import type { UpsertStaffDto } from './cms.dto';

@Injectable()
export class StaffService {
  list(schoolId: string) {
    return withTenant(schoolId, (tx) =>
      tx.featuredStaff.findMany({ where: { schoolId }, orderBy: { order: 'asc' } }),
    );
  }

  create(schoolId: string, dto: UpsertStaffDto) {
    return withTenant(schoolId, (tx) =>
      tx.featuredStaff.create({ data: { ...dto, schoolId } }),
    );
  }

  async update(schoolId: string, id: string, dto: UpsertStaffDto) {
    const row = await withTenant(schoolId, (tx) =>
      tx.featuredStaff.findUnique({ where: { id } }),
    );
    if (!row || row.schoolId !== schoolId) throw new NotFoundException('Staff not found');
    return withTenant(schoolId, (tx) =>
      tx.featuredStaff.update({ where: { id }, data: dto }),
    );
  }

  async remove(schoolId: string, id: string) {
    const row = await withTenant(schoolId, (tx) =>
      tx.featuredStaff.findUnique({ where: { id } }),
    );
    if (!row || row.schoolId !== schoolId) throw new NotFoundException('Staff not found');
    await withTenant(schoolId, (tx) =>
      tx.featuredStaff.delete({ where: { id } }),
    );
    return { ok: true };
  }
}
