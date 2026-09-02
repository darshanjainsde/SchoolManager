import { withTenant } from './index';

/**
 * withTenant is what makes RLS work: it opens a transaction and sets
 * `app.current_tenant` so the policies can see which tenant is asking.
 *
 * These tests pin the two properties that are easy to regress silently — that
 * the tenant id is passed as a bound parameter rather than spliced into SQL,
 * and that the transaction carries explicit timeouts rather than inheriting
 * Prisma's defaults.
 */
describe('withTenant', () => {
  const TENANT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  function fakeClient() {
    const tx = { $executeRaw: jest.fn().mockResolvedValue(1) };
    const $transaction = jest.fn(
      async (fn: (t: unknown) => Promise<unknown>, _opts?: unknown) => fn(tx),
    );
    return { tx, client: { $transaction } as never, $transaction };
  }

  it('rejects a tenant id that is not a UUID', async () => {
    const { client } = fakeClient();
    await expect(withTenant("' OR 1=1 --", async () => 'x', client)).rejects.toThrow(
      'withTenant: tenantId must be a UUID',
    );
  });

  it('binds the tenant id as a parameter instead of splicing it into SQL', async () => {
    const { tx, client } = fakeClient();
    await withTenant(TENANT, async () => 'ok', client);

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = tx.$executeRaw.mock.calls[0];
    // A tagged-template call: Prisma receives the literal chunks separately
    // from the values, so the id can never be interpolated into the statement.
    expect(Array.isArray(strings)).toBe(true);
    expect(strings.join('?')).toContain('set_config');
    expect(values).toEqual([TENANT]);
    expect(strings.join('')).not.toContain(TENANT);
  });

  it('sets an explicit transaction timeout rather than inheriting the default', async () => {
    const { client, $transaction } = fakeClient();
    await withTenant(TENANT, async () => 'ok', client);

    const opts = $transaction.mock.calls[0][1] as { timeout: number; maxWait: number };
    expect(opts).toBeDefined();
    expect(opts.timeout).toBeGreaterThan(5_000);
    expect(opts.maxWait).toBeGreaterThan(0);
  });

  it('returns the callback result', async () => {
    const { client } = fakeClient();
    await expect(withTenant(TENANT, async () => 42, client)).resolves.toBe(42);
  });
});
