import { Injectable } from '@nestjs/common';
import { Prisma, type LibraryTx } from '@library/db';
import type { SearchMembersQueryDto } from './dto';

/**
 * Exactly the columns any desk screen may see of a member.
 *
 * Deliberately excludes `phone`, `email`, `address`, `photoUrl`,
 * `customFields` and `externalRef`. Library members are mostly schoolchildren,
 * and Sckools already settled this question for the same data: its student
 * `roster` projection (`students.service.ts`) returns the four fields needed
 * to render a name beside an id and withholds the minor's PII, which only a
 * SCHOOL_ADMIN's `full` projection may see.
 *
 * Chasing an overdue book is a real reason to want a phone number, and it is
 * not one this projection answers. That should be its own deliberate decision
 * with its own role check — widening a projection is easy to do and
 * impossible to undo once it has been rendered on a screen.
 *
 * One constant, used by the search route AND by all three list hydrations, so
 * a member is the same shape everywhere in the API and the web client can
 * carry a single type for it.
 */
export const MEMBER_CARD_SELECT = {
  id: true,
  code: true,
  firstName: true,
  lastName: true,
  memberType: true,
  status: true,
  homeBranchId: true,
} as const;

export interface MemberCard {
  id: string;
  code: string;
  firstName: string;
  lastName: string;
  memberType: 'STUDENT' | 'TEACHER' | 'EXTERNAL';
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED';
  homeBranchId: string | null;
}

/**
 * Escapes `%`, `_` and `\` so user input used in an ILIKE pattern behaves as a
 * literal substring.
 *
 * Deliberately a local copy of the same helper in the catalog module's
 * `search.service.ts` rather than an import: `internal/` files are private to
 * their module (the dependency-cruiser boundary step enforces it), and reaching
 * across for a four-line helper is how modules quietly fuse together.
 */
function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Sckools' canonical member/student code: three letters, a hyphen, five or more digits (`RAF-00042`). */
const CODE_SHAPE = /^([A-Za-z]{3})-?(\d+)$/;

export interface CodeGuesses {
  /** The canonical code the input most likely means, or null if it isn't code-shaped. */
  exact: string | null;
  /** Only set when the input is bare digits — matched against the end of a code. */
  digitsSuffix: string | null;
}

/**
 * Works out which code a librarian meant from what they actually typed.
 *
 * `AAA-00000` is THE canonical shape across Sckools, and the standing rule is
 * that nonconforming DATA gets migrated rather than the validators widened
 * (`students.service.ts`, `school-resolve.service.ts`). This function does not
 * break that rule, because it is not a validator: nothing here is stored,
 * printed, or accepted as a code. It only decides what to look FOR.
 *
 * So the tolerances are the ones a search box owes a person reading a number
 * off a library card at a desk:
 *   `raf-00042`  → RAF-00042   (case)
 *   `RAF00042`   → RAF-00042   (the hyphen is easy to drop when typing fast)
 *   `RAF-42`     → RAF-00042   (zero-padding — codes are unique per org, so
 *                               this is unambiguous, and a five-digit tail is
 *                               what the generator emits)
 *   `42`         → %42         (matched against the end of the code, for the
 *                               librarian who only remembers the number)
 */
export function codeGuesses(raw: string): CodeGuesses {
  const compact = raw.replace(/\s+/g, '');

  const shaped = CODE_SHAPE.exec(compact);
  if (shaped) {
    const [, letters, digits] = shaped;
    return { exact: `${letters.toUpperCase()}-${digits.padStart(5, '0')}`, digitsSuffix: null };
  }

  if (/^\d+$/.test(compact)) {
    return { exact: null, digitsSuffix: `%${escapeLikePattern(compact)}` };
  }

  return { exact: null, digitsSuffix: null };
}

interface MemberSearchRow extends MemberCard {
  /** Ordering only — stripped before the row leaves this service. */
  rank: number;
}

@Injectable()
export class MembersService {
  /**
   * Ranked member lookup for the circulation desk: exact code, then code
   * prefix, then name.
   *
   * Ranking is the whole point. A librarian who types a full code must get
   * that one person first — never buried under a dozen people whose surname
   * happens to contain the same letters. Within a rank, ACTIVE members sort
   * ahead of PENDING/SUSPENDED ones, because the common case at a desk is
   * issuing to someone who can borrow.
   *
   * Raw SQL rather than Prisma's query builder because the CASE-based rank
   * cannot be expressed through `findMany`, and doing it as several queries
   * merged in JS would mean several round trips and a hand-written merge. All
   * user input is bound as parameters — never concatenated into the SQL text —
   * and ILIKE patterns are escaped so `%` typed by a person is a literal `%`.
   *
   * NO INDEX on the name columns, on purpose. This scans a single org's
   * members, which for a school library is a few hundred to a few thousand
   * rows — well under a millisecond, and adding a trigram index is a schema
   * change this feature was scoped not to need. It stops being free at roughly
   * 100k members in ONE org, which no school reaches; a `gin_trgm_ops` index
   * on (firstName, lastName) is the fix when it does.
   *
   * `withOrg` has already scoped the connection by RLS; `orgId` is still in
   * the WHERE clause because every other query in this module does the same —
   * the policy is the guarantee, the predicate is what lets Postgres use an
   * index.
   */
  async search(
    tx: LibraryTx,
    orgId: string,
    query: SearchMembersQueryDto,
    allowedBranches: string[],
  ): Promise<MemberCard[]> {
    const limit = query.limit ?? 20;
    const raw = (query.q ?? '').trim();

    // Exact lookup by the Sckools id, short-circuiting the whole ranked search.
    // This is the cross-service path (§13 of the design): Sckools holds a
    // Student.id and asks the library who that is here, rather than reading
    // library tables. Indexed by (orgId, externalRef).
    if (query.externalRef) {
      const rows = await tx.member.findMany({
        where: {
          orgId,
          externalRef: query.externalRef,
          ...(allowedBranches.length > 0
            ? { OR: [{ homeBranchId: null }, { homeBranchId: { in: allowedBranches } }] }
            : {}),
        },
        select: MEMBER_CARD_SELECT,
        take: limit,
      });
      return rows as MemberCard[];
    }

    // Same "unknown passes through" convention as listFines/listHolds: a
    // member with no home branch is visible to every branch's desk.
    const branchClause =
      allowedBranches.length > 0
        ? Prisma.sql`AND ("homeBranchId" IS NULL OR "homeBranchId" = ANY(${allowedBranches}::uuid[]))`
        : Prisma.empty;

    // An empty box lists the roll alphabetically rather than returning
    // nothing — the same fallback the catalogue search makes for an empty
    // query, so the two screens behave alike.
    if (raw === '') {
      const rows = await tx.member.findMany({
        where: {
          orgId,
          ...(allowedBranches.length > 0
            ? { OR: [{ homeBranchId: null }, { homeBranchId: { in: allowedBranches } }] }
            : {}),
        },
        select: MEMBER_CARD_SELECT,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        take: limit,
      });
      return rows as MemberCard[];
    }

    const { exact, digitsSuffix } = codeGuesses(raw);
    const escaped = escapeLikePattern(raw);
    const prefix = `${escaped}%`;
    const substring = `%${escaped}%`;
    // The code clauses only exist when the input was actually code-shaped.
    //
    // The first cut of this bound a sentinel value in their place to keep the
    // SQL one fixed shape — and a stray NUL byte ended up inside that string
    // literal, so Postgres rejected EVERY search with 22021 "invalid byte
    // sequence for encoding UTF8". Composing the fragments instead is both
    // provably correct (a clause that should not apply is absent, rather than
    // present and trusted never to match) and has no literal to get wrong.
    const exactClause = exact ? Prisma.sql`upper("code") = ${exact}` : null;
    const suffixClause = digitsSuffix ? Prisma.sql`"code" ILIKE ${digitsSuffix}` : null;

    const matches = [
      exactClause,
      Prisma.sql`"code" ILIKE ${prefix}`,
      suffixClause,
      Prisma.sql`"firstName" ILIKE ${substring}`,
      Prisma.sql`"lastName"  ILIKE ${substring}`,
      Prisma.sql`("firstName" || ' ' || "lastName") ILIKE ${substring}`,
    ].filter((c): c is Prisma.Sql => c !== null);

    const rows = await tx.$queryRaw<MemberSearchRow[]>(Prisma.sql`
      SELECT "id", "code", "firstName", "lastName", "memberType", "status", "homeBranchId",
        CASE
          ${exactClause ? Prisma.sql`WHEN upper("code") = ${exact} THEN 0` : Prisma.empty}
          WHEN "code" ILIKE ${prefix} THEN 1
          ${suffixClause ? Prisma.sql`WHEN "code" ILIKE ${digitsSuffix} THEN 2` : Prisma.empty}
          WHEN "firstName" ILIKE ${prefix} OR "lastName" ILIKE ${prefix} THEN 3
          ELSE 4
        END AS "rank"
      FROM "Member"
      WHERE "orgId" = ${orgId}::uuid
        ${branchClause}
        AND (${Prisma.join(matches, ' OR ')})
      ORDER BY "rank" ASC, ("status"::text = 'ACTIVE') DESC, "lastName" ASC, "firstName" ASC
      LIMIT ${limit}
    `);

    return rows.map(({ rank: _rank, ...card }) => card);
  }
}
