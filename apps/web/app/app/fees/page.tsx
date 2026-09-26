'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck, Settings2, Users, Wallet } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { METHOD_LABEL, collectedLabel, fmtDay, rupees, type CollectionSummary, type FeePaymentStatus, type RecentPaymentRow } from '@/lib/fees';
import { HubDoor, HubDoors, HubKpi, HubKpis, HubList, HubPage } from '@/components/ui/hub';
import { Cell, Row, RowTitle } from '@/components/ui/kit';

/**
 * The fees home — a hub (components/ui/hub.tsx).
 *
 * Numbers: what came in today and what is still owed, plus the queue waiting
 * on a decision, because that is the only thing here that is time-bound.
 * Doors: the four desks. List: the last few payments, any status, so the page
 * shows the money moving rather than ending under the doors.
 */
const DOORS: {
  href: string;
  title: string;
  tint: string;
  icon: typeof ClipboardCheck;
  meta: (s: CollectionSummary) => string;
}[] = [
  {
    href: '/app/fees/verify',
    title: 'Payments to check',
    tint: 'var(--sk-brand)',
    icon: ClipboardCheck,
    meta: (s) => (s.awaitingReviewCount ? `${s.awaitingReviewCount} waiting` : 'nothing waiting'),
  },
  {
    href: '/app/fees/setup',
    title: 'Fee setup',
    tint: 'var(--sk-amber)',
    icon: Settings2,
    meta: () => 'Categories, terms, class amounts, bills',
  },
  {
    href: '/app/fees/payment-setup',
    title: 'How parents pay',
    tint: 'var(--sk-good)',
    icon: Wallet,
    meta: () => 'Bank details and online payment',
  },
  {
    href: '/app/fees/students',
    title: 'Fees by student',
    tint: 'var(--sk-ink-2)',
    icon: Users,
    meta: (s) => `${s.billedMinor > 0 ? 'Everyone on the roll' : 'Once bills are issued'} · filter to who owes`,
  },
];


const STATUS_WORD: Record<FeePaymentStatus, string> = {
  SUBMITTED: 'To check', VERIFIED: 'Confirmed', REJECTED: 'Rejected', REVERSED: 'Reversed',
};
const STATUS_TONE: Record<FeePaymentStatus, 'warn' | 'good' | 'bad' | 'neutral'> = {
  SUBMITTED: 'warn', VERIFIED: 'good', REJECTED: 'bad', REVERSED: 'neutral',
};

export default function FeesHomePage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });

  const summary = useQuery({
    queryKey: ['fee-summary', host], enabled: !!host,
    queryFn: () => api.get<CollectionSummary>('/manage/fees/summary'),
  });
  const recent = useQuery({
    queryKey: ['fee-recent-payments', host], enabled: !!host,
    queryFn: () => api.get<RecentPaymentRow[]>('/manage/fees/payments/recent?limit=8'),
  });

  const s = summary.data;
  const rows = recent.data ?? [];

  // The header's one action is whatever is waiting; with nothing waiting it
  // is the setup desk, which is where a school that has not billed goes next.
  const action = s
    ? s.awaitingReviewCount > 0
      ? <Link href="/app/fees/verify" className="sk-btn sk-press" data-variant="primary">Check {s.awaitingReviewCount} {s.awaitingReviewCount === 1 ? 'payment' : 'payments'}</Link>
      : <Link href="/app/fees/setup" className="sk-btn sk-press">Fee setup</Link>
    : null;

  return (
    <HubPage title="Fees" subtitle="What has come in, what is owed, and what needs your eye." action={action}>
      {summary.isLoading && <p className="sk-state">Adding it up…</p>}
      {summary.isError && <p className="sk-state err">The fee summary could not load. Refresh to try again.</p>}

      {s && (
        <>
          <HubKpis>
            <HubKpi
              href="/app/fees/verify?status=VERIFIED" label="Collected today" value={rupees(s.todayTotalMinor)}
              hint={s.todayByMethod.length
                ? s.todayByMethod.map((m) => `${METHOD_LABEL[m.method]} ${rupees(m.amountMinor)}`).join(' · ')
                : 'nothing yet today'}
            />
            <HubKpi
              href="/app/fees/verify" label="Waiting for you" value={s.awaitingReviewCount}
              hint={`${rupees(s.awaitingReviewMinor)} to confirm`} tone={s.awaitingReviewCount ? 'warn' : undefined}
            />
            <HubKpi href="/app/fees/students" label="Billed this session" value={rupees(s.billedMinor)} hint={`${rupees(s.collectedMinor)} received`} />
            <HubKpi
              href="/app/fees/students?owing=1" label="Still outstanding" value={rupees(s.outstandingMinor)}
              hint={collectedLabel(s.collectedMinor, s.billedMinor)} tone={s.outstandingMinor > 0 ? 'bad' : 'good'}
            />
          </HubKpis>

          <HubDoors>
            {DOORS.map((d) => <HubDoor key={d.href} href={d.href} title={d.title} meta={d.meta(s)} icon={d.icon} tint={d.tint} />)}
          </HubDoors>

          {s.billedMinor === 0 && (
            <div className="sk-card">
              <div className="sk-card-b">
                <p className="sk-state" style={{ margin: 0 }}>
                  Nothing has been billed yet. Start with <Link href="/app/fees/setup"
                  style={{ color: 'var(--sk-brand-2)' }}>fee setup</Link> — it takes about ten minutes,
                  and you can collect by bank transfer straight away.
                </p>
              </div>
            </div>
          )}
        </>
      )}

      <HubList
        title="Latest payments" label="Latest payments"
        more={{ href: '/app/fees/verify', label: 'All' }}
        columns="minmax(0, 1.6fr) minmax(0, 1fr) auto auto"
        count={rows.length}
        empty={recent.isLoading ? 'Looking for payments…' : recent.isError ? 'The payments could not load.' : 'No payment has been recorded yet. The first one a parent sends, or you record, shows here.'}
      >
        {rows.map((p) => (
          <Row key={p.id}>
            <Cell>
              <Link href={`/app/students/${p.student.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                <RowTitle title={p.student.name} sub={p.student.className ?? 'no class'} />
              </Link>
            </Cell>
            <Cell>
              <RowTitle title={rupees(p.amountMinor)} sub={`${METHOD_LABEL[p.method] ?? p.method}${p.receiptNumber ? ` · ${p.receiptNumber}` : ''}`} />
            </Cell>
            <Cell align="end"><span className="sk-pill" data-tone={STATUS_TONE[p.status]}>{STATUS_WORD[p.status]}</span></Cell>
            <Cell align="end"><span className="sk-muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{fmtDay(p.submittedAt)}</span></Cell>
          </Row>
        ))}
      </HubList>
    </HubPage>
  );
}
