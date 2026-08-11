import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type LibraryTx } from '@library/db';
import type { CreateTitleDto, UpdateTitleDto } from './dto';
import { mapPrismaError } from './prisma-errors';

const TITLE_INCLUDE = {
  authors: { include: { author: true } },
  categories: { include: { category: true } },
  copies: true,
} satisfies Prisma.TitleInclude;

@Injectable()
export class TitlesService {
  async create(tx: LibraryTx, orgId: string, dto: CreateTitleDto) {
    // Authors are find-or-create by (orgId, sortName) — the unique key the
    // schema already enforces — so the same author named on two different
    // titles resolves to one Author row, not a duplicate per title. Done
    // before the try/catch below on purpose: an upsert failure here should
    // surface as-is (it is not one of the conflict/not-found shapes
    // title.create can produce), and because it all still runs inside the
    // same interactive transaction as the create, any later failure rolls
    // this back too.
    const authorLinks = dto.authors?.length
      ? await Promise.all(
          dto.authors.map(async (a) => {
            const sortName = (a.sortName ?? a.name).trim();
            const author = await tx.author.upsert({
              where: { orgId_sortName: { orgId, sortName } },
              update: {},
              create: { orgId, name: a.name, sortName },
            });
            return { authorId: author.id, role: a.role ?? 'AUTHOR' };
          }),
        )
      : [];

    try {
      return await tx.title.create({
        data: {
          orgId,
          title: dto.title,
          subtitle: dto.subtitle,
          isbn13: dto.isbn13,
          isbn10: dto.isbn10,
          publisher: dto.publisher,
          publishedYear: dto.publishedYear,
          edition: dto.edition,
          language: dto.language ?? 'en',
          callNumber: dto.callNumber,
          coverUrl: dto.coverUrl,
          description: dto.description,
          pageCount: dto.pageCount,
          authors: authorLinks.length ? { create: authorLinks } : undefined,
          categories: dto.categoryIds?.length
            ? { create: dto.categoryIds.map((categoryId) => ({ categoryId })) }
            : undefined,
        },
        include: TITLE_INCLUDE,
      });
    } catch (err) {
      mapPrismaError(err, 'title');
    }
  }

  async get(tx: LibraryTx, id: string) {
    const title = await tx.title.findUnique({ where: { id }, include: TITLE_INCLUDE });
    if (!title) throw new NotFoundException('Title not found');
    return title;
  }

  async update(tx: LibraryTx, id: string, dto: UpdateTitleDto) {
    try {
      return await tx.title.update({
        where: { id },
        data: {
          title: dto.title,
          subtitle: dto.subtitle,
          isbn13: dto.isbn13,
          isbn10: dto.isbn10,
          publisher: dto.publisher,
          publishedYear: dto.publishedYear,
          edition: dto.edition,
          language: dto.language,
          callNumber: dto.callNumber,
          coverUrl: dto.coverUrl,
          description: dto.description,
          pageCount: dto.pageCount,
        },
        include: TITLE_INCLUDE,
      });
    } catch (err) {
      mapPrismaError(err, 'title');
    }
  }

  /** Copy has `onDelete: Restrict` on its titleId FK — deleting a title that still has copies raises P2003, mapped to a 409. */
  async remove(tx: LibraryTx, id: string): Promise<void> {
    try {
      await tx.title.delete({ where: { id } });
    } catch (err) {
      mapPrismaError(err, 'title');
    }
  }
}
