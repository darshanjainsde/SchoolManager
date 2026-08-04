'use client';
import { useQuery } from '@tanstack/react-query';
import { GraduationCap, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { PublishedResult } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

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
      <header className="sk-pagehead">
        <h1>Results</h1>
        <p>Your published test results, with how the class did overall.</p>
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
            <div className="sk-card">
              <div className="sk-card-h">
                <h3>Your trend</h3>
              </div>
              <div className="sk-card-b">
                <MarksTrend points={trendPoints} />
                <p className="text-xs" style={{ color: 'var(--sk-ink-3)' }}>
                  Marks percentage across your last {trendPoints.length} published tests, oldest
                  first.
                </p>
              </div>
            </div>
          )}

          {/* ── The report sheet ───────────────────────────────────────────
              One card, one row per published result, each row landing THE
              STAMP: serif, drawn border, arriving oversized and settling a
              couple of degrees off square, because a rubber stamp never lands
              straight. A stamp is this product's word for "closed" — the
              teacher decided this mark and it is not going to change, which is
              precisely what a grade is and what a plain number fails to say.

              The mark is real text inside the stamp, so it is read out and
              copied normally; only the landing is animation, and reduced
              motion collapses it to the settled state.

              EVERY ROW IS OPEN. A design pass put the class comparison behind
              a per-row accordion, one row at a time: the baseline page showed
              the mark, the class average and the above/below reading on every
              result at once, and hiding two of those three behind a tap is
              the whole question this page is asked. The stamp stayed — it is
              paint on a row that is otherwise the shipped one. */}
          <div className="sk-card">
            {results.map((r, i) => {
              const myPct = pct(r.marks, r.maxMarks);
              const avgPct = pct(r.classAverage, r.maxMarks);
              const diff = Math.round((r.marks - r.classAverage) * 10) / 10;
              const above = diff > 0;
              const below = diff < 0;
              const Icon = above ? TrendingUp : below ? TrendingDown : Minus;
              return (
                <div className="sk-res" key={r.examId}>
                  <div className="top">
                    <span className="min-w-0 flex-1">
                      <span className="sub block">{r.subjectName}</span>
                      <span className="ttl block">
                        {r.title} · {formatDate(r.scheduledAt)}
                      </span>
                    </span>
                    {/* Stamps land one after another down the sheet, not all
                        at once — staggered, and capped so a long term's worth
                        of results never leaves the last one waiting. */}
                    <span
                      className="sk-stamp sk-stampin sk-in"
                      style={{ animationDelay: `${0.12 + Math.min(i, 6) * 0.11}s` }}
                    >
                      {r.marks} / {r.maxMarks}
                    </span>
                  </div>

                  <div className="detin">
                    {/* THE INK LINE, twice: your mark and the class average on
                        the same scale. Two bars answer "how did I do" faster
                        than two numbers can, because the comparison is the
                        length rather than the arithmetic. */}
                    <div className="sk-bar">
                      <div className="lbl">
                        <span>You</span>
                        <span>
                          {r.marks} · {myPct}%
                        </span>
                      </div>
                      <div className="tr">
                        <i style={{ width: `${myPct}%`, background: 'var(--sk-brand)' }} />
                      </div>
                      <div className="lbl">
                        <span>Class average</span>
                        <span>
                          {r.classAverage} · {avgPct}%
                        </span>
                      </div>
                      <div className="tr">
                        <i style={{ width: `${avgPct}%`, background: 'var(--sk-line-2)' }} />
                      </div>
                    </div>
                    <span
                      className="sk-pill mt-3 inline-flex items-center gap-1"
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
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
