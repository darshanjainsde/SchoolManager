import { ForbiddenException } from '@nestjs/common';
import type { LibraryTx } from '@library/db';

/**
 * Counts inside the caller's transaction (`tx`), never a fresh client. If it
 * counted outside the transaction, two concurrent creations on a 1-unit plan
 * could both observe "0 existing" and both pass — the exact TOCTOU race a
 * quota exists to prevent.
 *
 * Counting inside the tx is necessary but, on its own, NOT sufficient:
 * confirmed empirically against real Postgres (see the Task 10 report), two
 * transactions that both begin before either commits can both run their
 * SELECT count under READ COMMITTED, both see the same pre-race count, and
 * both pass — "inside a transaction" does not imply "serialized against
 * concurrent siblings" without an explicit lock. A transaction-scoped
 * advisory lock closes that window: it is acquired before the count, keyed
 * on (orgId, what), and automatically released at COMMIT/ROLLBACK — a second
 * concurrent caller for the same org+resource blocks on the same key until
 * the first transaction ends, then re-counts against the now-committed
 * state. `pg_advisory_xact_lock` (not `pg_advisory_lock`) specifically so
 * there is no manual unlock and no risk of leaking a session-level lock past
 * this transaction's lifetime.
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
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orgId}), hashtext(${what}))`;
  const current = await count(tx, orgId);
  if (current >= limit) {
    throw new ForbiddenException(`Your plan allows ${limit} ${what}. Upgrade to add more.`);
  }
}
