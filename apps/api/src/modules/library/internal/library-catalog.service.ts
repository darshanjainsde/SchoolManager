import { Injectable } from '@nestjs/common';
import { withTenant, type TenantTx } from '@skoolos/db';
import { ApiError } from '../../../common/errors/api-error';
import { isP2002 } from '../../../common/errors/prisma-errors';
import { ACCESSION_PREFIX, nextAccessionNo, dateOnlyISO } from './library-policy';
import type { CreateTitleDto } from './library.dto';

export type CopyStatus = 'IN' | 'OUT' | 'LOST';

export interface CopyView {
  id: string;
  accessionNo: string;
  status: CopyStatus;
  /** Present when OUT — enough for the Counter to offer "Return" directly. */
  issueId?: string;
  borrower?: { kind: 'STUDENT' | 'TEACHER'; id: string; name: string; code: string | null };
  dueOn?: string;
}

export interface TitleView {
  id: string;
  title: string;
  author: string;
  shelf: string | null;
  totalCopies: number;
  inCopies: number;
  lostCopies: number;
  /** Earliest dueOn among open loans — "earliest back" when none are in. */
  earliestBack: string | null;
  copies: CopyView[];
}

const SEARCH_CAP = 12;

@Injectable()
export class LibraryCatalogService {
  /**
   * Title search for the Counter and the New-books typeahead: matches
   * title/author substrings, or an exact accession number ("B-00042" finds
   * the title that copy belongs to). Case-insensitive throughout.
   */
  search(schoolId: string, q: string): Promise<TitleView[]> {
    const query = q.trim();
    if (query.length < 2) return Promise.resolve([]);
    return withTenant(schoolId, async (tx) => {
      const titles = await tx.libraryBookTitle.findMany({
        where: {
          OR: [
            { title: { contains: query, mode: 'insensitive' } },
            { author: { contains: query, mode: 'insensitive' } },
            { copies: { some: { accessionNo: { equals: query, mode: 'insensitive' } } } },
          ],
        },
        orderBy: { title: 'asc' },
        take: SEARCH_CAP,
        include: this.titleInclude(),
      });
      return titles.map((t) => this.toView(t));
    });
  }

  /** One title with per-copy status — the Counter's availability card. */
  getTitle(schoolId: string, titleId: string): Promise<TitleView> {
    return withTenant(schoolId, async (tx) => {
      const t = await tx.libraryBookTitle.findFirst({
        where: { id: titleId },
        include: this.titleInclude(),
      });
      if (!t) throw new ApiError('NOT_FOUND', 'No such book.', 404);
      return this.toView(t);
    });
  }

  /**
   * New title + its first copy in one go — a title with zero copies is
   * nothing the counter can act on, so it cannot exist.
   */
  createTitle(schoolId: string, dto: CreateTitleDto): Promise<TitleView> {
    return withTenant(schoolId, async (tx) => {
      const title = await tx.libraryBookTitle.create({
        data: {
          schoolId,
          title: dto.title.trim(),
          author: dto.author.trim(),
          shelf: dto.shelf?.trim() || null,
        },
      });
      await this.createCopy(tx, schoolId, title.id);
      const full = await tx.libraryBookTitle.findFirst({
        where: { id: title.id },
        include: this.titleInclude(),
      });
      return this.toView(full!);
    });
  }

  /** Another physical copy of an existing title — the dedupe path. */
  addCopy(schoolId: string, titleId: string): Promise<TitleView> {
    return withTenant(schoolId, async (tx) => {
      const title = await tx.libraryBookTitle.findFirst({ where: { id: titleId }, select: { id: true } });
      if (!title) throw new ApiError('NOT_FOUND', 'No such book.', 404);
      await this.createCopy(tx, schoolId, titleId);
      const full = await tx.libraryBookTitle.findFirst({
        where: { id: titleId },
        include: this.titleInclude(),
      });
      return this.toView(full!);
    });
  }

  /**
   * Allocates the next accession number and creates the copy. One retry on
   * P2002: two racing adds both compute the same max; the loser recomputes
   * once, and a second collision (three simultaneous adds at one school's
   * counter) surfaces as the conflict it is.
   */
  private async createCopy(tx: TenantTx, schoolId: string, titleId: string) {
    for (let attempt = 0; ; attempt += 1) {
      const last = await tx.libraryBookCopy.findFirst({
        where: { schoolId, accessionNo: { startsWith: ACCESSION_PREFIX } },
        orderBy: { accessionNo: 'desc' },
        select: { accessionNo: true },
      });
      try {
        return await tx.libraryBookCopy.create({
          data: { schoolId, titleId, accessionNo: nextAccessionNo(last?.accessionNo ?? null) },
        });
      } catch (e) {
        if (isP2002(e) && attempt === 0) continue;
        throw e;
      }
    }
  }

  private titleInclude() {
    return {
      copies: {
        orderBy: { accessionNo: 'asc' as const },
        include: {
          issues: {
            where: { returnedOn: null },
            select: {
              id: true,
              dueOn: true,
              student: { select: { id: true, firstName: true, lastName: true, code: true } },
              teacher: { select: { id: true, firstName: true, lastName: true } },
            },
          },
        },
      },
    };
  }

  private toView(t: {
    id: string;
    title: string;
    author: string;
    shelf: string | null;
    copies: Array<{
      id: string;
      accessionNo: string;
      lostAt: Date | null;
      issues: Array<{
        id: string;
        dueOn: Date;
        student: { id: string; firstName: string; lastName: string; code: string | null } | null;
        teacher: { id: string; firstName: string; lastName: string } | null;
      }>;
    }>;
  }): TitleView {
    const copies: CopyView[] = t.copies.map((c) => {
      if (c.lostAt) return { id: c.id, accessionNo: c.accessionNo, status: 'LOST' };
      const open = c.issues[0];
      if (!open) return { id: c.id, accessionNo: c.accessionNo, status: 'IN' };
      const borrower = open.student
        ? {
            kind: 'STUDENT' as const,
            id: open.student.id,
            name: `${open.student.firstName} ${open.student.lastName}`.trim(),
            code: open.student.code,
          }
        : open.teacher
          ? {
              kind: 'TEACHER' as const,
              id: open.teacher.id,
              name: `${open.teacher.firstName} ${open.teacher.lastName}`.trim(),
              code: null,
            }
          : undefined;
      return {
        id: c.id,
        accessionNo: c.accessionNo,
        status: 'OUT',
        issueId: open.id,
        borrower,
        dueOn: dateOnlyISO(open.dueOn),
      };
    });
    const dues = copies.filter((c) => c.status === 'OUT' && c.dueOn).map((c) => c.dueOn!);
    return {
      id: t.id,
      title: t.title,
      author: t.author,
      shelf: t.shelf,
      totalCopies: copies.length,
      inCopies: copies.filter((c) => c.status === 'IN').length,
      lostCopies: copies.filter((c) => c.status === 'LOST').length,
      earliestBack: dues.length ? dues.sort()[0] : null,
      copies,
    };
  }
}
