import { Injectable } from '@nestjs/common';
import { Prisma, type LibraryTx } from '@library/db';
import type { SuggestQueryDto } from './dto';

/**
 * What a suggestion looks like to the client. `matchedOn` lets the console
 * highlight the part of the text that caused the row to appear, so the eye
 * lands on the reason rather than hunting for it.
 */
export interface Suggestion {
  kind: 'copy' | 'member' | 'title';
  id: string;
  label: string;
  sub: string;
  /** Ordering only, and the reason this row is here. */
  rank: number;
  matchedOn: string;
  /** Present on `copy` — what the desk would do next. */
  action?: 'ISSUE' | 'RETURN' | 'LOST';
  accessionNumber?: string;
  availableCopies?: number;
  totalCopies?: number;
}

/** Escapes `%`, `_` and `\` so typed input behaves as a literal in ILIKE. */
function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Typo tolerance uses `word_similarity`, NOT `similarity`.
 *
 * `similarity` compares two strings as wholes, so a short query against a long
 * title scores badly however right it is: measured on this database,
 * `similarity('hungy', 'The Hungry Tide')` is 0.235 — below any threshold that
 * would not also match half the catalogue. `word_similarity` finds the best
 * matching word INSIDE the haystack, which is the actual question being asked,
 * and scores the same pair 0.667.
 *
 * It is expressed as the `<%` OPERATOR, not as `word_similarity(a,b) > 0.5`.
 * Only the operator can use the `gin_trgm_ops` indexes; the function call is
 * opaque to the planner, so the version written first seq-scanned Title, Author
 * and Member on every query of four characters or more — precisely the thing
 * the trigram migration was added to avoid. The threshold comes from
 * `pg_trgm.word_similarity_threshold`, set per transaction below.
 */
const FUZZY_FLOOR = 0.5;

/**
 * Below this many characters the fuzzy branch is skipped entirely. A two- or
 * three-letter fragment is `word_similarity`-close to a great deal of any
 * catalogue, and offering all of it is worse than offering nothing — the
 * prefix and substring branches already handle short queries well.
 */
const MIN_FUZZY_LENGTH = 4;

@Injectable()
export class SuggestService {
  /**
   * The one box behind the counter.
   *
   * There is no scanner in this product, so search is not a convenience — it is
   * how every transaction starts. The ranking encodes what the person meant:
   *
   *   0  an exact book number          — they read it off the cover; nothing beats it
   *   1  an exact member code          — they read it off a card
   *   2  a name or title starting with what was typed
   *   3  a name or title containing it
   *   4  something close to it         — `hungy` -> The Hungry Tide (trigram)
   *
   * The three sources are queried SEQUENTIALLY, not with Promise.all. They
   * share one transaction, which owns one connection, so they could never
   * actually run in parallel — and on failure Promise.all returns while the
   * others are still in flight against a transaction Prisma is rolling back,
   * surfacing "Transaction already closed" instead of the real error. With
   * connection_limit=1 through the pooler there was no concurrency to win.
   *
   * They stay three queries rather than one union because they have genuinely
   * different shapes: a copy is one row, a title collapses its copies into a
   * count, and a union would flatten that only to rebuild it in JS.
   *
   * Every query is org-scoped by RLS through `withOrg`; `orgId` is also in each
   * predicate so Postgres can use the org indexes rather than filtering after.
   */
  async suggest(tx: LibraryTx, orgId: string, query: SuggestQueryDto, allowedBranches: string[]): Promise<Suggestion[]> {
    const raw = query.q.trim();
    const limit = query.limit ?? 8;
    if (!raw) return [];

    // `<%` reads its cut-off from this GUC, and SET LOCAL scopes it to the
    // caller's transaction so it cannot leak into another request's queries.
    await tx.$executeRaw`SELECT set_config('pg_trgm.word_similarity_threshold', ${String(FUZZY_FLOOR)}, true)`;

    const esc = escapeLike(raw);
    const prefix = `${esc}%`;
    const anywhere = `%${esc}%`;
    const isNumber = /^\d+$/.test(raw);
    const fuzzy = raw.length >= MIN_FUZZY_LENGTH;

    // Applied to COPIES only, deliberately and explicitly.
    //
    // It used to be declared here and silently used in one of three queries,
    // which read as "everything is branch-scoped" while members and titles were
    // org-wide. A branch-scoped assistant is meant to see the whole catalogue
    // and the whole roll — a book is a book and a child is a child — but must
    // only act on copies held at their own branch. That is now stated rather
    // than implied.
    const branchFilter = allowedBranches.length > 0 ? { branchId: { in: allowedBranches } } : {};

    // A book number is exact or it is nothing — a partial accession number is
      // a different book, never a near miss, so this never does prefix matching.
      isNumber
    const copies = isNumber
      ? await tx.copy.findMany({
            where: { orgId, accessionNumber: raw, ...branchFilter },
            select: {
              id: true, accessionNumber: true, status: true,
              title: { select: { title: true } },
              issues: {
                where: { returnedAt: null },
                select: { member: { select: { firstName: true, lastName: true } } },
                take: 1,
              },
            },
          take: 1,
        })
      : [];

    const members = await tx.$queryRaw<Array<{ id: string; code: string; firstName: string; lastName: string; classRef: string | null; rank: number; matched: string }>>`
        SELECT "id", "code", "firstName", "lastName", NULL::text AS "classRef",
          CASE
            WHEN upper("code") = upper(${raw})                                       THEN 1
            WHEN "firstName" ILIKE ${prefix} OR "lastName" ILIKE ${prefix}
              OR "code" ILIKE ${prefix}                                              THEN 2
            WHEN "firstName" ILIKE ${anywhere} OR "lastName" ILIKE ${anywhere}       THEN 3
            ELSE 4
          END AS "rank",
          CASE WHEN "firstName" ILIKE ${anywhere} THEN "firstName" ELSE "lastName" END AS "matched"
        FROM "Member"
        WHERE "orgId" = ${orgId}::uuid
          AND (
               upper("code") = upper(${raw})
            OR "code" ILIKE ${prefix}
            OR "firstName" ILIKE ${anywhere}
            OR "lastName"  ILIKE ${anywhere}
            OR ("firstName" || ' ' || "lastName") ILIKE ${anywhere}
            OR (${fuzzy} AND ${raw} <% "firstName")
            OR (${fuzzy} AND ${raw} <% "lastName")
          )
        ORDER BY "rank" ASC, ("status"::text = 'ACTIVE') DESC, "lastName" ASC
      LIMIT ${limit}
    `;

    const titles = await tx.$queryRaw<Array<{ id: string; title: string; author: string | null; total: bigint; free: bigint; rank: number }>>`
        SELECT t."id", t."title",
          (SELECT a."name" FROM "Author" a
             JOIN "TitleAuthor" ta ON ta."authorId" = a."id"
            WHERE ta."titleId" = t."id" LIMIT 1) AS "author",
          (SELECT count(*) FROM "Copy" c WHERE c."titleId" = t."id") AS "total",
          (SELECT count(*) FROM "Copy" c WHERE c."titleId" = t."id" AND c."status" = 'AVAILABLE') AS "free",
          CASE
            WHEN t."title" ILIKE ${prefix} THEN 2
            WHEN t."title" ILIKE ${anywhere} THEN 3
            ELSE 4
          END AS "rank"
        FROM "Title" t
        WHERE t."orgId" = ${orgId}::uuid
          AND (
               t."title" ILIKE ${anywhere}
            OR (${fuzzy} AND ${raw} <% t."title")
            OR EXISTS (
                 SELECT 1 FROM "Author" a
                   JOIN "TitleAuthor" ta ON ta."authorId" = a."id"
                  WHERE ta."titleId" = t."id"
                    AND (a."sortName" ILIKE ${anywhere}
                         OR (${fuzzy} AND ${raw} <% a."sortName"))
               )
          )
      ORDER BY "rank" ASC, t."title" ASC
      LIMIT ${limit}
    `;

    const out: Suggestion[] = [];

    for (const c of copies) {
      const holder = c.issues[0]?.member;
      out.push({
        kind: 'copy',
        id: c.id,
        label: c.title.title,
        sub: c.status === 'ISSUED' && holder
          ? `no. ${c.accessionNumber} · with ${holder.firstName} ${holder.lastName}`
          : c.status === 'LOST'
            ? `no. ${c.accessionNumber} · reported lost`
            : `no. ${c.accessionNumber} · on the shelf`,
        rank: 0,
        matchedOn: c.accessionNumber,
        accessionNumber: c.accessionNumber,
        action: c.status === 'ISSUED' ? 'RETURN' : c.status === 'LOST' ? 'LOST' : 'ISSUE',
      });
    }

    for (const m of members) {
      out.push({
        kind: 'member',
        id: m.id,
        label: `${m.firstName} ${m.lastName}`,
        sub: m.code,
        rank: Number(m.rank),
        matchedOn: m.matched,
      });
    }

    for (const t of titles) {
      const free = Number(t.free);
      const total = Number(t.total);
      out.push({
        kind: 'title',
        id: t.id,
        label: t.title,
        sub: `${t.author ?? 'Unknown author'} · ${free} of ${total} on the shelf`,
        rank: Number(t.rank),
        matchedOn: t.title,
        availableCopies: free,
        totalCopies: total,
      });
    }

    return out.sort((a, b) => a.rank - b.rank).slice(0, limit);
  }
}
