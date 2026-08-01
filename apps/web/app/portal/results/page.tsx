'use client';
import { useQuery } from '@tanstack/react-query';
import { GraduationCap, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { PublishedResult } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

/** marks/maxMarks as a 0-100 percentage, guarding a zero/absent denominator. */
function pct(marks: number, maxMarks: number): number {
  if (!maxMarks) return 0;
  return Math.round((marks / maxMarks) * 100);
}

// ── Trend chart ───────────────────────────────────────────────────────────────

const CHART_W = 320;
const CHART_H = 90;
const PAD_X = 6;
const PAD_Y = 8;

/**
 * A hand-rolled sparkline of the student's marks-percentage over time — no
 * chart library. Chronological (oldest → newest), so the line reads left to
 * right the way a report card does.
 *
 * Purely decorative pixels, so the `<svg>` carries the whole story in its
 * `aria-label` and the points are also listed in the table below it.
 */
function MarksTrend({ points }: { points: { label: string; percent: number }[] }) {
  if (points.length < 2) return null;

  const step = (CHART_W - PAD_X * 2) / (points.length - 1);
  const y = (percent: number) =>
    PAD_Y + (1 - percent / 100) * (CHART_H - PAD_Y * 2);

  const coords = points.map((p, i) => ({ x: PAD_X + i * step, y: y(p.percent), ...p }));
  const polyline = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');

  const first = points[0].percent;
  const last = points[points.length - 1].percent;
  const direction = last > first ? 'up' : last < first ? 'down' : 'flat';

  return (
    <svg
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      className="h-24 w-full"
      role="img"
      aria-label={`Marks percentage over ${points.length} tests, oldest to newest: ${points
        .map((p) => `${p.label} ${p.percent}%`)
        .join(', ')}. Overall trend is ${direction}.`}
    >
      {/* 0 / 50 / 100% guides */}
      {[0, 50, 100].map((g) => (
        <line
          key={g}
          x1={PAD_X}
          x2={CHART_W - PAD_X}
          y1={y(g)}
          y2={y(g)}
          stroke="currentColor"
          strokeWidth={1}
          style={{ color: 'var(--sk-line)' }}
        />
      ))}
      <polyline
        points={polyline}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ color: 'var(--sk-brand)' }}
      />
      {coords.map((c) => (
        <circle key={c.label + c.x} cx={c.x} cy={c.y} r={3} style={{ fill: 'var(--sk-brand)' }} />
      ))}
    </svg>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PortalResultsPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });

  const { data, isLoading, error } = useQuery({
    queryKey: ['portal-results'],
    queryFn: () => api.get<PublishedResult[]>('/me/results'),
    enabled: !!host,
    staleTime: 60_000,
  });

  // The API returns newest-first; the chart wants oldest-first.
  const results = data ?? [];
  const trendPoints = [...results]
    .reverse()
    .map((r) => ({ label: r.subjectName, percent: pct(r.marks, r.maxMarks) }));

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--sk-ink)' }}>Results</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--sk-ink-3)' }}>
          Your published test results, with how the class did overall.
        </p>
      </header>

      {isLoading && <p className="sk-state">Loading results…</p>}
      {error && <p className="sk-state err">{(error as Error).message}</p>}

      {!isLoading && !error && results.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <GraduationCap className="h-10 w-10" style={{ color: 'var(--sk-ink-3)' }} />
          <p className="text-sm" style={{ color: 'var(--sk-ink-3)' }}>No results published yet.</p>
          <p className="max-w-sm text-xs" style={{ color: 'var(--sk-ink-3)' }}>
            Results appear here once your teacher publishes them.
          </p>
        </div>
      )}

      {results.length > 0 && (
        <>
          {trendPoints.length >= 2 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Your trend</CardTitle>
              </CardHeader>
              <CardContent>
                <MarksTrend points={trendPoints} />
                <p className="mt-1 text-xs" style={{ color: 'var(--sk-ink-3)' }}>
                  Marks percentage across your last {trendPoints.length} published tests, oldest
                  first.
                </p>
              </CardContent>
            </Card>
          )}

          <ul className="flex flex-col gap-3">
            {results.map((r) => {
              const myPct = pct(r.marks, r.maxMarks);
              const diff = Math.round((r.marks - r.classAverage) * 10) / 10;
              const above = diff > 0;
              const below = diff < 0;
              const Icon = above ? TrendingUp : below ? TrendingDown : Minus;
              return (
                <li key={r.examId}>
                  <Card>
                    <CardContent className="pt-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold" style={{ color: 'var(--sk-ink)' }}>{r.subjectName}</p>
                          <p className="text-sm" style={{ color: 'var(--sk-ink-2)' }}>{r.title}</p>
                          <p className="mt-0.5 text-xs" style={{ color: 'var(--sk-ink-3)' }}>
                            {formatDate(r.scheduledAt)}
                          </p>
                        </div>

                        <div className="shrink-0 text-right">
                          <p className="text-xl font-bold" style={{ color: 'var(--sk-ink)' }}>
                            {r.marks}
                            <span className="text-sm font-normal" style={{ color: 'var(--sk-ink-3)' }}>
                              /{r.maxMarks}
                            </span>
                          </p>
                          <p className="text-xs" style={{ color: 'var(--sk-ink-3)' }}>{myPct}%</p>
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3 text-xs" style={{ borderColor: 'var(--sk-line)' }}>
                        <span style={{ color: 'var(--sk-ink-3)' }}>
                          Class average: <span className="font-medium" style={{ color: 'var(--sk-ink-2)' }}>
                            {r.classAverage}
                          </span>
                          /{r.maxMarks}
                        </span>
                        <span
                          className="sk-pill inline-flex items-center gap-1"
                          data-tone={above ? 'good' : below ? 'warn' : 'neutral'}
                        >
                          <Icon className="h-3 w-3" aria-hidden="true" />
                          {above
                            ? `${diff} above average`
                            : below
                              ? `${Math.abs(diff)} below average`
                              : 'Exactly average'}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
