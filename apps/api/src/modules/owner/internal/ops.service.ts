import { Inject, Injectable, Optional } from '@nestjs/common';
import { getPlatformPrisma } from '@skoolos/db';
import { REDIS_CLIENT, ensureConnected, sharedRedis, type SharedRedis } from '../../../common/redis/redis.client';
import { BUCKETS_MS, mergeBuckets, percentileFromBuckets } from '../../../common/metrics/histogram';
import { bucketKey } from '../../../common/metrics/metrics.service';
import { evaluateLadder, overallSeverity, type Severity, type Trigger } from '../../../common/metrics/ladder';

/** How many minute buckets the dashboard summarises. */
const WINDOW_MINUTES = 60;

export interface RouteRow {
  route: string;
  count: number;
  errors: number;
  errorRate: number;
  p95Ms: number | null;
  dbHoldP95Ms: number | null;
}

export interface HistoryPoint {
  hour: string;
  requests: number;
  errors: number;
  p95Ms: number | null;
  dbHoldP95Ms: number | null;
  txTimeouts: number;
}

export interface OpsResponse {
  windowMinutes: number;
  severity: Severity;
  triggers: Trigger[];
  totals: {
    requests: number;
    errors: number;
    errorRate: number;
    p95Ms: number | null;
    dbHoldP95Ms: number | null;
    txTimeouts: number;
    poolTimeouts: number;
    loginsPerSec: number;
  };
  routes: RouteRow[];
  outbox: { pending: number; oldestMinutes: number | null; exhausted: number };
  metricsAvailable: boolean;
  /** Hourly history, oldest first. Empty until the first promotion has run. */
  history: HistoryPoint[];
}

interface Agg {
  count: number;
  errors: number;
  latency: number[];
  dbHold: number[];
  tx: number;
  pool: number;
}

const emptyAgg = (): Agg => ({
  count: 0, errors: 0,
  latency: new Array(BUCKETS_MS.length + 1).fill(0),
  dbHold: new Array(BUCKETS_MS.length + 1).fill(0),
  tx: 0, pool: 0,
});

/**
 * Reads the last hour of minute buckets and answers "which rung are we on".
 *
 * Redis holds the live minutes; every instance HINCRBYs into the same key, so
 * summing the buckets here gives a platform-wide view without any instance
 * having to be reachable. Outbox depth comes straight from Postgres — it is a
 * `SELECT count(*)`, which is exactly why an outbox beat a broker for this.
 */
@Injectable()
export class OpsService {
  constructor(@Optional() @Inject(REDIS_CLIENT) private readonly redis: SharedRedis = sharedRedis()) {}

  async snapshot(): Promise<OpsResponse> {
    const [metrics, outbox, history] = await Promise.all([
      this.readMetrics(),
      this.readOutbox(),
      this.readHistory(),
    ]);

    const totalsAgg = metrics.total;
    const requests = totalsAgg.count;
    const p95 = percentileFromBuckets(totalsAgg.latency, 0.95);
    const dbHoldP95 = percentileFromBuckets(totalsAgg.dbHold, 0.95);
    const loginsPerSec = metrics.logins / (WINDOW_MINUTES * 60);

    const triggers = evaluateLadder({
      p95Ms: finite(p95),
      errorRate: requests ? totalsAgg.errors / requests : 0,
      dbHoldP95Ms: finite(dbHoldP95),
      loginsPerSec,
      instances: 1, // no way to count warm instances from inside one; see note in the skill
      txTimeouts: totalsAgg.tx,
      poolTimeouts: totalsAgg.pool,
      outboxDepth: outbox.pending,
      outboxOldestMinutes: outbox.oldestMinutes,
    });

    return {
      windowMinutes: WINDOW_MINUTES,
      severity: overallSeverity(triggers),
      triggers,
      totals: {
        requests,
        errors: totalsAgg.errors,
        errorRate: requests ? totalsAgg.errors / requests : 0,
        p95Ms: finite(p95),
        dbHoldP95Ms: finite(dbHoldP95),
        txTimeouts: totalsAgg.tx,
        poolTimeouts: totalsAgg.pool,
        loginsPerSec,
      },
      routes: metrics.routes,
      outbox,
      metricsAvailable: metrics.available,
      history,
    };
  }

  private async readMetrics(): Promise<{
    total: Agg; routes: RouteRow[]; logins: number; available: boolean;
  }> {
    const total = emptyAgg();
    const byRoute = new Map<string, Agg>();
    let logins = 0;
    let available = false;

    try {
      if (this.redis && (await ensureConnected(this.redis))) {
        const nowMinute = Math.floor(Date.now() / 60_000);
        const keys = Array.from({ length: WINDOW_MINUTES }, (_, i) => bucketKey(nowMinute - i));
        const pipe = this.redis.pipeline();
        keys.forEach((k) => pipe.hgetall(k));
        const res = await pipe.exec();
        available = true;

        for (const entry of res ?? []) {
          const hash = entry?.[1] as Record<string, string> | undefined;
          if (!hash) continue;
          for (const [field, raw] of Object.entries(hash)) {
            const sep = field.lastIndexOf('|');
            if (sep < 0) continue;
            const route = field.slice(0, sep);
            const kind = field.slice(sep + 1);
            const n = Number(raw) || 0;
            let agg = byRoute.get(route);
            if (!agg) { agg = emptyAgg(); byRoute.set(route, agg); }
            applyField(agg, kind, n);
            applyField(total, kind, n);
            if (kind === 'count' && route.includes('/auth/login')) logins += n;
          }
        }
      }
    } catch {
      // A dashboard that cannot read Redis renders empty rather than 500ing.
      // `available` stays false so the page can say so honestly.
    }

    const routes = [...byRoute.entries()]
      .map(([route, a]) => ({
        route,
        count: a.count,
        errors: a.errors,
        errorRate: a.count ? a.errors / a.count : 0,
        p95Ms: finite(percentileFromBuckets(a.latency, 0.95)),
        dbHoldP95Ms: finite(percentileFromBuckets(a.dbHold, 0.95)),
      }))
      .sort((x, y) => y.count - x.count)
      .slice(0, 25);

    return { total, routes, logins, available };
  }

  /**
   * Hourly history from Postgres.
   *
   * Redis holds only the live minutes, so "is this worse than last week" can
   * only be answered here. Seven days covers the weekly rhythm a school runs on
   * while keeping the query small.
   */
  private async readHistory(): Promise<HistoryPoint[]> {
    try {
      const since = new Date(Date.now() - 7 * 24 * 3_600_000);
      const rows = await getPlatformPrisma().metricRollup.findMany({
        where: { hour: { gte: since } },
        orderBy: { hour: 'asc' },
      });
      // Collapse routes into one point per hour: the trend line is about the
      // platform, and per-route detail already sits in the live table above.
      const byHour = new Map<number, Agg>();
      for (const r of rows) {
        const key = r.hour.getTime();
        let a = byHour.get(key);
        if (!a) { a = emptyAgg(); byHour.set(key, a); }
        a.count += r.count; a.errors += r.errors;
        a.tx += r.txTimeouts; a.pool += r.poolTimeouts;
        a.latency = mergeBuckets(a.latency, r.latency);
        a.dbHold = mergeBuckets(a.dbHold, r.dbHold);
      }
      return [...byHour.entries()].map(([hourMs, a]) => ({
        hour: new Date(hourMs).toISOString(),
        requests: a.count,
        errors: a.errors,
        p95Ms: finite(percentileFromBuckets(a.latency, 0.95)),
        dbHoldP95Ms: finite(percentileFromBuckets(a.dbHold, 0.95)),
        txTimeouts: a.tx,
      }));
    } catch {
      // History is a nice-to-have; the live view must render without it.
      return [];
    }
  }

  private async readOutbox(): Promise<{ pending: number; oldestMinutes: number | null; exhausted: number }> {
    const db = getPlatformPrisma();
    const [pending, oldest, exhausted] = await Promise.all([
      db.notificationOutbox.count({ where: { sentAt: null, attempts: { lt: 5 } } }),
      db.notificationOutbox.findFirst({
        where: { sentAt: null, attempts: { lt: 5 } },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      // attempts at the cap is the dead-letter queue: nothing will retry these.
      db.notificationOutbox.count({ where: { sentAt: null, attempts: { gte: 5 } } }),
    ]);
    return {
      pending,
      oldestMinutes: oldest ? Math.floor((Date.now() - oldest.createdAt.getTime()) / 60_000) : null,
      exhausted,
    };
  }
}

function applyField(a: Agg, kind: string, n: number): void {
  if (kind === 'count') a.count += n;
  else if (kind === 'errors') a.errors += n;
  else if (kind === 'tx') a.tx += n;
  else if (kind === 'pool') a.pool += n;
  else if (kind.startsWith('l')) bump(a.latency, kind.slice(1), n);
  else if (kind.startsWith('d')) bump(a.dbHold, kind.slice(1), n);
}

function bump(arr: number[], idxRaw: string, n: number): void {
  const i = Number(idxRaw);
  if (Number.isInteger(i) && i >= 0 && i < arr.length) arr[i] += n;
}

const finite = (v: number | null): number | null =>
  v === null || !Number.isFinite(v) ? (v === null ? null : Number.MAX_SAFE_INTEGER) : v;

export { mergeBuckets };
