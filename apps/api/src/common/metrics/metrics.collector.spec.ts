import { MetricsCollector, classifyError } from './metrics.collector';
import { bucketIndex } from './histogram';

describe('classifyError', () => {
  it('recognises the transaction timeout that surfaces as a 500', () => {
    expect(classifyError('Transaction already closed: A query cannot be executed'))
      .toBe('tx-timeout');
    expect(classifyError('however 5023 ms passed since the start of the expired transaction'))
      .toBe('tx-timeout');
  });

  it('recognises pool exhaustion', () => {
    expect(classifyError('Unable to start a transaction in the given time.')).toBe('pool-timeout');
    expect(classifyError('Timed out fetching a new connection from the pool')).toBe('pool-timeout');
  });

  it('ignores anything else rather than mislabelling it', () => {
    expect(classifyError('Some other failure')).toBeNull();
    expect(classifyError(undefined)).toBeNull();
  });
});

describe('MetricsCollector', () => {
  const T = 1_700_000_000_000;

  it('counts requests and flags only 5xx as errors', () => {
    const c = new MetricsCollector();
    c.record('GET /a', 200, 10, T);
    c.record('GET /a', 404, 10, T); // a client error is not an outage
    c.record('GET /a', 500, 10, T);
    const b = c.drain()!.routes.get('GET /a')!;
    expect(b.count).toBe(3);
    expect(b.errors).toBe(1);
  });

  it('keeps latency and db-hold as separate distributions', () => {
    const c = new MetricsCollector();
    c.record('GET /a', 200, 500, T);
    c.recordDbHold('GET /a', 5, T);
    const b = c.drain()!.routes.get('GET /a')!;
    expect(b.latency[bucketIndex(500)]).toBe(1);
    expect(b.dbHold[bucketIndex(5)]).toBe(1);
    expect(b.dbHold[bucketIndex(500)]).toBe(0);
  });

  it('counts transaction and pool timeouts separately', () => {
    const c = new MetricsCollector();
    c.recordError('GET /a', 'Transaction already closed', T);
    c.recordError('GET /a', 'Unable to start a transaction in the given time.', T);
    c.recordError('GET /a', 'unrelated', T);
    const b = c.drain()!.routes.get('GET /a')!;
    expect(b.txTimeouts).toBe(1);
    expect(b.poolTimeouts).toBe(1);
  });

  it('starts a fresh window when the minute rolls, never mixing minutes', () => {
    const c = new MetricsCollector();
    c.record('GET /a', 200, 10, T);
    c.record('GET /a', 200, 10, T + 60_000);
    const d = c.drain()!;
    expect(d.minute).toBe(MetricsCollector.minuteOf(T + 60_000));
    expect(d.routes.get('GET /a')!.count).toBe(1);
  });

  it('drains to null when idle, so the flusher can skip the round trip', () => {
    const c = new MetricsCollector();
    expect(c.drain()).toBeNull();
    c.record('GET /a', 200, 1, T);
    expect(c.drain()).not.toBeNull();
    expect(c.drain()).toBeNull();
  });
});
