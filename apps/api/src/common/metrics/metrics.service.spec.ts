import { MetricsService, bucketKey } from './metrics.service';

function fakeRedis() {
  const calls: Array<[string, ...unknown[]]> = [];
  const pipe = {
    hincrby: (...a: unknown[]) => { calls.push(['hincrby', ...a]); return pipe; },
    expire: (...a: unknown[]) => { calls.push(['expire', ...a]); return pipe; },
    exec: jest.fn().mockResolvedValue([]),
  };
  return { calls, client: { status: 'ready', pipeline: () => pipe } as never, pipe };
}

describe('MetricsService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('does nothing on flush when no traffic was recorded', async () => {
    const { client, pipe } = fakeRedis();
    const svc = new MetricsService(client);
    await svc.flush();
    expect(pipe.exec).not.toHaveBeenCalled();
    svc.onModuleDestroy();
  });

  it('flushes counts, errors and both histograms in one pipeline', async () => {
    const { calls, client, pipe } = fakeRedis();
    const svc = new MetricsService(client);
    const label = svc.label('GET', '/a', '/a')!;
    svc.record(label, 200, 30);
    svc.record(label, 500, 30);
    svc.recordDbHold(label, 4);
    await svc.flush();

    expect(pipe.exec).toHaveBeenCalledTimes(1);
    const fields = calls.filter((c) => c[0] === 'hincrby').map((c) => c[2]);
    expect(fields).toContain('GET /a|count');
    expect(fields).toContain('GET /a|errors');
    // one latency bucket and one db-hold bucket were touched
    expect(fields.some((f) => String(f).includes('|l'))).toBe(true);
    expect(fields.some((f) => String(f).includes('|d'))).toBe(true);
    // and the key is TTL'd so buckets cannot accumulate forever
    expect(calls.some((c) => c[0] === 'expire')).toBe(true);
    svc.onModuleDestroy();
  });

  it('uses HINCRBY so two instances ADD into the same minute rather than overwrite', async () => {
    const { calls, client } = fakeRedis();
    const svc = new MetricsService(client);
    const label = svc.label('GET', '/a', '/a')!;
    svc.record(label, 200, 30);
    await svc.flush();
    expect(calls.filter((c) => c[0] === 'hincrby').length).toBeGreaterThan(0);
    expect(calls.some((c) => c[0] === 'set' || c[0] === 'hset')).toBe(false);
    svc.onModuleDestroy();
  });

  it('swallows a Redis failure rather than letting it reach a request', async () => {
    const client = {
      status: 'ready',
      pipeline: () => ({
        hincrby() { return this; },
        expire() { return this; },
        exec: jest.fn().mockRejectedValue(new Error('redis down')),
      }),
    } as never;
    const svc = new MetricsService(client);
    const label = svc.label('GET', '/a', '/a')!;
    svc.record(label, 200, 5);
    await expect(svc.flush()).resolves.toBeUndefined();
    svc.onModuleDestroy();
  });

  it('is a no-op with no Redis configured', async () => {
    const svc = new MetricsService(null);
    const label = svc.label('GET', '/a', '/a')!;
    svc.record(label, 200, 5);
    await expect(svc.flush()).resolves.toBeUndefined();
    svc.onModuleDestroy();
  });

  it('keys buckets by epoch minute', () => {
    expect(bucketKey(29_000_000)).toBe('m:29000000');
  });
});
