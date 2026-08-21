import { Inject, Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import Redis from 'ioredis';
import { loadEnv } from '@skoolos/config';

/** Test seam: no provider binds this token in production, so the constructor
 *  falls through to the env-built client. A BARE optional parameter is not
 *  enough — @Injectable() makes Nest try to inject its emitted design type
 *  (`Object`), and an unresolvable parameter aborts the WHOLE app bootstrap.
 *  That exact failure took the staging API down; the token + @Optional() is
 *  the load-bearing part of this file, not a nicety. */
export const REDIS_THROTTLER_CLIENT = Symbol('REDIS_THROTTLER_CLIENT');

/**
 * Launch-gate #5: rate limits that really limit.
 *
 * The default @nestjs/throttler storage counts PER LAMBDA INSTANCE — under
 * concurrency every new instance starts from zero, so "10/min on /auth/login"
 * quietly becomes 10/min × instances. This storage moves the counter into the
 * Redis the API already runs, so every instance shares one number.
 *
 * Failure policy: FAIL OPEN. The limiter is a shield, not a dependency — if
 * Redis is unreachable the request is allowed (counted as the first hit) and
 * a warning is logged, exactly like the app's other fail-open caches. An
 * outage of the rate limiter must never take authentication down with it.
 *
 * Semantics mirror v5's in-memory storage: `ttl` arrives in milliseconds,
 * `timeToExpire` is returned in whole seconds (the guard turns it into the
 * Retry-After header).
 *
 * Registered as a real class provider (not an inline value) so
 * onModuleDestroy actually runs and closes the client — a value provider's
 * silent handle leak is what once cost this repo half a build in hung e2e
 * runs.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage, OnModuleDestroy {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private readonly redis: Redis | null;

  /** Pass a client for tests; pass null for an explicit no-op storage. */
  constructor(@Optional() @Inject(REDIS_THROTTLER_CLIENT) client?: Redis | null) {
    if (client !== undefined) {
      this.redis = client;
    } else {
      const url = loadEnv().REDIS_URL;
      // enableOfflineQueue:false is load-bearing (LIBRARY-TRAPS #8): without
      // it, a Redis outage makes every request on every route queue commands
      // through connect-timeout cycles — seconds of stall API-wide, because
      // this guard is global. With it, commands reject instantly while
      // disconnected and the catch above fails open with no added latency.
      this.redis = url
        ? new Redis(url, {
            lazyConnect: true,
            maxRetriesPerRequest: 1,
            connectTimeout: 2000,
            enableOfflineQueue: false,
          })
        : null;
    }
  }

  /** True when a shared counter is actually available. */
  get shared(): boolean {
    return this.redis !== null;
  }

  async increment(key: string, ttl: number): Promise<ThrottlerStorageRecord> {
    const failOpen: ThrottlerStorageRecord = {
      totalHits: 1,
      timeToExpire: Math.ceil(ttl / 1000),
    };
    if (!this.redis) return failOpen;
    try {
      const k = `thr:${key}`;
      // INCR + PTTL in one round trip; set the window only when the key is new
      // (PTTL < 0) so an attacker's stream of requests cannot keep renewing it.
      const replies = await this.redis.multi().incr(k).pttl(k).exec();
      if (!replies || replies[0][0] || replies[1][0]) return failOpen;
      const totalHits = Number(replies[0][1]);
      let pttl = Number(replies[1][1]);
      if (!Number.isFinite(totalHits) || !Number.isFinite(pttl)) return failOpen;
      if (pttl < 0) {
        await this.redis.pexpire(k, ttl);
        pttl = ttl;
      }
      return { totalHits, timeToExpire: Math.ceil(pttl / 1000) };
    } catch (e) {
      this.logger.warn(`Rate-limit counter unavailable, failing open: ${(e as Error).message}`);
      return failOpen;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }
}
