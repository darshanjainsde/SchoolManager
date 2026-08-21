import { RedisThrottlerStorage } from './redis-throttler.storage';
import type Redis from 'ioredis';

/**
 * The launch-gate property this storage exists for: ONE shared counter with a
 * fixed window, and a limiter outage that never becomes an auth outage.
 * The fake below implements exactly the three commands the storage uses
 * (MULTI: INCR+PTTL, then PEXPIRE), with a controllable clock.
 */
class FakeRedis {
  store = new Map<string, { hits: number; expiresAt: number | null }>();
  now = 1_000_000;
  failing = false;

  multi() {
    return {
      incr: () => this.multiChain('incr'),
      exec: async () => this.execQueue(),
    } as unknown as ReturnType<Redis['multi']>;
  }

  private queue: string[] = [];
  private key = '';
  private multiChain(cmd: string) {
    this.queue.push(cmd);
    const self = this;
    return {
      pttl() {
        self.queue.push('pttl');
        return this;
      },
      exec: async () => this.execQueue(),
    };
  }

  // The storage always calls multi().incr(k).pttl(k).exec() — capture the key
  // through incr's argument via a Proxy-free shim instead:
  incrKey(k: string) {
    this.key = k;
  }

  private async execQueue(): Promise<[null, number][]> {
    if (this.failing) throw new Error('connection refused');
    const k = this.key;
    const row = this.store.get(k) ?? { hits: 0, expiresAt: null };
    if (row.expiresAt !== null && row.expiresAt <= this.now) {
      row.hits = 0;
      row.expiresAt = null;
    }
    row.hits += 1;
    this.store.set(k, row);
    const pttl = row.expiresAt === null ? -1 : row.expiresAt - this.now;
    this.queue = [];
    return [
      [null, row.hits],
      [null, pttl],
    ];
  }

  async pexpire(k: string, ttl: number) {
    if (this.failing) throw new Error('connection refused');
    const row = this.store.get(k);
    if (row) row.expiresAt = this.now + ttl;
    return 1;
  }

  async quit() {
    return 'OK';
  }
  disconnect() {}
}

/** Binds the fake so `.incr(k)` records the key like ioredis would. */
function clientFor(fake: FakeRedis): Redis {
  const multi = () => {
    const chain: Record<string, unknown> = {};
    chain.incr = (k: string) => {
      fake.incrKey(k);
      return chain;
    };
    chain.pttl = () => chain;
    chain.exec = () => (fake as unknown as { execQueue: () => Promise<unknown> })['execQueue']();
    return chain;
  };
  return {
    multi,
    pexpire: fake.pexpire.bind(fake),
    quit: fake.quit.bind(fake),
    disconnect: fake.disconnect.bind(fake),
  } as unknown as Redis;
}

describe('RedisThrottlerStorage', () => {
  it('counts every increment in one shared window and reports seconds-to-expiry', async () => {
    const fake = new FakeRedis();
    const storage = new RedisThrottlerStorage(clientFor(fake));

    const first = await storage.increment('login:1.2.3.4', 60_000);
    expect(first.totalHits).toBe(1);
    expect(first.timeToExpire).toBe(60);

    const second = await storage.increment('login:1.2.3.4', 60_000);
    expect(second.totalHits).toBe(2);
    // The window was set on the first hit and must NOT be renewed by later
    // hits — otherwise a steady request stream never expires the block.
    fake.now += 30_000;
    const third = await storage.increment('login:1.2.3.4', 60_000);
    expect(third.totalHits).toBe(3);
    expect(third.timeToExpire).toBe(30);
  });

  it('fails OPEN when Redis is down — the request is allowed, not errored', async () => {
    const fake = new FakeRedis();
    fake.failing = true;
    const storage = new RedisThrottlerStorage(clientFor(fake));
    const rec = await storage.increment('login:1.2.3.4', 60_000);
    expect(rec.totalHits).toBe(1);
    expect(rec.timeToExpire).toBe(60);
  });

  it('with no client it reports not-shared and behaves as a no-op', async () => {
    const storage = new RedisThrottlerStorage(null);
    expect(storage.shared).toBe(false);
    const rec = await storage.increment('k', 10_000);
    expect(rec.totalHits).toBe(1);
    await storage.onModuleDestroy();
  });
});
