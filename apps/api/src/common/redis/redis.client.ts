import Redis from 'ioredis';

/** DI token for the process-wide Redis client. `null` when REDIS_URL is unset. */
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

export type SharedRedis = Redis | null;

/**
 * One Redis client per process, shared by every consumer.
 *
 * Previously five services each built their own (`health`, `owner-overview`,
 * `school-lookup`, `feature-resolver`, the throttler storage). On Upstash,
 * connections are a billed and capped resource, and on serverless that count is
 * multiplied by every warm instance.
 *
 * The shared client adopts the throttler's connection options rather than the
 * caches' looser ones, because they are the safer of the two:
 *
 *   - `enableOfflineQueue: false` — without it, a Redis outage makes commands
 *     queue through connect-timeout cycles instead of failing fast. Every
 *     consumer here already treats a Redis miss as "fall through to Postgres",
 *     so failing instantly is strictly better than stalling the request.
 *   - `lazyConnect` — nothing connects at import time, so a cold start that
 *     never touches Redis never pays for it.
 *   - `maxRetriesPerRequest: 1` and a 2s connect timeout — bounded, so a
 *     degraded Redis cannot become unbounded API latency.
 */
export function createSharedRedis(url: string | undefined): SharedRedis {
  if (!url) return null;
  return new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    enableOfflineQueue: false,
  });
}

let shared: SharedRedis | undefined;

/**
 * The process-wide client, created on first use.
 *
 * Exists alongside the Nest provider because `tenant.middleware` constructs
 * SchoolLookupService directly — Nest middleware DI is unreliable under tsx, as
 * documented there. Both paths resolve to this same instance, so "one client per
 * process" holds whether a consumer is DI-wired or not.
 */
export function sharedRedis(): SharedRedis {
  if (shared === undefined) shared = createSharedRedis(process.env.REDIS_URL);
  return shared;
}

/** Test seam: drop the memoised client. */
export function resetSharedRedis(): void {
  shared = undefined;
}

/** Connect on first use. Safe to call concurrently and repeatedly. */
export async function ensureConnected(redis: SharedRedis): Promise<boolean> {
  if (!redis) return false;
  if (redis.status === 'ready') return true;
  if (redis.status === 'connecting' || redis.status === 'reconnecting') return true;
  try {
    await redis.connect();
    return true;
  } catch {
    return false;
  }
}
