import { withOrg } from './index';

const ORG = '11111111-1111-4111-8111-111111111111';

function fakeClient(captured: string[], capturedOptions?: unknown[]) {
  return {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>, options?: unknown) => {
      capturedOptions?.push(options);
      return fn({ $executeRawUnsafe: async (sql: string) => { captured.push(sql); return 0; } });
    },
  } as never;
}

describe('withOrg', () => {
  it('rejects a non-UUID org id before touching the database', async () => {
    const captured: string[] = [];
    await expect(
      withOrg("' OR 1=1 --", async () => 'never', fakeClient(captured)),
    ).rejects.toThrow('withOrg: orgId must be a UUID');
    expect(captured).toHaveLength(0);
  });

  it('sets the transaction-scoped GUC before running the callback', async () => {
    const captured: string[] = [];
    const result = await withOrg(ORG, async () => 'ok', fakeClient(captured));
    expect(result).toBe('ok');
    expect(captured).toEqual([`SET LOCAL app.current_org = '${ORG}'`]);
  });

  it('forwards an explicit options object (e.g. a longer timeout) to $transaction unchanged', async () => {
    const captured: string[] = [];
    const capturedOptions: unknown[] = [];
    const result = await withOrg(ORG, async () => 'ok', fakeClient(captured, capturedOptions), { timeout: 30000, maxWait: 5000 });
    expect(result).toBe('ok');
    expect(capturedOptions).toEqual([{ timeout: 30000, maxWait: 5000 }]);
  });

  it('passes undefined options through when the caller does not supply any (Prisma keeps its own defaults)', async () => {
    const captured: string[] = [];
    const capturedOptions: unknown[] = [];
    await withOrg(ORG, async () => 'ok', fakeClient(captured, capturedOptions));
    expect(capturedOptions).toEqual([undefined]);
  });
});
