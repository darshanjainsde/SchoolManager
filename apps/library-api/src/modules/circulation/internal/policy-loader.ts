import { NotFoundException } from '@nestjs/common';
import { Prisma, type LibraryTx, type MemberType } from '@library/db';
import type { Policy } from './policy';

/** `Prisma.Decimal | null` (a nullable money/rate column) -> plain `number | null`, never a string. */
function decimalToNullableNumber(value: Prisma.Decimal | null): number | null {
  return value === null ? null : value.toNumber();
}

/**
 * Loads the `CirculationPolicy` row for `(orgId, memberType)`, preferring a
 * BRANCH-SPECIFIC row over the org default, and converts it into
 * `policy.ts`'s pure `Policy` shape — the ONLY place this Decimal-to-number
 * conversion happens, so `evaluateIssue`/`evaluateRenew`/`computeFine` never
 * see a Prisma `Decimal` and every circulation call site gets numbers built
 * the same way. Reads run on `tx`, so they are scoped by the same `withOrg`
 * transaction (and therefore RLS) as the caller's other reads.
 *
 * `branchId` is the branch the decision under evaluation actually concerns
 * (the copy being issued/returned, the loan being renewed) — `null` when no
 * branch is known or relevant (e.g. placing a hold, before any copy is
 * chosen), which resolves straight to the org default. Two `findFirst`
 * lookups (never `findUnique`): the migration deliberately does NOT declare
 * `@@unique([orgId, branchId, memberType])` in the Prisma schema — a plain
 * Prisma unique wouldn't stop two org-default rows from coexisting (NULL is
 * distinct from NULL under a plain unique index), so real uniqueness is two
 * PARTIAL SQL indexes instead (see the migration's own doc), which Prisma's
 * type generator has no way to expose as a `findUnique` compound key.
 *
 * Every circulation decision goes through `policy.ts` — see that file's own
 * header comment — so this loader is what makes calling it from a real
 * Prisma-backed service possible at all, without ever re-deriving "how to
 * read a CirculationPolicy row" inline in `loans.service.ts`.
 */
export async function loadPolicy(
  tx: LibraryTx,
  orgId: string,
  memberType: MemberType,
  branchId: string | null = null,
): Promise<Policy> {
  const branchRow = branchId ? await tx.circulationPolicy.findFirst({ where: { orgId, branchId, memberType } }) : null;
  const row = branchRow ?? (await tx.circulationPolicy.findFirst({ where: { orgId, branchId: null, memberType } }));
  if (!row) {
    throw new NotFoundException(`No circulation policy configured for member type ${memberType}`);
  }
  return {
    maxBooks: row.maxBooks,
    loanDays: row.loanDays,
    renewLimit: row.renewLimit,
    renewDays: row.renewDays,
    finePerDay: row.finePerDay.toNumber(),
    graceDays: row.graceDays,
    maxFine: decimalToNullableNumber(row.maxFine),
    maxHolds: row.maxHolds,
    holdShelfDays: row.holdShelfDays,
    maxOutstandingFine: decimalToNullableNumber(row.maxOutstandingFine),
  };
}
