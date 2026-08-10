import { ForbiddenException } from '@nestjs/common';
import type { LibraryTx } from '@library/db';
import { assertQuota } from './require-quota';

function fakeTx(onExecuteRaw?: () => void): LibraryTx {
  return {
    $executeRaw: async (..._args: unknown[]) => {
      onExecuteRaw?.();
      return 0;
    },
  } as unknown as LibraryTx;
}

describe('assertQuota', () => {
  it('returns immediately for an Infinity limit, without ever counting or locking', async () => {
    let counted = false;
    let locked = false;
    await assertQuota(
      fakeTx(() => { locked = true; }),
      'org-1',
      Infinity,
      async () => {
        counted = true;
        return 999;
      },
      'branches',
    );
    expect(counted).toBe(false);
    expect(locked).toBe(false);
  });

  it('allows when the count is below the limit', async () => {
    await expect(
      assertQuota(fakeTx(), 'org-1', 3, async () => 2, 'branches'),
    ).resolves.toBeUndefined();
  });

  it('rejects when the count has already reached the limit', async () => {
    await expect(
      assertQuota(fakeTx(), 'org-1', 1, async () => 1, 'branches'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects when the count exceeds the limit', async () => {
    await expect(
      assertQuota(fakeTx(), 'org-1', 1, async () => 5, 'branches'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('passes the caller-supplied tx and orgId through to the counter, never a fresh client', async () => {
    const tx = fakeTx();
    let seenTx: unknown;
    let seenOrg: unknown;
    await assertQuota(
      tx,
      'org-42',
      5,
      async (t, o) => {
        seenTx = t;
        seenOrg = o;
        return 0;
      },
      'branches',
    );
    expect(seenTx).toBe(tx);
    expect(seenOrg).toBe('org-42');
  });

  /**
   * Regression test for a real defect found running the Task 10 concurrency
   * proof against live Postgres: counting inside the caller's tx is
   * necessary but NOT sufficient under READ COMMITTED — two transactions
   * that both begin before either commits can both see the same
   * pre-race count and both pass. A transaction-scoped advisory lock,
   * taken before the count, closes that window: a second concurrent
   * caller blocks on the same lock key until the first transaction ends.
   */
  it('takes a transaction-scoped advisory lock before counting, so a concurrent caller on the same org+resource serializes', async () => {
    const calls: string[] = [];
    const tx = fakeTx(() => calls.push('lock'));
    await assertQuota(
      tx,
      'org-1',
      3,
      async () => {
        calls.push('count');
        return 0;
      },
      'branches',
    );
    expect(calls).toEqual(['lock', 'count']);
  });
});
