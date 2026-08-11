import { Injectable } from '@nestjs/common';
import type { LibraryTx } from '@library/db';
import type { CreateCategoryDto } from './dto';
import { mapPrismaError } from './prisma-errors';

@Injectable()
export class CategoriesService {
  async list(tx: LibraryTx) {
    return tx.category.findMany({ orderBy: { name: 'asc' } });
  }

  async create(tx: LibraryTx, orgId: string, dto: CreateCategoryDto) {
    try {
      return await tx.category.create({
        data: { orgId, name: dto.name, parentId: dto.parentId ?? null },
      });
    } catch (err) {
      mapPrismaError(err, 'category');
    }
  }
}
