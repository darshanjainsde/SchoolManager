import { createSharedRedis, ensureConnected } from './redis.client';

describe('createSharedRedis', () => {
  it('returns null when no REDIS_URL is configured', () => {
    expect(createSharedRedis(undefined)).toBeNull();
    expect(createSharedRedis('')).toBeNull();
  });

  it('fails fast rather than queueing while disconnected', () => {
    const c = createSharedRedis('redis://localhost:6379');
    // enableOfflineQueue:false is the load-bearing option — with it, a Redis
    // outage rejects commands instantly instead of stalling every request that
    // touches the cache.
    expect((c as unknown as { options: Record<string, unknown> }).options.enableOfflineQueue).toBe(false);
    expect((c as unknown as { options: Record<string, unknown> }).options.lazyConnect).toBe(true);
    c?.disconnect();
  });

  it('treats a null client as "not connected" without throwing', async () => {
    await expect(ensureConnected(null)).resolves.toBe(false);
  });
});
