import { Injectable, NotFoundException } from '@nestjs/common';
import type { LibraryTx } from '@library/db';
import type { AddCopyDto, UpdateCopyDto } from './dto';
import { mapPrismaError } from './prisma-errors';

@Injectable()
export class CopiesService {
  async add(tx: LibraryTx, orgId: string, titleId: string, dto: AddCopyDto) {
    // Checked explicitly rather than relying on the FK error alone: a
    // missing title should read as "title not found" (404), not the more
    // generic "blocked by a related record" (409) `mapPrismaError` gives a
    // bare P2003 elsewhere.
    const title = await tx.title.findUnique({ where: { id: titleId }, select: { id: true } });
    if (!title) throw new NotFoundException('Title not found');

    try {
      return await tx.copy.create({
        data: {
          orgId,
          titleId,
          branchId: dto.branchId,
          barcode: dto.barcode,
          accessionNumber: dto.accessionNumber,
          shelf: dto.shelf,
          condition: dto.condition,
          acquiredAt: dto.acquiredAt ? new Date(dto.acquiredAt) : undefined,
          acquisitionCost: dto.acquisitionCost,
          status: dto.status,
        },
      });
    } catch (err) {
      mapPrismaError(err, 'copy');
    }
  }

  async update(tx: LibraryTx, id: string, dto: UpdateCopyDto) {
    try {
      return await tx.copy.update({
        where: { id },
        data: {
          accessionNumber: dto.accessionNumber,
          shelf: dto.shelf,
          condition: dto.condition,
          acquisitionCost: dto.acquisitionCost,
          status: dto.status,
        },
      });
    } catch (err) {
      mapPrismaError(err, 'copy');
    }
  }

  async getByBarcode(tx: LibraryTx, orgId: string, barcode: string) {
    const copy = await tx.copy.findUnique({
      where: { orgId_barcode: { orgId, barcode } },
      include: { title: true, branch: true },
    });
    if (!copy) throw new NotFoundException('Copy not found');
    return copy;
  }
}
