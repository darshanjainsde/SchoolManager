import { evaluateLadder, overallSeverity, LOGIN_CEILING_PER_INSTANCE, type LadderInput } from './ladder';

const base: LadderInput = {
  p95Ms: 50, errorRate: 0, dbHoldP95Ms: 10, loginsPerSec: 1, instances: 1,
  txTimeouts: 0, poolTimeouts: 0, outboxDepth: 0, outboxOldestMinutes: 0,
};
const get = (m: Partial<LadderInput>, key: string) =>
  evaluateLadder({ ...base, ...m }).find((t) => t.key === key)!;

describe('evaluateLadder', () => {
  it('is all-clear on a healthy window', () => {
    expect(overallSeverity(evaluateLadder(base))).toBe('ok');
  });

  it('treats ANY transaction timeout as act — each one was a 500 a user saw', () => {
    expect(get({ txTimeouts: 1 }, 'tx-timeout').severity).toBe('act');
  });

  it('treats any pool timeout as act', () => {
    expect(get({ poolTimeouts: 1 }, 'pool').severity).toBe('act');
  });

  it('escalates p95 through watch to act at the ladder threshold', () => {
    expect(get({ p95Ms: 100 }, 'p95').severity).toBe('ok');
    expect(get({ p95Ms: 300 }, 'p95').severity).toBe('watch');
    expect(get({ p95Ms: 900 }, 'p95').severity).toBe('act');
  });

  it('escalates connection-hold time separately from total latency', () => {
    // a fast response can still hold a connection too long
    expect(get({ p95Ms: 50, dbHoldP95Ms: 400 }, 'db-hold').severity).toBe('act');
  });

  it('scales the login ceiling with instance count', () => {
    const oneBox = get({ loginsPerSec: 30, instances: 1 }, 'login');
    const tenBoxes = get({ loginsPerSec: 30, instances: 10 }, 'login');
    expect(oneBox.severity).toBe('act');   // 30 of ~35
    expect(tenBoxes.severity).toBe('ok');  // 30 of ~350
    expect(tenBoxes.detail).toContain(String(LOGIN_CEILING_PER_INSTANCE * 10));
  });

  it('acts on a deep outbox OR a merely old one', () => {
    expect(get({ outboxDepth: 500 }, 'outbox').severity).toBe('watch');
    expect(get({ outboxDepth: 2000 }, 'outbox').severity).toBe('act');
    // shallow but stale still means the drain is not running
    expect(get({ outboxDepth: 5, outboxOldestMinutes: 60 }, 'outbox').severity).toBe('act');
  });

  it('reports no-traffic as ok rather than inventing a zero', () => {
    expect(get({ p95Ms: null, dbHoldP95Ms: null }, 'p95').severity).toBe('ok');
    expect(get({ p95Ms: null }, 'p95').detail).toContain('No traffic');
  });
});

describe('overallSeverity', () => {
  it('leads with the worst rung present', () => {
    expect(overallSeverity(evaluateLadder({ ...base, p95Ms: 300 }))).toBe('watch');
    expect(overallSeverity(evaluateLadder({ ...base, p95Ms: 300, txTimeouts: 1 }))).toBe('act');
  });
});
