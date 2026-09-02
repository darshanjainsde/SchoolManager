/**
 * Which rung of the scaling ladder are we on?
 *
 * docs/ARCHITECTURE.md §5 already defines the ladder and the trigger metrics
 * that justify each step. The dashboard's job is to answer that question, not
 * to draw CPU gauges — serverless has no CPU to show, and after the Phase 1
 * query work the number that actually predicts failure is connection-hold time,
 * not utilisation.
 *
 * Thresholds come from the v2 spec §8 and from measurement, not taste:
 *   - p95 500ms      the ladder's own trigger
 *   - 300 conns      the point where a Supabase pooler needs re-sizing
 *   - 35 logins/s    MEASURED argon2id ceiling per instance; flat at any
 *                    concurrency, so only horizontal scale moves it
 *   - any tx timeout every occurrence is an HTTP 500 a user saw
 */
export type Severity = 'ok' | 'watch' | 'act';

export interface LadderInput {
  p95Ms: number | null;
  errorRate: number;
  dbHoldP95Ms: number | null;
  loginsPerSec: number;
  instances: number;
  txTimeouts: number;
  poolTimeouts: number;
  outboxDepth: number;
  outboxOldestMinutes: number | null;
}

export interface Trigger {
  key: string;
  label: string;
  severity: Severity;
  detail: string;
}

export const LOGIN_CEILING_PER_INSTANCE = 35;

export function evaluateLadder(m: LadderInput): Trigger[] {
  const t: Trigger[] = [];

  // Every occurrence is a 500 that a user saw. There is no "acceptable rate".
  t.push({
    key: 'tx-timeout',
    label: 'Transaction timeouts',
    severity: m.txTimeouts > 0 ? 'act' : 'ok',
    detail:
      m.txTimeouts > 0
        ? `${m.txTimeouts} in the last hour — each one was an HTTP 500. Investigate now.`
        : 'None. This is the error that took out attendance-status before Phase 1.',
  });

  t.push({
    key: 'pool',
    label: 'Connection pool',
    severity: m.poolTimeouts > 0 ? 'act' : 'ok',
    detail:
      m.poolTimeouts > 0
        ? `${m.poolTimeouts} requests could not get a connection. Raise connection_limit or add capacity.`
        : 'No request waited past maxWait for a connection.',
  });

  t.push({
    key: 'p95',
    label: 'Route latency (p95)',
    severity: m.p95Ms === null ? 'ok' : m.p95Ms > 500 ? 'act' : m.p95Ms > 250 ? 'watch' : 'ok',
    detail:
      m.p95Ms === null
        ? 'No traffic in the window.'
        : `${m.p95Ms} ms. Profile before scaling infrastructure — the last 39x came from a query fix, not a bigger box.`,
  });

  // Hold time x throughput IS the concurrent connection count. It is the
  // variable that breaks, which is why it gets its own rung.
  t.push({
    key: 'db-hold',
    label: 'Connection hold time',
    severity:
      m.dbHoldP95Ms === null ? 'ok' : m.dbHoldP95Ms > 250 ? 'act' : m.dbHoldP95Ms > 100 ? 'watch' : 'ok',
    detail:
      m.dbHoldP95Ms === null
        ? 'No tenant transactions in the window.'
        : `p95 ${m.dbHoldP95Ms} ms held per request. Hold time x throughput = concurrent connections.`,
  });

  const loginCeiling = LOGIN_CEILING_PER_INSTANCE * Math.max(1, m.instances);
  const loginPct = loginCeiling > 0 ? m.loginsPerSec / loginCeiling : 0;
  t.push({
    key: 'login',
    label: 'Login headroom',
    severity: loginPct > 0.7 ? 'act' : loginPct > 0.4 ? 'watch' : 'ok',
    detail: `${m.loginsPerSec.toFixed(1)}/s against a measured ceiling of ~${loginCeiling}/s. argon2id is memory-bandwidth bound — only more instances help.`,
  });

  t.push({
    key: 'outbox',
    label: 'Notification outbox',
    severity:
      m.outboxDepth > 1000 || (m.outboxOldestMinutes ?? 0) > 15
        ? 'act'
        : m.outboxDepth > 200
          ? 'watch'
          : 'ok',
    detail:
      m.outboxDepth === 0
        ? 'Empty — the minutely drain is keeping up.'
        : `${m.outboxDepth} pending, oldest ${m.outboxOldestMinutes ?? 0} min. Sustained depth means the drain needs a persistent worker.`,
  });

  return t;
}

/** The worst severity present — what the page leads with. */
export function overallSeverity(triggers: Trigger[]): Severity {
  if (triggers.some((t) => t.severity === 'act')) return 'act';
  if (triggers.some((t) => t.severity === 'watch')) return 'watch';
  return 'ok';
}
