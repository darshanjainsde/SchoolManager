import { BUCKETS_MS, bucketIndex } from './histogram';

/**
 * What a minute of traffic looks like for one route on one instance.
 *
 * `latency` and `dbHold` are separate on purpose. Total request time tells you
 * a page is slow; connection-hold time tells you WHY it will take the platform
 * down — hold time is what multiplies into pool exhaustion (Little's Law:
 * concurrent connections = throughput x hold). They diverge exactly when it
 * matters, so one cannot stand in for the other.
 */
export interface RouteBucket {
  count: number;
  errors: number;
  latency: number[];
  dbHold: number[];
  /** `Transaction already closed` — Prisma's transaction timeout. Always a 500. */
  txTimeouts: number;
  /** Pool acquisition timed out (maxWait). The shape of "we ran out of connections". */
  poolTimeouts: number;
}

const emptyBuckets = (): number[] => new Array(BUCKETS_MS.length + 1).fill(0);

export const emptyRouteBucket = (): RouteBucket => ({
  count: 0,
  errors: 0,
  latency: emptyBuckets(),
  dbHold: emptyBuckets(),
  txTimeouts: 0,
  poolTimeouts: 0,
});

/** Classify an error message into the failure modes worth counting separately. */
export function classifyError(message: string | undefined): 'tx-timeout' | 'pool-timeout' | null {
  if (!message) return null;
  // Matched loosely so a Prisma version that rephrases these degrades to
  // "uncounted", never to a crash.
  if (/transaction already closed|expired transaction/i.test(message)) return 'tx-timeout';
  if (/unable to start a transaction|timed out fetching a new connection/i.test(message)) {
    return 'pool-timeout';
  }
  return null;
}

/**
 * Per-instance, in-memory accumulator.
 *
 * Deliberately NOT written to Redis per request: Upstash bills per command, and
 * at a few hundred req/s that is a real line item for data whose whole purpose
 * is to be cheap. The flusher drains this on a timer instead, so the cost is
 * per-flush rather than per-request.
 */
export class MetricsCollector {
  private minute = -1;
  private routes = new Map<string, RouteBucket>();

  /** Epoch minute the current window belongs to. */
  static minuteOf(now: number): number {
    return Math.floor(now / 60_000);
  }

  private bucketFor(route: string, now: number): RouteBucket {
    const m = MetricsCollector.minuteOf(now);
    if (m !== this.minute) {
      // A new minute starts a new window. Anything not yet flushed is dropped
      // rather than merged into the wrong minute — a metric attributed to the
      // wrong window is worse than a missing one.
      this.minute = m;
      this.routes = new Map();
    }
    let b = this.routes.get(route);
    if (!b) {
      b = emptyRouteBucket();
      this.routes.set(route, b);
    }
    return b;
  }

  record(route: string, statusCode: number, latencyMs: number, now = Date.now()): void {
    const b = this.bucketFor(route, now);
    b.count += 1;
    if (statusCode >= 500) b.errors += 1;
    b.latency[bucketIndex(latencyMs)] += 1;
  }

  /** Time a tenant transaction held a pooled connection. */
  recordDbHold(route: string, holdMs: number, now = Date.now()): void {
    this.bucketFor(route, now).dbHold[bucketIndex(holdMs)] += 1;
  }

  recordError(route: string, message: string | undefined, now = Date.now()): void {
    const kind = classifyError(message);
    if (!kind) return;
    const b = this.bucketFor(route, now);
    if (kind === 'tx-timeout') b.txTimeouts += 1;
    else b.poolTimeouts += 1;
  }

  /** Hand over everything accumulated and reset. Returns null when idle. */
  drain(): { minute: number; routes: Map<string, RouteBucket> } | null {
    if (this.routes.size === 0) return null;
    const out = { minute: this.minute, routes: this.routes };
    this.routes = new Map();
    return out;
  }
}
