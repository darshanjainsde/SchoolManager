import { Injectable } from '@nestjs/common';
import type { LibraryTx } from '@library/db';

export interface TitleSearchHit {
  id: string;
  isbn13: string | null;
  isbn10: string | null;
  title: string;
  subtitle: string | null;
  publisher: string | null;
  publishedYear: number | null;
  edition: string | null;
  language: string;
  callNumber: string | null;
  coverUrl: string | null;
  description: string | null;
  pageCount: number | null;
  createdAt: Date;
  updatedAt: Date;
  rank: number;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Extracts word tokens from free-text user input. This is the entire safety
 * boundary for building a `to_tsquery` argument by hand: the string this
 * produces (tokens joined by ` & `, with `:*` appended to the last one) can
 * never contain a tsquery operator (`&`, `|`, `!`, `<->`, `(`, `)`, `:`,
 * `'`) because none of those characters can survive `\p{L}\p{N}` token
 * extraction. Confirmed against a real Postgres (per LIBRARY-TRAPS.md #15):
 * hand-crafted malformed input to `to_tsquery` (e.g. a bare `'` or a
 * dangling `:*` with nothing before it) raises a hard "syntax error in
 * tsquery", not an empty result — so this function, not `to_tsquery`
 * itself, is what has to make the argument well-formed. The built string is
 * still passed to Postgres as a bound query parameter, never concatenated
 * into SQL text.
 */
export function tokenize(input: string): string[] {
  return input.match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** Joins tokens with `&` (AND) and marks only the last one as a prefix match. */
export function buildPrefixTsQuery(tokens: string[]): string {
  return tokens.map((t, i) => (i === tokens.length - 1 ? `${t}:*` : t)).join(' & ');
}

/** Escapes `%`, `_` and `\` so a raw search string used in an ILIKE pattern behaves as a literal substring match. */
function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}

@Injectable()
export class SearchService {
  /**
   * Full-text search over Title (title/subtitle/publisher/callNumber, via
   * the generated `searchVector` column, weighted A/B/C/C — see the
   * catalogue migration) UNIONed with a separate `ILIKE` match on
   * `Author.sortName`. Author names cannot be part of the generated column
   * (a generated column can't reach across the TitleAuthor/Author join), so
   * a title matched only by its author's name gets `rank = 0` and sorts
   * after every tsvector hit, then alphabetically by title — still found,
   * just not out-ranking an actual text match.
   *
   * Both branches filter `"orgId" = ${orgId}` explicitly, in addition to
   * running inside the `withOrg`-scoped transaction (RLS) the caller must
   * supply `tx` from — belt and suspenders, not a substitute for RLS.
   *
   * An empty/no-token query never reaches `to_tsquery` at all: it falls
   * back to a plain alphabetical listing, both because `to_tsquery('simple',
   * '')` (verified live) merely warns and returns a query that matches
   * nothing, and because skipping it avoids the round trip entirely.
   */
  async searchTitles(tx: LibraryTx, orgId: string, q: string, limit = DEFAULT_LIMIT): Promise<TitleSearchHit[]> {
    const boundedLimit = Math.min(Math.max(1, limit), MAX_LIMIT);
    const tokens = tokenize(q);

    if (tokens.length === 0) {
      return tx.$queryRaw<TitleSearchHit[]>`
        SELECT id, isbn13, isbn10, title, subtitle, publisher, "publishedYear", edition,
               language, "callNumber", "coverUrl", description, "pageCount",
               "createdAt", "updatedAt", 0::float8 AS rank
        FROM "Title"
        WHERE "orgId" = ${orgId}::uuid
        ORDER BY title ASC
        LIMIT ${boundedLimit}
      `;
    }

    const tsQuery = buildPrefixTsQuery(tokens);
    const likePattern = `%${escapeLikePattern(q)}%`;

    return tx.$queryRaw<TitleSearchHit[]>`
      WITH matches AS (
        SELECT t.id, ts_rank(t."searchVector", to_tsquery('simple', ${tsQuery})) AS rank
        FROM "Title" t
        WHERE t."orgId" = ${orgId}::uuid
          AND t."searchVector" @@ to_tsquery('simple', ${tsQuery})

        UNION ALL

        SELECT t.id, 0::float8 AS rank
        FROM "Title" t
        JOIN "TitleAuthor" ta ON ta."titleId" = t.id
        JOIN "Author" a ON a.id = ta."authorId"
        WHERE t."orgId" = ${orgId}::uuid
          AND a."sortName" ILIKE ${likePattern} ESCAPE '\\'
      ),
      ranked AS (
        SELECT id, MAX(rank) AS rank FROM matches GROUP BY id
      )
      SELECT t.id, t.isbn13, t.isbn10, t.title, t.subtitle, t.publisher, t."publishedYear",
             t.edition, t.language, t."callNumber", t."coverUrl", t.description, t."pageCount",
             t."createdAt", t."updatedAt", r.rank
      FROM ranked r
      JOIN "Title" t ON t.id = r.id
      ORDER BY r.rank DESC, t.title ASC
      LIMIT ${boundedLimit}
    `;
  }
}
