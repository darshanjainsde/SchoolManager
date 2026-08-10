import { ForbiddenException } from '@nestjs/common';
import type { LibraryTx } from '@library/db';

/**
 * Counts inside the caller's transaction (`tx`), never a fresh client. If it
 * counted outside the transaction, two concurrent creations on a 1-unit plan
 * could both observe "0 existing" and both pass — the exact TOCTOU race a
 * quota exists to prevent. See the Task 10 report for a real-Postgres proof
 * of both the guarded and unguarded cases.
 *
 * `limit` is always the plan's numeric quota, never a capability flag:
 * PlanOverride only carries a boolean `enabled`, so a capability override
 * (e.g. MULTI_BRANCH) can never widen a quota on its own — only
 * PlanResolverService's `quotas` may raise this limit.
 */
export async function assertQuota(
  tx: LibraryTx,
  orgId: string,
  limit: number,
  count: (tx: LibraryTx, orgId: string) => Promise<number>,
  what: string,
): Promise<void> {
  if (limit === Infinity) return;
  const current = await count(tx, orgId);
  if (current >= limit) {
    throw new ForbiddenException(`Your plan allows ${limit} ${what}. Upgrade to add more.`);
  }
}
