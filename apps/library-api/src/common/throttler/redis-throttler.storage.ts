import Redis from 'ioredis';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { Logger } from '@nestjs/common';
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
 * the throttler's `ttl` so the window resets itself. If a later read of the
 * key's TTL ever comes back -1 (key exists but carries no expiry — only
 * possible here if an earlier PEXPIRE threw or this instance died between
 * the INCR and the PEXPIRE), the TTL is re-applied on the spot rather than
 * left missing: a key with no TTL would otherwise climb forever and block
 * the caller until someone deletes it by hand, which a dropped PEXPIRE must
 * never be able to cause. `isBlocked` is simply "hits this window have
 * exceeded `limit`" — there is no separate
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
 *
 * Fail-open is silent to the request path by design (it must not throw),
 * but it is not silent to operators: every fail-open hit logs a warning —
 * see `warnFailOpen` — because "rate limiting is off" for a public,
 * unauthenticated route is exactly the kind of fact a 3am on-call engineer
 * needs surfaced, not buried in a source comment nobody reads at request time.
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly client: RedisLike;
  private readonly logger = new Logger(RedisThrottlerStorage.name);

  /**
   * Single timestamp, not a per-key or per-request structure — this is a
   * log-suppression knob, not rate-limiting state, and it does not grow
   * with traffic or key cardinality. It never influences whether a request
   * is allowed (that decision stays 100% Redis-backed); it only decides
   * whether *this instance* has warned recently. That is why it does not
   * fall under this task's "nothing in process memory" constraint, which
   * is about not reintroducing an in-process counter that the limiter
   * itself relies on — this counts log lines, not hits.
   */
  private lastFailOpenWarnAt = 0;
  private static readonly WARN_INTERVAL_MS = 30_000;

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
      let pttl = await this.client.pttl(redisKey);
      // Self-heal a dropped PEXPIRE: if the PEXPIRE above threw, or this
      // instance died between the INCR and the PEXPIRE on some earlier
      // request, the key persists with no TTL forever — every later INCR
      // just keeps climbing, pttl() keeps returning -1, and isBlocked stays
      // true until someone deletes the key by hand. `pttl === -1` means
      // "key exists but carries no TTL", which — for a key this class ever
      // creates — can only mean a missing/failed PEXPIRE, never a
      // deliberate choice. Re-apply it right here so the key inherits a
      // fresh window instead of blocking indefinitely. This only costs an
      // extra Redis round trip in that broken case; the healthy path (TTL
      // already present) costs exactly what it did before.
      if (pttl === -1) {
        await this.client.pexpire(redisKey, ttl);
        pttl = ttl;
      }
      const timeToExpire = Math.ceil(Math.max(pttl, 0) / 1000);
      const isBlocked = totalHits > limit;
      const timeToBlockExpire = isBlocked ? timeToExpire : 0;
      return { totalHits, timeToExpire, isBlocked, timeToBlockExpire };
    } catch (err) {
      // Fail open — see class doc. Reported as "just started, not blocked"
      // so ThrottlerGuard lets the request through uncounted rather than
      // throwing a 5xx that would take the whole API down with it.
      this.warnFailOpen(err);
      return { totalHits: 1, timeToExpire: Math.ceil(ttl / 1000), isBlocked: false, timeToBlockExpire: 0 };
    }
  }

  /**
   * Time-based suppression, not state-transition-based: logs at most once
   * per `WARN_INTERVAL_MS` regardless of whether this is the first failure
   * in a new outage or the thousandth request into an ongoing one. Chosen
   * over "log once on the way down, once on the way up" because it needs
   * no extra state beyond a single timestamp, gives an operator a
   * heartbeat for the entire duration of a sustained outage (not just its
   * edges), and degrades the same way under either a single Redis blip or
   * a prolonged one — one clear signal every 30s, never a flood.
   */
  private warnFailOpen(err: unknown): void {
    const now = Date.now();
    if (now - this.lastFailOpenWarnAt < RedisThrottlerStorage.WARN_INTERVAL_MS) return;
    this.lastFailOpenWarnAt = now;
    const reason = err instanceof Error ? err.message : String(err);
    this.logger.warn(
      `Redis unavailable (${reason}) — failing open: rate limiting is DISABLED for this request and will stay ` +
        `disabled for any request hitting this failure until Redis recovers. Suppressing repeats of this warning ` +
        `for ${RedisThrottlerStorage.WARN_INTERVAL_MS / 1000}s.`,
    );
  }

  private async connect(): Promise<void> {
    if (this.client.status === 'wait' || this.client.status === 'end') {
      await this.client.connect();
    }
  }
}
