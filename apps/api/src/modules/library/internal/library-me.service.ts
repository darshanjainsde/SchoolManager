import { Injectable } from '@nestjs/common';
import { getPlatformPrisma } from '@skoolos/db';
import { withOrg, type LibraryTx } from '@library/db';

/**
 * What a student or a teacher sees of the library, inside the portal they
 * already use.
 *
 * Responses are BUILT here, never returned as raw rows. Every field on the way
 * out is one somebody decided to show — which is what stops a replacement price
 * or another member's name reaching a child because a `select` grew.
 */

export interface MyBook {
  issueId: string;
  title: string;
  /** The number written inside the front cover. "Book number" at the counter. */
  accessionNumber: string;
  backBy: string;
  /** Negative means late. The UI colours from this; it never re-derives it. */
  daysLeft: number;
  renewCount: number;
}

export interface MyLibrary {
  books: MyBook[];
  /**
   * Absent (not zero) when nothing is owed. A permanent "₹0 owed" line teaches
   * a family to expect a charge from a library that mostly charges nothing.
   */
  owed?: number;
  /** False when this person is not a library member at all — no error, no tab. */
  isMember: boolean;
}

export interface ShelfResult {
  titleId: string;
  title: string;
  author: string | null;
  /** Counted, never stored — a stored count drifts and then nobody trusts either number. */
  availableCopies: number;
  totalCopies: number;
}

/** Whole days between two instants, floored toward the past. */
function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

@Injectable()
export class LibraryMeService {
  /**
   * The Sckools user's library membership, or null.
   *
   * `Member.externalRef` holds the Sckools `User.id`. Not `Student.id` or
   * `Teacher.id`: `User.id` is what the JWT carries in `sub`, it is what every
   * guard already has in hand, and it is the one id a teacher and a student
   * both possess. Resolving `sub` to a Student or Teacher row would mean a
   * query in the `public` schema, which the library's own database role is not
   * granted — so this is forced by the schema isolation, not preferred.
   */
  private async member(tx: LibraryTx, orgId: string, userId: string) {
    return tx.member.findFirst({
      where: { orgId, externalRef: userId, status: 'ACTIVE' },
      select: { id: true },
    });
  }

  async mine(orgId: string, userId: string, now = new Date()): Promise<MyLibrary> {
    return withOrg(orgId, async (tx) => {
      const me = await this.member(tx, orgId, userId);
      if (!me) return { books: [], isMember: false };

      const issues = await tx.issue.findMany({
        where: { orgId, memberId: me.id, returnedAt: null },
        select: {
          id: true,
          dueAt: true,
          renewCount: true,
          copy: { select: { accessionNumber: true, title: { select: { title: true } } } },
        },
        orderBy: { dueAt: 'asc' },
      });

      const books: MyBook[] = issues.map((i) => ({
        issueId: i.id,
        title: i.copy.title.title,
        accessionNumber: i.copy.accessionNumber,
        backBy: i.dueAt.toISOString(),
        daysLeft: daysBetween(now, i.dueAt),
        renewCount: i.renewCount,
      }));

      // Only OPEN fines, and only the outstanding part. A paid or waived fine is
      // not something the family still owes, and showing it would have them
      // paying twice.
      const owed = await tx.fine.aggregate({
        where: { orgId, memberId: me.id, status: 'OPEN' },
        _sum: { amount: true },
      });
      const total = Number(owed._sum.amount ?? 0);

      return { books, isMember: true, ...(total > 0 ? { owed: total } : {}) };
    });
  }

  /**
   * "Is this book on the shelf" — the third question a child ever asks the
   * library, after what do I have and when is it back.
   *
   * Availability is COUNTED from copy status, never read from a stored total.
   */
  async shelf(orgId: string, q: string, limit = 20): Promise<ShelfResult[]> {
    const term = q.trim();
    if (term.length < 2) return [];

    return withOrg(orgId, async (tx) =>
      tx.$queryRaw<ShelfResult[]>`
        SELECT t."id" AS "titleId",
               t."title",
               NULLIF(string_agg(DISTINCT a."name", ', '), '') AS "author",
               COUNT(DISTINCT c."id") FILTER (WHERE c."status" = 'AVAILABLE')::int AS "availableCopies",
               COUNT(DISTINCT c."id")::int AS "totalCopies"
        FROM "Title" t
        JOIN "Copy" c ON c."titleId" = t."id"
        LEFT JOIN "TitleAuthor" ta ON ta."titleId" = t."id"
        LEFT JOIN "Author" a ON a."id" = ta."authorId"
        WHERE t."orgId" = ${orgId}::uuid
          AND t."title" ILIKE ${'%' + term + '%'}
        GROUP BY t."id", t."title"
        ORDER BY "availableCopies" DESC, t."title" ASC
        LIMIT ${limit}
      `,
    );
  }

  /**
   * Which of a class has not brought a book back.
   *
   * Names and titles only — never amounts, even when fines are on. The moment a
   * staffroom screen shows what children owe, this stops being a nudge list and
   * becomes fee collection, and the teacher stops opening it. It is also the
   * only mechanism in the product that actually recovers a book from a
   * ten-year-old: the librarian has no authority over a child, the class
   * teacher does.
   */
  /**
   * The caller's OWN classes, resolved from their Sckools teacher record.
   *
   * Returns [] for a teacher who is nobody's class teacher — a subject teacher
   * has no register to chase, and an empty list is the honest answer rather
   * than an error.
   */
  async myClassNotReturned(orgId: string, schoolId: string, userId: string, now = new Date()) {
    const sections = await getPlatformPrisma().classSection.findMany({
      where: { schoolId, classTeacher: { userId } },
      select: { name: true, grade: { select: { name: true } } },
    });
    if (sections.length === 0) return [];

    const classRefs = sections.map((s) => `${s.grade.name}-${s.name}`);
    const all = await Promise.all(
      classRefs.map((ref) => this.classNotReturned(orgId, ref, now)),
    );
    return all.flat();
  }

  async classNotReturned(orgId: string, classRef: string, now = new Date()) {
    return withOrg(orgId, async (tx) => {
      const rows = await tx.issue.findMany({
        where: { orgId, returnedAt: null, dueAt: { lt: now }, member: { classRef } },
        select: {
          dueAt: true,
          member: { select: { firstName: true, lastName: true } },
          copy: { select: { title: { select: { title: true } } } },
        },
        orderBy: { dueAt: 'asc' },
      });

      return rows.map((r) => ({
        name: `${r.member.firstName} ${r.member.lastName}`.trim(),
        title: r.copy.title.title,
        daysLate: -daysBetween(now, r.dueAt),
      }));
    });
  }
}
