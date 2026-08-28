/**
 * Fixed-bucket latency histogram.
 *
 * Percentiles need a distribution, but keeping every sample would grow without
 * bound and could not be merged across serverless instances. Fixed buckets can:
 * two instances' counts add, so the platform-wide p95 is just the sum of every
 * instance's buckets. That is the property that makes this work on Vercel at
 * all — nothing can be scraped, so everything must be summable.
 *
 * The trade is precision: a p95 reported as 250 means "between 100 and 250 ms".
 * Bucket edges are chosen so the bands we actually make decisions at — 100ms,
 * 500ms (the ladder's p95 trigger), 5s (Prisma's old transaction timeout) — are
 * edges rather than mid-bucket.
 */
export const BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000] as const;

/** Index of the bucket a duration falls in; BUCKETS_MS.length means "over the top edge". */
export function bucketIndex(ms: number): number {
  for (let i = 0; i < BUCKETS_MS.length; i += 1) {
    if (ms <= BUCKETS_MS[i]) return i;
  }
  return BUCKETS_MS.length;
}

/**
 * Percentile from bucket counts, reported as the bucket's UPPER edge so the
 * number is never optimistic — a real p95 of 90ms reports as 100, never 50.
 * Returns null when there are no samples.
 */
export function percentileFromBuckets(counts: number[], p: number): number | null {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  const target = total * p;
  let seen = 0;
  for (let i = 0; i < counts.length; i += 1) {
    seen += counts[i];
    if (seen >= target) {
      return i < BUCKETS_MS.length ? BUCKETS_MS[i] : Number.POSITIVE_INFINITY;
    }
  }
  return Number.POSITIVE_INFINITY;
}

/** Merge b into a in place. Instances' histograms are summable — that is the point. */
export function mergeBuckets(a: number[], b: number[]): number[] {
  const out = a.slice();
  for (let i = 0; i < b.length; i += 1) out[i] = (out[i] ?? 0) + (b[i] ?? 0);
  return out;
}
