import { Injectable } from '@nestjs/common';
import type { LibraryTx } from '@library/db';

/**
 * The four questions a school actually asks of its library.
 *
 * Written as aggregate SQL rather than fetched-and-counted in JS: a school with
 * three years of history has hundreds of thousands of `Issue` rows, and the
 * honest version of "who has read nothing" is a NOT EXISTS over the member
 * list, not a page of issues filtered in memory.
 *
 * Every query filters `orgId` explicitly AND runs inside `withOrg`, so RLS is
 * the backstop rather than the only guard — the same belt-and-braces the fines
 * service uses. Branch scoping is applied where a branch means something; a
 * reading report for a school with one room is the same either way, but a
 * two-branch school must not see the other room's children.
 */

export interface ClassIssueCount {
  classRef: string;
  issues: number;
  readers: number;
}

export interface MostReadTitle {
  titleId: string;
  title: string;
  author: string | null;
  issues: number;
}

export interface SilentReader {
  memberId: string;
  code: string;
  firstName: string;
  lastName: string;
  classRef: string | null;
}

export interface LateReturner {
  memberId: string;
  code: string;
  firstName: string;
  lastName: string;
  classRef: string | null;
  lateReturns: number;
  worstDaysLate: number;
}

@Injectable()
export class ReportsService {
  /** Issues per class over a window, with how many DISTINCT children read. */
  async issuesPerClass(
    tx: LibraryTx,
    orgId: string,
    from: Date,
    to: Date,
    branchIds: string[],
  ): Promise<ClassIssueCount[]> {
    // `readers` matters as much as `issues`: forty issues from four children is
    // a very different class from forty issues from thirty-eight, and a raw
    // total cannot tell a head of school which one they are looking at.
    return tx.$queryRaw<ClassIssueCount[]>`
      SELECT COALESCE(m."classRef", '—') AS "classRef",
             COUNT(i."id")::int          AS issues,
             COUNT(DISTINCT m."id")::int AS readers
      FROM "Issue" i
      JOIN "Member" m ON m."id" = i."memberId"
      WHERE i."orgId" = ${orgId}::uuid
        AND i."issuedAt" >= ${from} AND i."issuedAt" < ${to}
        AND (cardinality(${branchIds}::uuid[]) = 0 OR i."branchId" = ANY(${branchIds}::uuid[]))
      GROUP BY COALESCE(m."classRef", '—')
      ORDER BY issues DESC, "classRef" ASC
    `;
  }

  /** Most-borrowed titles, so the next purchase list is evidence-led. */
  async mostRead(
    tx: LibraryTx,
    orgId: string,
    from: Date,
    to: Date,
    branchIds: string[],
    limit: number,
  ): Promise<MostReadTitle[]> {
    // Counted per TITLE, not per copy: six copies of one book are one book as
    // far as "what do children want" is concerned.
    //
    // COUNT(DISTINCT i."id"), not COUNT(i."id"). Authors are many-to-many
    // through `TitleAuthor`, so the LEFT JOIN below fans out one issue into one
    // row PER AUTHOR — a book with two authors would report twice the
    // borrowings. The inflated number looks entirely plausible, which is what
    // makes it dangerous: it is the figure a school would buy stock from.
    return tx.$queryRaw<MostReadTitle[]>`
      SELECT t."id" AS "titleId",
             t."title",
             NULLIF(string_agg(DISTINCT a."name", ', '), '') AS "author",
             COUNT(DISTINCT i."id")::int AS issues
      FROM "Issue" i
      JOIN "Copy"  c ON c."id" = i."copyId"
      JOIN "Title" t ON t."id" = c."titleId"
      LEFT JOIN "TitleAuthor" ta ON ta."titleId" = t."id"
      LEFT JOIN "Author"      a  ON a."id" = ta."authorId"
      WHERE i."orgId" = ${orgId}::uuid
        AND i."issuedAt" >= ${from} AND i."issuedAt" < ${to}
        AND (cardinality(${branchIds}::uuid[]) = 0 OR i."branchId" = ANY(${branchIds}::uuid[]))
      GROUP BY t."id", t."title"
      ORDER BY issues DESC, t."title" ASC
      LIMIT ${limit}
    `;
  }

  /**
   * Children who have borrowed NOTHING in the window.
   *
   * This is the report a principal actually asks for, and it is the only one
   * here that names children for something they have not done. Two deliberate
   * constraints follow from that:
   *
   *   - ACTIVE students only. A child who left in April is not a
   *     non-reader, and listing them makes the whole report untrustworthy.
   *   - No money, no counts, no ranking. It is a list to act on — pair them
   *     with a librarian, put a book in their hand — not a leaderboard of
   *     failure. Anything that turns it into a score changes what a teacher
   *     does with it.
   */
  async readNothing(
    tx: LibraryTx,
    orgId: string,
    from: Date,
    to: Date,
    classRef: string | null,
  ): Promise<SilentReader[]> {
    return tx.$queryRaw<SilentReader[]>`
      SELECT m."id" AS "memberId", m."code", m."firstName", m."lastName", m."classRef"
      FROM "Member" m
      WHERE m."orgId" = ${orgId}::uuid
        AND m."memberType" = 'STUDENT'
        AND m."status" = 'ACTIVE'
        AND (${classRef}::text IS NULL OR m."classRef" = ${classRef})
        AND NOT EXISTS (
          SELECT 1 FROM "Issue" i
          WHERE i."memberId" = m."id"
            AND i."issuedAt" >= ${from} AND i."issuedAt" < ${to}
        )
      ORDER BY m."classRef" NULLS LAST, m."lastName", m."firstName"
    `;
  }

  /**
   * Members who bring books back late as a habit, not once.
   *
   * `minLate` defaults to 3 because everyone is late once — a report that
   * flagged a single late return would list most of the school and be ignored,
   * which is the same as not having it.
   *
   * Counts only issues that were actually RETURNED late. A book still out is
   * not a late return, it is on the not-returned list, which is a different
   * screen with a different action.
   */
  async chronicLateReturners(
    tx: LibraryTx,
    orgId: string,
    from: Date,
    to: Date,
    minLate: number,
  ): Promise<LateReturner[]> {
    return tx.$queryRaw<LateReturner[]>`
      SELECT m."id" AS "memberId", m."code", m."firstName", m."lastName", m."classRef",
             COUNT(i."id")::int AS "lateReturns",
             MAX(DATE_PART('day', i."returnedAt" - i."dueAt"))::int AS "worstDaysLate"
      FROM "Issue" i
      JOIN "Member" m ON m."id" = i."memberId"
      WHERE i."orgId" = ${orgId}::uuid
        AND i."returnedAt" IS NOT NULL
        AND i."returnedAt" > i."dueAt"
        AND i."returnedAt" >= ${from} AND i."returnedAt" < ${to}
      GROUP BY m."id", m."code", m."firstName", m."lastName", m."classRef"
      HAVING COUNT(i."id") >= ${minLate}
      ORDER BY "lateReturns" DESC, "worstDaysLate" DESC
    `;
  }
}
