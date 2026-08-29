import { Inject, Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { getPlatformPrisma } from '@skoolos/db';
import { REDIS_CLIENT, ensureConnected, sharedRedis, type SharedRedis } from '../redis/redis.client';
import { BUCKETS_MS, mergeBuckets } from './histogram';
import { MetricsCollector, type RouteBucket } from './metrics.collector';
import { capLabels, routeLabel } from './route-label';

/** How often the in-memory window is pushed to Redis. */
const FLUSH_MS = 15_000;

/**
 * Minute buckets are a BUFFER, not a store. They are promoted to Postgres every
 * few minutes and deleted; the TTL is only a backstop for a promotion that never
 * ran, so Redis never accumulates. That matters on Upstash, where storage and
 * commands are both billed.
 */
const BUCKET_TTL_S = 2 * 60 * 60;

/** How often completed minutes are promoted out of Redis into history. */
const PROMOTE_EVERY_MS = 5 * 60_000;

export const bucketKey = (minute: number): string => `m:${minute}`;

/**
 * Collects request metrics in memory and flushes them to Redis in one pipeline.
 *
 * Nothing here may ever throw into a request or add measurable latency: a
 * metrics system that degrades the thing it measures is worse than no metrics.
 * Every Redis call is wrapped, failures are logged once and dropped, and the
 * recording path is a Map write and two array increments.
 */
@Injectable()
export class MetricsService implements OnModuleDestroy {
  private readonly logger = new Logger(MetricsService.name);
  private readonly collector = new MetricsCollector();
  private readonly known = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  private lastPromote = 0;

  constructor(@Optional() @Inject(REDIS_CLIENT) private readonly redis: SharedRedis = sharedRedis()) {
    // unref so a pending flush can never hold the process open — on Vercel the
    // instance freezes between invocations and an active timer would fight that.
    this.timer = setInterval(() => {
      void this.flush().then(() => {
        if (Date.now() - this.lastPromote < PROMOTE_EVERY_MS) return;
        this.lastPromote = Date.now();
        return this.promote();
      });
    }, FLUSH_MS);
    this.timer.unref?.();
  }

  /**
   * Move completed minutes from Redis into hourly rows in Postgres.
   *
   * Only minutes strictly older than the current one are taken, so a bucket
   * still being written to is never half-promoted. Each is summed into its hour
   * and deleted — Redis holds minutes, Postgres holds history.
   *
   * Runs opportunistically rather than from cron because a Hobby plan cannot
   * schedule anything more often than daily, and a daily promotion would lose
   * everything the 2-hour TTL expired in between. The daily cron remains as the
   * safety net for an instance that never warms.
   */
  async promote(now = Date.now()): Promise<{ minutes: number; routes: number }> {
    if (!this.redis) return { minutes: 0, routes: 0 };
    const currentMinute = Math.floor(now / 60_000);
    try {
      if (!(await ensureConnected(this.redis))) return { minutes: 0, routes: 0 };

      // Look back only as far as the TTL could have kept anything.
      const candidates: number[] = [];
      for (let m = currentMinute - 1; m > currentMinute - (BUCKET_TTL_S / 60); m -= 1) {
        candidates.push(m);
      }
      const pipe = this.redis.pipeline();
      candidates.forEach((m) => pipe.hgetall(bucketKey(m)));
      const res = await pipe.exec();

      // hour (ms) -> route -> aggregate
      const byHour = new Map<number, Map<string, Agg>>();
      const drained: number[] = [];
      (res ?? []).forEach((entry, idx) => {
        const hash = entry?.[1] as Record<string, string> | undefined;
        if (!hash || Object.keys(hash).length === 0) return;
        const minute = candidates[idx];
        drained.push(minute);
        const hourMs = Math.floor((minute * 60_000) / 3_600_000) * 3_600_000;
        let routes = byHour.get(hourMs);
        if (!routes) { routes = new Map(); byHour.set(hourMs, routes); }
        for (const [field, raw] of Object.entries(hash)) {
          const sep = field.lastIndexOf('|');
          if (sep < 0) continue;
          const route = field.slice(0, sep);
          let agg = routes.get(route);
          if (!agg) { agg = emptyAgg(); routes.set(route, agg); }
          applyField(agg, field.slice(sep + 1), Number(raw) || 0);
        }
      });

      if (drained.length === 0) return { minutes: 0, routes: 0 };

      const db = getPlatformPrisma();
      let routeCount = 0;
      for (const [hourMs, routes] of byHour) {
        const hour = new Date(hourMs);
        for (const [route, a] of routes) {
          routeCount += 1;
          // Scalars increment; the histograms cannot, so they are merged from
          // the stored row. Several instances promote independently and an hour
          // is only complete once all of them have, which is why nothing here
          // overwrites — every field only ever grows.
          const existing = await db.metricRollup.findUnique({
            where: { hour_route: { hour, route } },
            select: { latency: true, dbHold: true },
          });
          await db.metricRollup.upsert({
            where: { hour_route: { hour, route } },
            create: {
              hour, route,
              count: a.count, errors: a.errors,
              txTimeouts: a.tx, poolTimeouts: a.pool,
              latency: a.latency, dbHold: a.dbHold,
            },
            update: {
              count: { increment: a.count },
              errors: { increment: a.errors },
              txTimeouts: { increment: a.tx },
              poolTimeouts: { increment: a.pool },
              latency: existing ? mergeBuckets(existing.latency, a.latency) : a.latency,
              dbHold: existing ? mergeBuckets(existing.dbHold, a.dbHold) : a.dbHold,
            },
          });
        }
      }

      // Only delete what was actually read and written.
      const del = this.redis.pipeline();
      drained.forEach((m) => del.del(bucketKey(m)));
      await del.exec();

      return { minutes: drained.length, routes: routeCount };
    } catch (e) {
      this.logger.warn(`metrics promote failed: ${(e as Error).message}`);
      return { minutes: 0, routes: 0 };
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Stable label for a request, or null once the cardinality cap is hit. */
  label(method: string, routePath: string | undefined, url: string): string | null {
    return capLabels(this.known, routeLabel(method, routePath, url));
  }

  record(label: string, status: number, latencyMs: number): void {
    this.collector.record(label, status, latencyMs);
  }

  recordDbHold(label: string, holdMs: number): void {
    this.collector.recordDbHold(label, holdMs);
  }

  recordError(label: string, message: string | undefined): void {
    this.collector.recordError(label, message);
  }

  /**
   * Push the current window to Redis as one pipeline.
   *
   * HINCRBY per field means two instances flushing the same minute ADD rather
   * than overwrite — which is the only reason this works on serverless, where
   * there is no single process to hold the totals.
   */
  async flush(): Promise<void> {
    const drained = this.collector.drain();
    if (!drained || !this.redis) return;

    try {
      if (!(await ensureConnected(this.redis))) return;
      const key = bucketKey(drained.minute);
      const pipe = this.redis.pipeline();
      for (const [label, b] of drained.routes) {
        pipe.hincrby(key, `${label}|count`, b.count);
        if (b.errors) pipe.hincrby(key, `${label}|errors`, b.errors);
        if (b.txTimeouts) pipe.hincrby(key, `${label}|tx`, b.txTimeouts);
        if (b.poolTimeouts) pipe.hincrby(key, `${label}|pool`, b.poolTimeouts);
        forEachNonZero(b.latency, (i, n) => pipe.hincrby(key, `${label}|l${i}`, n));
        forEachNonZero(b.dbHold, (i, n) => pipe.hincrby(key, `${label}|d${i}`, n));
      }
      pipe.expire(key, BUCKET_TTL_S);
      await pipe.exec();
    } catch (e) {
      // Losing a minute of metrics is an acceptable outcome; failing a request
      // because of one is not.
      this.logger.warn(`metrics flush failed: ${(e as Error).message}`);
    }
  }
}

/** One route's totals for a span — the shape both promotion and the dashboard build. */
interface Agg {
  count: number; errors: number; tx: number; pool: number;
  latency: number[]; dbHold: number[];
}

function emptyAgg(): Agg {
  const b = () => new Array(BUCKETS_MS.length + 1).fill(0) as number[];
  return { count: 0, errors: 0, tx: 0, pool: 0, latency: b(), dbHold: b() };
}

/** Fold one Redis hash field back into an aggregate. Unknown fields are ignored. */
function applyField(a: Agg, kind: string, n: number): void {
  if (kind === 'count') a.count += n;
  else if (kind === 'errors') a.errors += n;
  else if (kind === 'tx') a.tx += n;
  else if (kind === 'pool') a.pool += n;
  else if (kind.startsWith('l')) bumpAt(a.latency, kind.slice(1), n);
  else if (kind.startsWith('d')) bumpAt(a.dbHold, kind.slice(1), n);
}

function bumpAt(arr: number[], idxRaw: string, n: number): void {
  const i = Number(idxRaw);
  if (Number.isInteger(i) && i >= 0 && i < arr.length) arr[i] += n;
}

function forEachNonZero(arr: number[], fn: (i: number, n: number) => void): void {
  for (let i = 0; i < arr.length; i += 1) if (arr[i]) fn(i, arr[i]);
}

export type { RouteBucket };
