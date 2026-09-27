import { withOrg } from './index';

const ORG = '11111111-1111-4111-8111-111111111111';

/**
 * The fake records the STATEMENT and its BOUND VALUES separately, because that
 * separation is the thing under test. `$executeRaw` is a tagged template: it
 * receives the SQL as fragments and the interpolations as parameters, so a
 * captured `values` array is proof the org id never became part of the
 * statement text.
 */
interface Call { sql: string; values: unknown[] }

function fakeClient(captured: Call[], capturedOptions?: unknown[]) {
  return {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>, options?: unknown) => {
      capturedOptions?.push(options);
      return fn({
        $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
          captured.push({ sql: strings.join('?'), values });
          return 0;
        },
      });
    },
  } as never;
}

describe('withOrg', () => {
  it('rejects a non-UUID org id before touching the database', async () => {
    const captured: Call[] = [];
    await expect(
      withOrg("' OR 1=1 --", async () => 'never', fakeClient(captured)),
    ).rejects.toThrow('withOrg: orgId must be a UUID');
    expect(captured).toHaveLength(0);
  });

  it('sets the transaction-scoped GUC before running the callback', async () => {
    const captured: Call[] = [];
    const result = await withOrg(ORG, async () => 'ok', fakeClient(captured));
    expect(result).toBe('ok');
    expect(captured).toHaveLength(1);
    expect(captured[0].sql).toBe("SELECT set_config('app.current_org', ?, TRUE)");
  });

  it('binds the org id as a parameter rather than splicing it into the SQL', async () => {
    // The UUID check above is defence in depth; THIS is the guard. If the id is
    // ever interpolated again, the statement text will contain it and this
    // fails — which is the whole point, because the interpolated version was
    // one careless refactor away from SQL injection at the tenancy boundary.
    const captured: Call[] = [];
    await withOrg(ORG, async () => 'ok', fakeClient(captured));
    expect(captured[0].values).toEqual([ORG]);
    expect(captured[0].sql).not.toContain(ORG);
  });

  it('scopes the setting to the TRANSACTION, not the session', async () => {
    // `TRUE` is the is_local argument. Without it the setting outlives the
    // transaction and, behind a transaction-mode pooler, the next client on
    // that server connection inherits the previous tenant.
    const captured: Call[] = [];
    await withOrg(ORG, async () => 'ok', fakeClient(captured));
    expect(captured[0].sql).toContain('TRUE)');
  });

  it('forwards an explicit options object (e.g. a longer timeout) to $transaction unchanged', async () => {
    const captured: Call[] = [];
    const capturedOptions: unknown[] = [];
    const result = await withOrg(ORG, async () => 'ok', fakeClient(captured, capturedOptions), { timeout: 30000, maxWait: 5000 });
    expect(result).toBe('ok');
    expect(capturedOptions).toEqual([{ timeout: 30000, maxWait: 5000 }]);
  });

  it('passes undefined options through when the caller does not supply any (Prisma keeps its own defaults)', async () => {
    const captured: Call[] = [];
    const capturedOptions: unknown[] = [];
    await withOrg(ORG, async () => 'ok', fakeClient(captured, capturedOptions));
    expect(capturedOptions).toEqual([undefined]);
  });
});
