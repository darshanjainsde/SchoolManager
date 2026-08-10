import { ForbiddenException } from '@nestjs/common';
import { assertQuota } from './require-quota';

describe('assertQuota', () => {
  it('returns immediately for an Infinity limit, without ever counting', async () => {
    let counted = false;
    await assertQuota(
      {} as never,
      'org-1',
      Infinity,
      async () => {
        counted = true;
        return 999;
      },
      'branches',
    );
    expect(counted).toBe(false);
  });

  it('allows when the count is below the limit', async () => {
    await expect(
      assertQuota({} as never, 'org-1', 3, async () => 2, 'branches'),
    ).resolves.toBeUndefined();
  });

  it('rejects when the count has already reached the limit', async () => {
    await expect(
      assertQuota({} as never, 'org-1', 1, async () => 1, 'branches'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects when the count exceeds the limit', async () => {
    await expect(
      assertQuota({} as never, 'org-1', 1, async () => 5, 'branches'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('passes the caller-supplied tx and orgId through to the counter, never a fresh client', async () => {
    const tx = { marker: 'caller-tx' } as never;
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
});
