'use client';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/lib/use-api';
import { OWNER_HOST } from '@/lib/hosts';
import '../../sk-theme.css';

type Severity = 'ok' | 'watch' | 'act';

interface Trigger {
  key: string;
  label: string;
  severity: Severity;
  detail: string;
}

interface RouteRow {
  route: string;
  count: number;
  errors: number;
  errorRate: number;
  p95Ms: number | null;
  dbHoldP95Ms: number | null;
}

interface HistoryPoint {
  hour: string;
  requests: number;
  errors: number;
  p95Ms: number | null;
  dbHoldP95Ms: number | null;
  txTimeouts: number;
}

interface OpsResponse {
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
  history: HistoryPoint[];
}

const TONE: Record<Severity, { color: string; word: string }> = {
  ok: { color: 'var(--sk-good)', word: 'Healthy' },
  watch: { color: 'var(--sk-amber)', word: 'Watch' },
  act: { color: 'var(--sk-bad)', word: 'Act now' },
};

/** A latency read from fixed buckets is an upper bound, so show it as one. */
const ms = (v: number | null) => (v === null ? '—' : v >= Number.MAX_SAFE_INTEGER ? '>10s' : `≤${v} ms`);

export default function OpsPage() {
  const api = useApi({ audience: 'platform', hostHeader: OWNER_HOST });
  const { data, isLoading, error } = useQuery({
    queryKey: ['owner-ops'],
    queryFn: () => api.get<OpsResponse>('/owner/ops'),
    refetchInterval: 30_000,
  });

  if (isLoading) return <main className="sk-main"><p className="sk-muted">Reading the last hour…</p></main>;
  if (error || !data) {
    return (
      <main className="sk-main">
        <p className="sk-muted">Could not load ops metrics.</p>
      </main>
    );
  }

  const tone = TONE[data.severity];

  return (
    <main className="sk-main">
      <div className="sk-pagehead">
        <div>
          <p className="sk-eyebrow">Platform · runtime health</p>
          <h1>Which rung are we on?</h1>
          <p className="sk-muted">
            Last {data.windowMinutes} minutes. Thresholds come from the scaling ladder in
            ARCHITECTURE.md §5, not from taste.
          </p>
        </div>
        <span className="sk-pill" style={{ background: tone.color, color: '#fff', fontWeight: 700 }}>
          {tone.word}
        </span>
      </div>

      {!data.metricsAvailable && (
        <div className="sk-notice">
          Redis is unreachable, so request metrics are missing. Outbox figures below still come
          straight from Postgres.
        </div>
      )}

      <div className="sk-kpis">
        <Kpi label="Requests" value={data.totals.requests.toLocaleString()} />
        <Kpi
          label="Error rate"
          value={`${(data.totals.errorRate * 100).toFixed(2)}%`}
          tone={data.totals.errorRate > 0.01 ? 'var(--sk-bad)' : undefined}
        />
        <Kpi label="p95 latency" value={ms(data.totals.p95Ms)} />
        <Kpi
          label="Connection hold p95"
          value={ms(data.totals.dbHoldP95Ms)}
          hint="hold × throughput = concurrent connections"
        />
        <Kpi
          label="Transaction timeouts"
          value={String(data.totals.txTimeouts)}
          tone={data.totals.txTimeouts > 0 ? 'var(--sk-bad)' : undefined}
          hint="every one was an HTTP 500"
        />
        <Kpi label="Logins/s" value={data.totals.loginsPerSec.toFixed(2)} hint="ceiling ~35/s per instance" />
      </div>

      <section className="sk-card" style={{ marginTop: 18 }}>
        <div className="sk-card-h"><h3>Ladder triggers</h3></div>
        <div className="sk-card-b" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {data.triggers.map((t) => (
            <div
              key={t.key}
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr',
                gap: 12,
                alignItems: 'start',
                borderLeft: `3px solid ${TONE[t.severity].color}`,
                paddingLeft: 12,
              }}
            >
              <span
                className="sk-pill"
                style={{ background: TONE[t.severity].color, color: '#fff', fontSize: 11, fontWeight: 700 }}
              >
                {TONE[t.severity].word}
              </span>
              <div>
                <strong>{t.label}</strong>
                <div className="sk-muted" style={{ fontSize: 13 }}>{t.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="sk-card" style={{ marginTop: 18 }}>
        <div className="sk-card-h">
          <h3>Outbox</h3>
        </div>
        <div className="sk-card-b" style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <Stat label="Pending" value={data.outbox.pending.toLocaleString()} />
          <Stat
            label="Oldest"
            value={data.outbox.oldestMinutes === null ? '—' : `${data.outbox.oldestMinutes} min`}
          />
          <Stat
            label="Attempts exhausted"
            value={data.outbox.exhausted.toLocaleString()}
            tone={data.outbox.exhausted > 0 ? 'var(--sk-bad)' : undefined}
            hint="dead-letter: nothing will retry these"
          />
        </div>
      </section>

      <section className="sk-card" style={{ marginTop: 18 }}>
        <div className="sk-card-h">
          <h3>Last 7 days</h3>
        </div>
        <div className="sk-card-b">
          {(data.history?.length ?? 0) === 0 ? (
            <p className="sk-muted" style={{ fontSize: 13 }}>
              No history yet — it starts filling once metrics have been promoted out of the live
              buffer, within a few minutes of the first traffic.
            </p>
          ) : (
            <Trend points={data.history} />
          )}
        </div>
      </section>

      <section className="sk-card" style={{ marginTop: 18 }}>
        <div className="sk-card-h"><h3>Busiest routes</h3></div>
        <div className="sk-card-b" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr className="sk-muted" style={{ textAlign: 'left' }}>
                <th style={{ padding: '6px 8px' }}>Route</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>Requests</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>Errors</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>p95</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>DB hold p95</th>
              </tr>
            </thead>
            <tbody>
              {data.routes.length === 0 && (
                <tr><td colSpan={5} className="sk-muted" style={{ padding: 12 }}>No traffic in the window.</td></tr>
              )}
              {data.routes.map((r) => (
                <tr key={r.route} style={{ borderTop: '1px solid var(--sk-line)' }}>
                  <td style={{ padding: '6px 8px', fontFamily: 'var(--sk-mono)' }}>{r.route}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{r.count.toLocaleString()}</td>
                  <td
                    style={{
                      padding: '6px 8px',
                      textAlign: 'right',
                      color: r.errors > 0 ? 'var(--sk-bad)' : undefined,
                    }}
                  >
                    {r.errors}
                  </td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{ms(r.p95Ms)}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>{ms(r.dbHoldP95Ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function Kpi({ label, value, tone, hint }: { label: string; value: string; tone?: string; hint?: string }) {
  return (
    <div className="sk-kpi">
      <span className="sk-lab">{label}</span>
      <strong style={{ color: tone }}>{value}</strong>
      {hint && <span className="sk-muted" style={{ fontSize: 11 }}>{hint}</span>}
    </div>
  );
}

function Stat({ label, value, tone, hint }: { label: string; value: string; tone?: string; hint?: string }) {
  return (
    <div>
      <div className="sk-lab">{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em', color: tone }}>{value}</div>
      {hint && <div className="sk-muted" style={{ fontSize: 11 }}>{hint}</div>}
    </div>
  );
}

/**
 * Requests per hour with the error hours called out.
 *
 * A sparkline rather than a full chart: the question this answers is "is the
 * shape changing", not "what exactly happened at 14:00" — the live table above
 * already has the detail. Hours with a 5xx are drawn in the bad hue so a bad
 * patch is visible without reading any number.
 */
function Trend({ points }: { points: HistoryPoint[] }) {
  const max = Math.max(1, ...points.map((p) => p.requests));
  const W = 720;
  const H = 90;
  const step = points.length > 1 ? W / (points.length - 1) : W;

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H + 22}`} width={W} role="img"
        aria-label={`Requests per hour over the last ${points.length} hours`}>
        <line x1="0" y1={H} x2={W} y2={H} stroke="var(--sk-line)" strokeWidth="1" />
        <polyline
          fill="none"
          stroke="var(--sk-brand)"
          strokeWidth="2"
          strokeLinejoin="round"
          points={points
            .map((p, i) => `${i * step},${H - (p.requests / max) * (H - 8)}`)
            .join(' ')}
        />
        {points.map((p, i) =>
          p.errors > 0 || p.txTimeouts > 0 ? (
            <circle
              key={p.hour}
              cx={i * step}
              cy={H - (p.requests / max) * (H - 8)}
              r="3.5"
              fill="var(--sk-bad)"
            />
          ) : null,
        )}
        <text x="0" y={H + 16} fontSize="11" fill="var(--sk-ink-3)">
          {new Date(points[0].hour).toLocaleDateString()}
        </text>
        <text x={W} y={H + 16} fontSize="11" fill="var(--sk-ink-3)" textAnchor="end">
          peak {max.toLocaleString()}/hr
        </text>
      </svg>
    </div>
  );
}
