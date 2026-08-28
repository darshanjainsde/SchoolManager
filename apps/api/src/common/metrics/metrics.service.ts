import { Inject, Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { REDIS_CLIENT, ensureConnected, sharedRedis, type SharedRedis } from '../redis/redis.client';
import { MetricsCollector, type RouteBucket } from './metrics.collector';
import { capLabels, routeLabel } from './route-label';

/** How often the in-memory window is pushed to Redis. */
const FLUSH_MS = 15_000;

/** Minute buckets live long enough for the rollup cron to miss a run or two. */
const BUCKET_TTL_S = 2 * 60 * 60;

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

  constructor(@Optional() @Inject(REDIS_CLIENT) private readonly redis: SharedRedis = sharedRedis()) {
    // unref so a pending flush can never hold the process open — on Vercel the
    // instance freezes between invocations and an active timer would fight that.
    this.timer = setInterval(() => void this.flush(), FLUSH_MS);
    this.timer.unref?.();
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

function forEachNonZero(arr: number[], fn: (i: number, n: number) => void): void {
  for (let i = 0; i < arr.length; i += 1) if (arr[i]) fn(i, arr[i]);
}

export type { RouteBucket };
