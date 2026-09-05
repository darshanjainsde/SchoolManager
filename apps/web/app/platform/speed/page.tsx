'use client';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { OWNER_HOST } from '@/lib/hosts';
import { useAuthStore } from '@/lib/auth-store';

/**
 * Site speed, measured rather than assumed.
 *
 * Every public school page used to be served `private, no-store` and rebuilt
 * from eleven database queries on each view. That was true for months and
 * nothing in this console would have shown it — which is exactly why the page
 * exists. It fetches each LIVE school's homepage over the real network and
 * reports what a parent would get.
 */

interface SpeedRow {
  schoolId: string;
  name: string;
  host: string;
  ttfbMs: number | null;
  bytes: number | null;
  status: number | null;
  edgeCache: string | null;
  cacheable: boolean;
  error: string | null;
}
interface SpeedReport {
  measuredAt: string;
  vantage: string;
  rows: SpeedRow[];
}

/** Under this, a page feels instant; over it, a visitor notices the wait. */
const GOOD_TTFB = 200;

/** A cache header is the difference between "served" and "rebuilt". */
function cacheTone(r: SpeedRow): { label: string; tone: 'good' | 'warn' | 'bad' } {
  if (r.error) return { label: 'unreachable', tone: 'bad' };
  if (!r.cacheable) return { label: 'not cacheable', tone: 'bad' };
  const c = (r.edgeCache ?? '').toUpperCase();
  // STALE is a hit: the edge answered instantly and refreshed behind the visitor.
  if (c === 'HIT' || c === 'STALE') return { label: 'from the edge', tone: 'good' };
  return { label: 'rebuilt', tone: 'warn' };
}

function kb(n: number | null): string {
  return n === null ? '—' : `${Math.round(n / 1024)} KB`;
}

export default function SpeedPage() {
  const signedIn = useAuthStore((s) => s.status) === 'authed';
  const api = useApi({ audience: 'platform', hostHeader: OWNER_HOST });
  const [force, setForce] = useState(0);

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['owner-speed', force],
    queryFn: () => api.get<SpeedReport>(`/owner/speed${force ? '?force=1' : ''}`),
    enabled: signedIn,
  });

  const rows = data?.rows ?? [];
  const served = rows.filter((r) => cacheTone(r).tone === 'good').length;
  const fast = rows.filter((r) => r.ttfbMs !== null && r.ttfbMs <= GOOD_TTFB).length;

  return (
    <>
      <header className="sk-own-head">
        <div>
          <h1>Site speed</h1>
          <p>
            Every published school&rsquo;s homepage, fetched over the real network just now.
            {data && <> Measured from <b>{data.vantage}</b>.</>}
          </p>
        </div>
        <button
          className="sk-own-btn"
          data-kind="primary"
          onClick={() => {
            setForce((n) => n + 1);
            void refetch();
          }}
          disabled={isFetching}
        >
          <RefreshCw size={14} aria-hidden="true" /> {isFetching ? 'Measuring…' : 'Measure again'}
        </button>
      </header>

      {isLoading && <p className="sk-own-state">Measuring every school&hellip;</p>}
      {error && (
        <p className="sk-own-state" data-tone="err">
          <b>Could not measure.</b>
          {(error as Error).message}
        </p>
      )}
      {!isLoading && !error && rows.length === 0 && (
        <p className="sk-own-state">
          <b>No published schools yet.</b>
          A school appears here once it goes LIVE.
        </p>
      )}

      {rows.length > 0 && (
        <>
          <div className="sk-kpis" style={{ marginBottom: 18 }}>
            <div className="sk-kpi" data-tone={served === rows.length ? 'good' : served ? 'warn' : 'bad'}>
              <span className="lab">Served from the edge</span>
              <span className="n">{served}<span className="u"> / {rows.length}</span></span>
              <span className="hint">The rest are rebuilt from the database on every visit</span>
            </div>
            <div className="sk-kpi" data-tone={fast === rows.length ? 'good' : fast ? 'warn' : 'bad'}>
              <span className="lab">Under {GOOD_TTFB} ms</span>
              <span className="n">{fast}<span className="u"> / {rows.length}</span></span>
              <span className="hint">Time to first byte, measured just now</span>
            </div>
          </div>

          <div className="sk-tblwrap">
            <table className="sk-tbl">
              <thead>
                <tr>
                  <th>School</th>
                  <th data-priority="2">Address</th>
                  <th className="n">TTFB</th>
                  <th className="n" data-priority="2">Page</th>
                  <th>Cache</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const c = cacheTone(r);
                  return (
                    <tr key={r.schoolId}>
                      <td><b>{r.name}</b></td>
                      <td data-priority="2" data-truncate="true" className="sk-muted" title={r.host}>
                        {r.host}
                      </td>
                      <td className="n">
                        {r.ttfbMs === null ? '—' : (
                          <span style={{ color: r.ttfbMs <= GOOD_TTFB ? 'var(--sk-good)' : 'var(--sk-amber)' }}>
                            {r.ttfbMs} ms
                          </span>
                        )}
                      </td>
                      <td className="n sk-muted" data-priority="2">{kb(r.bytes)}</td>
                      <td>
                        <span className="sk-pill" data-tone={c.tone}>{c.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="sk-muted" style={{ fontSize: 12.5, marginTop: 14, maxWidth: '72ch' }}>
            Measured server-side from our own region, so these are close to a best case — a parent
            on 4G pays the same server time plus far more transfer time, which is why the page size
            matters as much as the milliseconds. <b>Rebuilt</b> means the edge had no copy and the
            page was assembled from the database for that visit.
          </p>
        </>
      )}
    </>
  );
}
