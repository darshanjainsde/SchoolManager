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
