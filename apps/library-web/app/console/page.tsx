'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import { useApiCtx } from '@/lib/session';
import {
  dayReport,
  formatRupees,
  listOverdue,
  type DayReport,
  type OverdueRow,
} from '@/lib/circulation';
import { initials, memberHue, memberName } from '@/lib/members';

interface Loaded {
  report: DayReport;
  overdue: OverdueRow[];
}

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; data: Loaded }
  | { kind: 'error'; message: string };

export default function DashboardPage() {
  const ctx = useApiCtx();
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    if (!ctx) return;
    let live = true;
    // Both reads together: a half-drawn dashboard that fills in tile by tile
    // reads as broken rather than as loading.
    Promise.all([dayReport(ctx), listOverdue(ctx)])
      .then(([report, overdue]) => {
        if (live) setState({ kind: 'ready', data: { report, overdue } });
      })
      .catch((err) => {
        if (!live) return;
        setState({
          kind: 'error',
          message: err instanceof ApiError ? err.message : 'Could not reach the library.',
        });
      });
    return () => { live = false; };
  }, [ctx]);

  const data = state.kind === 'ready' ? state.data : null;
  const worst = data ? [...data.overdue].sort((a, b) => b.daysOverdue - a.daysOverdue).slice(0, 5) : [];

  return (
    <>
      <div className="lbx-pagehead">
        <div>
          <h2>Today at the library</h2>
          <p>
            {data
              ? new Date(`${data.report.date}T00:00:00`).toLocaleDateString(undefined, {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                })
              : 'Loading the day’s figures…'}
          </p>
        </div>
      </div>

      {state.kind === 'error' ? (
        <div className="lbx-error" role="alert">
          <span aria-hidden="true">⚠</span>
          <span>{state.message}</span>
        </div>
      ) : null}

      <div className="lbx-tiles">
        <Tile label="Issued" value={data?.report.issued} href="/console/desk" hint="today" />
        <Tile label="Returned" value={data?.report.returned} href="/console/desk" hint="today" />
        {/* Counted from the live list, NOT from `report.overdue`. The two are
            different questions: the day-report asks "past due as of the end of
            that day" so a historical date reconciles the same way next month,
            while the list asks "overdue right now". Both are right, and they
            can differ — but a tile disagreeing with the list directly beneath
            it is how a dashboard stops being believed. */}
        <Tile
          label="Overdue"
          value={data?.overdue.length}
          href="/console/overdue"
          hint="right now"
          tone={data && data.overdue.length > 0 ? 'stop' : undefined}
        />
        <Tile
          label="Fines raised"
          value={data ? formatRupees(data.report.finesAccrued.amount) : undefined}
          href="/console/fines"
          hint={data ? `${data.report.finesAccrued.count} today` : 'today'}
          tone={data && data.report.finesAccrued.count > 0 ? 'warn' : undefined}
        />
      </div>

      {/* The list is the point of the page: a count tells you there is a problem,
          a name tells you whose. */}
      <section style={{ marginTop: '1.6rem' }}>
        <h3 className="lbx-h3">Longest overdue</h3>
        {state.kind === 'loading' ? (
          <p style={{ color: 'var(--lb-ink-3)', fontSize: '.86rem' }}>Loading…</p>
        ) : null}

        {data && worst.length === 0 ? (
          <p className="lbx-empty">Nothing is overdue. Every book is back or still in time.</p>
        ) : null}

        {worst.length > 0 ? (
          <div className="lbx-rows">
            {worst.map((r) => (
              <div className="lbx-row" key={r.id}>
                <span
                  className="lbx-disc"
                  style={{ background: `hsl(${memberHue(r.member.id)} 45% 40%)` }}
                  aria-hidden="true"
                >
                  {initials(r.member)}
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="lbx-row-t" style={{ fontFamily: 'var(--lb-sans)' }}>
                    {memberName(r.member)}
                  </div>
                  <div className="lbx-row-m">
                    {r.title.title} · <span className="lbx-mono">{r.member.code}</span>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span className={`lbx-days ${r.daysOverdue > 14 ? 'over' : 'soon'}`}>{r.daysOverdue}</span>
                  <span className="lbx-sub">{r.daysOverdue === 1 ? 'day' : 'days'}</span>
                </div>
              </div>
            ))}
            {data && data.overdue.length > worst.length ? (
              <Link href="/console/overdue" className="lbx-more">
                {data.overdue.length - worst.length} more overdue →
              </Link>
            ) : null}
          </div>
        ) : null}
      </section>
    </>
  );
}

function Tile({
  label,
  value,
  hint,
  href,
  tone,
}: {
  label: string;
  value: number | string | undefined;
  hint: string;
  href: string;
  tone?: 'warn' | 'stop';
}) {
  return (
    <Link href={href} className={`lbx-tile${tone ? ` ${tone}` : ''}`}>
      <span className="lbx-tile-label">{label}</span>
      <span className="lbx-tile-value">{value ?? '—'}</span>
      <span className="lbx-tile-hint">{hint}</span>
    </Link>
  );
}
