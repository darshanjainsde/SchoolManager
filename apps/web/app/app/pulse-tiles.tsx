'use client';
import Link from 'next/link';
import type { DashboardPulse } from '@skoolos/types';
import { rupees } from '@/lib/fees';

/**
 * The pulse — four tiles that MOVE. Sparklines are hand-rolled SVG (the
 * portal's own MarksTrend recipe): an emphasised endpoint, no library, and
 * numbers that come from the same reads their target screens use.
 */

function Spark({ points, stroke }: { points: { v: number }[]; stroke: string }) {
  if (points.length < 2) return <div style={{ height: 26 }} />;
  const w = 120;
  const h = 26;
  const vs = points.map((p) => p.v);
  const min = Math.min(...vs);
  const max = Math.max(...vs);
  const span = max - min || 1;
  const xy = points.map((p, i) => ({
    x: (i / (points.length - 1)) * w,
    y: h - 4 - ((p.v - min) / span) * (h - 8),
  }));
  const last = xy[xy.length - 1]!;
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true" style={{ display: 'block', marginTop: 4 }}>
      <polyline points={xy.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={stroke} strokeWidth="2" />
      <circle cx={last.x} cy={last.y} r="2.6" fill={stroke} />
    </svg>
  );
}

export function PulseTiles({ pulse }: { pulse: DashboardPulse }) {
  const p = pulse;
  const enqDelta = p.enquiries.last7 - p.enquiries.prev7;
  const feePct = p.fees && p.fees.billedMinor > 0 ? Math.round((p.fees.collectedMinor / p.fees.billedMinor) * 100) : null;

  return (
    <div className="sk-kpis" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))' }}>
      <Link href="/app/classes" className="sk-kpi">
        <div className="lab">Attendance today</div>
        <div className="n">{p.attendance.todayPct === null ? '—' : `${p.attendance.todayPct}%`}</div>
        <Spark points={p.attendance.series.map((s) => ({ v: s.pct }))} stroke="var(--sk-good)" />
        <div className="hint">
          {p.attendance.marked > 0
            ? `${p.attendance.present} of ${p.attendance.marked} marked · last ${p.attendance.series.length} school days`
            : 'nothing marked yet today'}
        </div>
      </Link>

      {p.fees && (
        <Link href="/app/fees" className="sk-kpi" data-tone={p.fees.outstandingMinor > 0 ? 'warn' : 'good'}>
          <div className="lab">Fees · this session</div>
          <div className="n">
            {rupees(p.fees.collectedMinor)}
            <span className="u"> / {rupees(p.fees.billedMinor)}</span>
          </div>
          {/* A progress bar, not a sparkline — collection is a jar filling. */}
          <svg width="100%" height="10" viewBox="0 0 120 10" preserveAspectRatio="none" aria-hidden="true" style={{ display: 'block', marginTop: 6 }}>
            <rect x="0" y="2" width="120" height="6" rx="3" fill="var(--sk-bg-2)" />
            <rect x="0" y="2" width={feePct === null ? 0 : Math.max(2, (feePct / 100) * 120)} height="6" rx="3" fill="var(--sk-brand)" />
          </svg>
          <div className="hint">
            {feePct === null ? 'nothing billed yet' : `${feePct}% collected · ${p.fees.owingFamilies} ${p.fees.owingFamilies === 1 ? 'family owes' : 'families owe'}`}
          </div>
        </Link>
      )}

      <Link href="/app/enquiries" className="sk-kpi" data-tone={p.enquiries.uncontacted > 0 ? 'warn' : undefined}>
        <div className="lab">Enquiries · 7 days</div>
        <div className="n">
          {p.enquiries.last7}
          {enqDelta !== 0 && (
            <span className="u" style={{ color: enqDelta > 0 ? 'var(--sk-good)' : 'var(--sk-bad)' }}>
              {' '}{enqDelta > 0 ? '▲' : '▼'}{Math.abs(enqDelta)}
            </span>
          )}
        </div>
        <Spark points={p.enquiries.series.map((s) => ({ v: s.count }))} stroke="var(--sk-amber)" />
        <div className="hint">{p.enquiries.uncontacted > 0 ? `${p.enquiries.uncontacted} not yet contacted` : 'every enquiry answered'}</div>
      </Link>

      <Link href="/app/students" className="sk-kpi">
        <div className="lab">The roll</div>
        <div className="n">{p.roll.students}</div>
        <div className="hint">{p.roll.classes} classes · {p.roll.teachers} teachers</div>
      </Link>
    </div>
  );
}
