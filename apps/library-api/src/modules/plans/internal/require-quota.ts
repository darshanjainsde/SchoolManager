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
 *
 * Before you add a second `assertQuota` call inside the same transaction:
 * the advisory lock above is keyed on `(orgId, what)` and held until the
 * transaction commits or rolls back — it does not release between calls.
 * If one transaction checks `branches` then `adminSeats`, while a concurrent
 * transaction checks the same two resources in the opposite order, each can
 * end up holding the lock the other wants next: a classic AB-BA deadlock.
 * Postgres will detect it and abort one side, but an unexplained abort in a
 * foundational primitive is a bad surprise to leave for whoever hits it
 * first. So: if a transaction ever needs to call `assertQuota` more than
 * once, every call site doing so must acquire in the same order — sort by
 * `what` (e.g. always `adminSeats` before `branches`, alphabetically) — so
 * two concurrent transactions can never be holding what the other needs
 * next. Nothing in this codebase calls `assertQuota` twice in one
 * transaction today, which is why this has never manifested. If
 * multi-resource quota checks become common, don't paper over it with
 * ad-hoc ordering at each call site — add a single call that takes all the
 * resources being checked and locks them in canonical order itself, the
 * same way a `SELECT ... FOR UPDATE` over multiple rows should always lock
 * in a fixed order to stay deadlock-free.
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
