import { Injectable, NotFoundException } from '@nestjs/common';
import type { LibraryTx } from '@library/db';
import type { CreateCategoryDto } from './dto';
import { mapPrismaError } from './prisma-errors';

@Injectable()
export class CategoriesService {
  async list(tx: LibraryTx) {
    return tx.category.findMany({ orderBy: { name: 'asc' } });
  }

  async create(tx: LibraryTx, orgId: string, dto: CreateCategoryDto) {
    // Client-supplied foreign key: `dto.parentId` is passed straight from the
    // DTO. An FK constraint alone is satisfied by a row RLS would never let
    // this caller see (referential-integrity checks bypass RLS by design),
    // so without this lookup a LIBRARIAN could hand another org's category
    // UUID as `parentId`. It is not inert either: `Category.parentId` is
    // `onDelete: SetNull`, so a different org deleting *their own* category
    // would silently null out this org's row. Looked up on `tx` — inside the
    // same withOrg transaction as the create below — so it is RLS-scoped to
    // this org and race-free (a lookup on a separate connection would be a
    // TOCTOU).
    if (dto.parentId) {
      const parent = await tx.category.findUnique({ where: { id: dto.parentId }, select: { id: true } });
      if (!parent) throw new NotFoundException('Parent category not found');
    }

    try {
      return await tx.category.create({
        data: { orgId, name: dto.name, parentId: dto.parentId ?? null },
      });
    } catch (err) {
      mapPrismaError(err, 'category');
    }
  }
}
