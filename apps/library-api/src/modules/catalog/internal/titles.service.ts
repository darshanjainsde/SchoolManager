import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type LibraryTx } from '@library/db';
import type { LibJwtPayload } from '../../auth';
import type { CreateTitleDto, UpdateTitleDto } from './dto';
import { mapPrismaError } from './prisma-errors';
import { canSeeReplacementPrice, stripReplacementPrice } from './replacement-price-visibility';

const TITLE_INCLUDE = {
  authors: { include: { author: true } },
  categories: { include: { category: true } },
  copies: true,
} satisfies Prisma.TitleInclude;

/**
 * What a MEMBER gets. The difference from `TITLE_INCLUDE` is `copies`, and it
 * is not cosmetic.
 *
 * `copies: true` returns every Copy column, including `acquisitionCost` — and
 * `common/replacement-price.ts` puts `Copy.acquisitionCost` at step 3 of the
 * resolution order, so on any title whose `replacementPrice` is still null (the
 * default state for a school onboarding four thousand books) that column IS the
 * number the loss screen will suggest. Stripping the title's `replacementPrice`
 * while shipping the copies' `acquisitionCost` would leave the child able to
 * read their likely bill off the catalogue anyway, which is the exact thing
 * `replacement-price-visibility.ts` exists to prevent — just one join away.
 *
 * A student looking at a book needs to know whether one is on the shelf, not
 * what the school paid for it on which bill. So the copy is projected down to
 * that: the number written in the front cover, where it lives, and whether it
 * is available. `acquisitionCost`, `acquiredAt`, `condition`, `branchId` and
 * `orgId` are all staff bookkeeping and none of them go out.
 */
const TITLE_INCLUDE_MEMBER = {
  authors: { include: { author: true } },
  categories: { include: { category: true } },
  copies: { select: { id: true, accessionNumber: true, shelf: true, status: true } },
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

    // Client-supplied foreign keys: `dto.categoryIds` is passed straight from
    // the DTO. An FK constraint alone is satisfied by a row RLS would never
    // let this caller see (referential-integrity checks bypass RLS by
    // design), so without this lookup a LIBRARIAN could hand another org's
    // category UUID and get a TitleCategory join row that structurally
    // references it. Looked up on `tx` — inside the same withOrg transaction
    // as the create below — so it is RLS-scoped to this org and race-free (a
    // lookup on a separate connection would be a TOCTOU).
    if (dto.categoryIds?.length) {
      const uniqueIds = [...new Set(dto.categoryIds)];
      const found = await tx.category.findMany({
        where: { id: { in: uniqueIds } },
        select: { id: true },
      });
      if (found.length !== uniqueIds.length) throw new NotFoundException('Category not found');
    }

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
          replacementPrice: dto.replacementPrice,
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

  /**
   * `role` is not optional and has no default on purpose. `GET
   * /catalog/titles/:id` is open to MEMBER, and `replacementPrice` must not
   * reach a student (see `replacement-price-visibility.ts` for why). Making the
   * caller name the role means a future route cannot read a title without
   * deciding this question — a defaulted parameter would let it forget.
   */
  async get(tx: LibraryTx, id: string, role: LibJwtPayload['role']) {
    // The role decides the SHAPE of the query, not just what is pruned after
    // it: money a student must not see is never selected in the first place,
    // so no later refactor of the response can accidentally reveal it.
    const staff = canSeeReplacementPrice(role);
    const title = await tx.title.findUnique({
      where: { id },
      include: staff ? TITLE_INCLUDE : TITLE_INCLUDE_MEMBER,
    });
    if (!title) throw new NotFoundException('Title not found');
    return staff ? title : stripReplacementPrice(title);
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
          // `undefined` leaves it alone, `null` clears it — see
          // `UpdateTitleDto.replacementPrice` for why null is a legitimate,
          // deliberately-reachable value here and not an oversight.
          replacementPrice: dto.replacementPrice,
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
