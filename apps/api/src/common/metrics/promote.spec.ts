import { MetricsService } from './metrics.service';

/**
 * Redis is a buffer, Postgres is the store. Promotion is what makes that true,
 * and it has two properties worth pinning: it never takes a minute that is
 * still being written to, and it only deletes what it actually promoted.
 */
describe('metrics promotion', () => {
  const NOW = 1_700_000_400_000; // an exact minute boundary

  function harness(hashes: Record<string, Record<string, string>>) {
    const deleted: string[] = [];
    const read: string[] = [];
    const pipe = {
      hgetall: (k: string) => { read.push(k); return pipe; },
      del: (k: string) => { deleted.push(k); return pipe; },
      exec: async () => read.map((k) => [null, hashes[k] ?? {}]),
    };
    const client = { status: 'ready', pipeline: () => pipe } as never;
    return { client, read, deleted };
  }

  it('never reads the minute currently being written to', async () => {
    const { client, read } = harness({});
    const svc = new MetricsService(client);
    await svc.promote(NOW);
    const currentMinute = Math.floor(NOW / 60_000);
    expect(read).not.toContain(`m:${currentMinute}`);
    expect(read[0]).toBe(`m:${currentMinute - 1}`);
    svc.onModuleDestroy();
  });

  it('promotes nothing and deletes nothing when the buffer is empty', async () => {
    const { client, deleted } = harness({});
    const svc = new MetricsService(client);
    const res = await svc.promote(NOW);
    expect(res).toEqual({ minutes: 0, routes: 0 });
    expect(deleted).toEqual([]);
    svc.onModuleDestroy();
  });

  it('is a no-op with no Redis, rather than throwing into the caller', async () => {
    const svc = new MetricsService(null);
    await expect(svc.promote(NOW)).resolves.toEqual({ minutes: 0, routes: 0 });
    svc.onModuleDestroy();
  });
});
