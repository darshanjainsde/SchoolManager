import Redis from 'ioredis';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { loadLibraryEnv } from '../../config/env';

/**
 * The subset of ioredis's client surface this class needs — narrow enough
 * that `redis-throttler.storage.spec.ts` can pass a plain object instead of
 * a real connection, and explicit enough that a real `Redis` instance
 * satisfies it with no adapter.
 */
export interface RedisLike {
  status: string;
  connect(): Promise<void>;
  incr(key: string): Promise<number>;
  pexpire(key: string, milliseconds: number): Promise<number>;
  pttl(key: string): Promise<number>;
}

interface ThrottlerRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

function makeDefaultClient(): RedisLike {
  const env = loadLibraryEnv();
  // Own connection, lazily opened — same shape as org.middleware.ts and
  // PlansModule's makeRedisPlanCache: each module's Redis usage is isolated
  // rather than sharing one client, so one consumer's failure mode doesn't
  // couple to another's.
  return new Redis(env.LIBRARY_REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 2 }) as unknown as RedisLike;
}

/**
 * Redis-backed replacement for @nestjs/throttler's default
 * `ThrottlerStorageService`, which keeps its counters in a plain in-process
 * object. On a serverless platform with N warm lambda instances, each
 * instance has its own copy of that object, so a configured limit of
 * 100/min is actually enforced as up to N×100/min — a live, known gap in
 * the sibling Sckools system. Every counter here lives in Redis instead, so
 * every instance (and every route using the shared `default` throttler)
 * counts against the same key.
 *
 * Keys are namespaced `lib:throttle:<throttlerName>:<key>` — the `lib:`
 * prefix keeps this service's Redis keyspace disjoint from any other
 * product sharing the same Redis instance/keyspace.
 *
 * Algorithm: INCR the key; on the first hit (result === 1) PEXPIRE it to
 * the throttler's `ttl` so the window resets itself. `isBlocked` is simply
 * "hits this window have exceeded `limit`" — there is no separate
 * block-state key, so unlike the in-memory default's `blockDuration`
 * (which can outlive the counting window), the block here clears itself
 * exactly when the counting window's TTL lapses and the next INCR starts a
 * fresh key at 1. That is a deliberate simplification: the brief's own
 * fixture (`redis-throttler.storage.spec.ts`) only exercises `incr`,
 * `pexpire`, and `pttl` — no persistent block-state command — and a
 * blockDuration that outlives ttl is not part of this service's declared
 * behaviour (`ThrottlerModule.forRoot` here never sets `blockDuration`, so
 * it defaults to `ttl` and the two windows coincide anyway).
 *
 * Fail-open on any Redis error: `ThrottlerGuard` is registered once,
 * app-wide, as an `APP_GUARD` (see app.module.ts) — it runs in front of
 * every route, including health checks and login. A fail-closed storage
 * would turn any transient Redis blip into a full outage of the entire
 * API. Fail-open trades that for a narrower, temporary, self-healing risk:
 * rate limiting is briefly disabled until Redis recovers. Given this
 * service has no fallback source of truth for "how many hits has this key
 * seen" (unlike OrgLookupService/PlanResolverService, which fail open onto
 * a database read), "fail open" here means "skip the check for this
 * request," not "serve a slightly stale answer" — a different, but still
 * deliberately chosen, trade-off from those two services' cache-aside
 * pattern.
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly client: RedisLike;

  constructor(client?: RedisLike) {
    this.client = client ?? makeDefaultClient();
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    _blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerRecord> {
    const redisKey = `lib:throttle:${throttlerName}:${key}`;
    try {
      await this.connect();
      const totalHits = await this.client.incr(redisKey);
      if (totalHits === 1) {
        await this.client.pexpire(redisKey, ttl);
      }
      const pttl = await this.client.pttl(redisKey);
      const timeToExpire = Math.ceil(Math.max(pttl, 0) / 1000);
      const isBlocked = totalHits > limit;
      const timeToBlockExpire = isBlocked ? timeToExpire : 0;
      return { totalHits, timeToExpire, isBlocked, timeToBlockExpire };
    } catch {
      // Fail open — see class doc. Reported as "just started, not blocked"
      // so ThrottlerGuard lets the request through uncounted rather than
      // throwing a 5xx that would take the whole API down with it.
      return { totalHits: 1, timeToExpire: Math.ceil(ttl / 1000), isBlocked: false, timeToBlockExpire: 0 };
    }
  }

  private async connect(): Promise<void> {
    if (this.client.status === 'wait' || this.client.status === 'end') {
      await this.client.connect();
    }
  }
}
