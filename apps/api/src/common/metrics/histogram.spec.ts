import { BUCKETS_MS, bucketIndex, percentileFromBuckets, mergeBuckets } from './histogram';

describe('bucketIndex', () => {
  it('puts a duration in the first bucket whose edge it does not exceed', () => {
    expect(bucketIndex(1)).toBe(0);      // <= 5
    expect(bucketIndex(5)).toBe(0);      // edge is inclusive
    expect(bucketIndex(6)).toBe(1);      // <= 10
    expect(bucketIndex(100)).toBe(4);    // <= 100
  });

  it('puts anything over the top edge in the overflow bucket', () => {
    expect(bucketIndex(10_001)).toBe(BUCKETS_MS.length);
    expect(bucketIndex(Number.MAX_SAFE_INTEGER)).toBe(BUCKETS_MS.length);
  });
});

describe('percentileFromBuckets', () => {
  const empty = () => new Array(BUCKETS_MS.length + 1).fill(0);

  it('returns null with no samples rather than a misleading zero', () => {
    expect(percentileFromBuckets(empty(), 0.95)).toBeNull();
  });

  it('reports the bucket upper edge, so the number is never optimistic', () => {
    const c = empty();
    c[bucketIndex(90)] = 100; // every sample is 90ms, which lives in the <=100 bucket
    expect(percentileFromBuckets(c, 0.95)).toBe(100);
  });

  it('finds the bucket the percentile actually falls in', () => {
    const c = empty();
    c[bucketIndex(10)] = 95;   // 95 fast samples
    c[bucketIndex(2000)] = 5;  // 5 slow ones
    expect(percentileFromBuckets(c, 0.5)).toBe(10);
    // p95 sits exactly at the boundary; the slow tail must not be hidden
    expect(percentileFromBuckets(c, 0.99)).toBe(2500);
  });

  it('reports Infinity when the percentile lands in the overflow bucket', () => {
    const c = empty();
    c[BUCKETS_MS.length] = 10;
    expect(percentileFromBuckets(c, 0.95)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('mergeBuckets', () => {
  it('sums two instances\' histograms — the property that makes serverless work', () => {
    expect(mergeBuckets([1, 2, 3], [10, 20, 30])).toEqual([11, 22, 33]);
  });

  it('tolerates ragged lengths rather than dropping counts', () => {
    expect(mergeBuckets([1, 2], [10, 20, 30])).toEqual([11, 22, 30]);
  });
});
