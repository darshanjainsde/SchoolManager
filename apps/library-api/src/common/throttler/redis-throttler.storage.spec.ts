import { Logger } from '@nestjs/common';
import { RedisThrottlerStorage } from './redis-throttler.storage';

function fakeRedis() {
  const store = new Map<string, number>();
  return {
    store,
    client: {
      status: 'ready',
      connect: async () => {},
      incr: async (key: string) => { const n = (store.get(key) ?? 0) + 1; store.set(key, n); return n; },
      pexpire: async () => 1,
      pttl: async () => 30_000,
    } as never,
  };
}

describe('RedisThrottlerStorage', () => {
  it('counts hits in Redis so every lambda shares one limit', async () => {
    const { client } = fakeRedis();
    const storage = new RedisThrottlerStorage(client);
    const first = await storage.increment('ip:1', 60_000, 100, 0, 'default');
    const second = await storage.increment('ip:1', 60_000, 100, 0, 'default');
    expect(first.totalHits).toBe(1);
    expect(second.totalHits).toBe(2);
  });

  it('namespaces every key under lib: so it cannot collide with another product', async () => {
    const { client, store } = fakeRedis();
    await new RedisThrottlerStorage(client).increment('ip:1', 60_000, 100, 0, 'default');
    expect([...store.keys()].every((k) => k.startsWith('lib:throttle:'))).toBe(true);
  });

  it('reports isBlocked once totalHits exceeds the limit', async () => {
    const { client } = fakeRedis();
    const storage = new RedisThrottlerStorage(client);
    let last;
    for (let i = 0; i < 6; i++) {
      last = await storage.increment('ip:2', 60_000, 5, 0, 'default');
    }
    expect(last!.totalHits).toBe(6);
    expect(last!.isBlocked).toBe(true);
  });

  it('stays unblocked while under the limit', async () => {
    const { client } = fakeRedis();
    const storage = new RedisThrottlerStorage(client);
    const result = await storage.increment('ip:3', 60_000, 5, 0, 'default');
    expect(result.isBlocked).toBe(false);
  });

  describe('self-healing a dropped TTL (Group B, finding 3)', () => {
    it('a key with hits but no TTL (pttl === -1) gets one re-applied instead of blocking forever', async () => {
      const pexpireCalls: { key: string; ms: number }[] = [];
      let pttlCallCount = 0;
      // Simulates the bug's aftermath: an earlier PEXPIRE was dropped (threw,
      // or the instance died between INCR and PEXPIRE), so the key already
      // carries hits from before but has never had a TTL applied. incr()
      // returning 5 (not 1) means the `totalHits === 1` branch does NOT fire
      // this time — the only thing that can still repair the key is the
      // pttl === -1 self-heal.
      const client = {
        status: 'ready',
        connect: async () => {},
        incr: async () => 5,
        pexpire: async (key: string, ms: number) => {
          pexpireCalls.push({ key, ms });
          return 1;
        },
        pttl: async () => {
          pttlCallCount += 1;
          return -1; // no TTL — the exact symptom of a dropped PEXPIRE
        },
      } as never;
      const storage = new RedisThrottlerStorage(client);

      const result = await storage.increment('ip:8', 60_000, 3, 0, 'default');

      // Repaired: PEXPIRE was called with the throttler's own ttl, and the
      // returned window reflects a real TTL instead of staying stuck at 0
      // (which would mean "already expired" forever, i.e. permanently
      // blocked with no way to recover without deleting the key by hand).
      expect(pexpireCalls).toEqual([{ key: 'lib:throttle:default:ip:8', ms: 60_000 }]);
      expect(result.timeToExpire).toBe(60);
      expect(result.isBlocked).toBe(true); // 5 hits > limit 3 — still correctly blocked, just no longer stuck
      expect(result.timeToBlockExpire).toBe(60);
      // Single round trip for the repair itself: pttl is read once, then
      // (once -1 is seen) the TTL value is known locally — no second pttl
      // read to confirm what was just set.
      expect(pttlCallCount).toBe(1);
    });

    it('does not re-apply PEXPIRE when a real TTL is already present', async () => {
      const { client } = fakeRedis(); // pttl() always returns 30_000 (healthy)
      let pexpireCalls = 0;
      const wrapped = {
        ...(client as object),
        pexpire: async (...args: unknown[]) => {
          pexpireCalls += 1;
          return ((client as { pexpire: (...a: unknown[]) => Promise<number> }).pexpire)(...args);
        },
      };
      const storage = new RedisThrottlerStorage(wrapped as never);

      await storage.increment('ip:9', 60_000, 5, 0, 'default');
      await storage.increment('ip:9', 60_000, 5, 0, 'default');

      // Only the first hit's `totalHits === 1` PEXPIRE — the self-heal path
      // never fires because pttl() never reports -1.
      expect(pexpireCalls).toBe(1);
    });
  });

  it('fails open (does not throw, does not block) when Redis errors', async () => {
    const client = {
      status: 'ready',
      connect: async () => {},
      incr: async () => { throw new Error('ECONNREFUSED'); },
      pexpire: async () => 1,
      pttl: async () => 30_000,
    } as never;
    const storage = new RedisThrottlerStorage(client);
    const result = await storage.increment('ip:4', 60_000, 5, 0, 'default');
    expect(result.isBlocked).toBe(false);
  });

  describe('fail-open logging', () => {
    let warnSpy: jest.SpyInstance;

    beforeEach(() => {
      warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    function brokenClient() {
      return {
        status: 'ready',
        connect: async () => {},
        incr: async () => { throw new Error('ECONNREFUSED'); },
        pexpire: async () => 1,
        pttl: async () => 30_000,
      } as never;
    }

    it('logs a warning naming the failure and its consequence when it fails open', async () => {
      const storage = new RedisThrottlerStorage(brokenClient());
      await storage.increment('ip:5', 60_000, 5, 0, 'default');

      expect(warnSpy).toHaveBeenCalledTimes(1);
      const message = warnSpy.mock.calls[0][0] as string;
      expect(message).toMatch(/ECONNREFUSED/);
      expect(message).toMatch(/rate limiting is DISABLED/i);
    });

    it('suppresses repeat warnings within the suppression window instead of flooding the log', async () => {
      const storage = new RedisThrottlerStorage(brokenClient());
      await storage.increment('ip:6', 60_000, 5, 0, 'default');
      await storage.increment('ip:6', 60_000, 5, 0, 'default');
      await storage.increment('ip:6', 60_000, 5, 0, 'default');

      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('warns again once the suppression window has elapsed', async () => {
      const nowSpy = jest.spyOn(Date, 'now');
      const storage = new RedisThrottlerStorage(brokenClient());

      nowSpy.mockReturnValue(1_000_000);
      await storage.increment('ip:7', 60_000, 5, 0, 'default');
      expect(warnSpy).toHaveBeenCalledTimes(1);

      nowSpy.mockReturnValue(1_000_000 + 30_000); // exactly the suppression window later
      await storage.increment('ip:7', 60_000, 5, 0, 'default');
      expect(warnSpy).toHaveBeenCalledTimes(2);

      nowSpy.mockRestore();
    });
  });
});
