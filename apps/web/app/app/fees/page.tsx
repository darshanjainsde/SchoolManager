'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, ClipboardCheck, Settings2, Users, Wallet } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { METHOD_LABEL, rupees, type CollectionSummary } from '@/lib/fees';

/**
 * The fees home.
 *
 * Leads with the two numbers an accountant is asked for every day — what came
 * in today, and what is still owed — and with the queue of payments waiting on
 * a decision, because that is the only thing on this page that is time-bound.
 */
/**
 * The three places to go from here. Data rather than three hand-written
 * blocks, so a change to one card's markup cannot leave the other two behind —
 * which is how the title/description ran together on all three at once.
 */
const ACTIONS: {
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

/**
 * A rounded percentage below 1 reads as "we have collected nothing" — ₹12,600
 * against ₹2.23 crore is 0.056%, which rounds to a flat 0 on a school that has
 * genuinely taken money.
 */
function collectedLabel(collectedMinor: number, billedMinor: number): string {
  if (billedMinor <= 0) return 'nothing billed yet';
  const pct = (collectedMinor / billedMinor) * 100;
  if (pct === 0) return '0% collected';
  if (pct < 1) return 'under 1% collected';
  if (pct < 10) return `${pct.toFixed(1)}% collected`;
  return `${Math.round(pct)}% collected`;
}

export default function FeesHomePage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });

  const summary = useQuery({
    queryKey: ['fee-summary', host], enabled: !!host,
    queryFn: () => api.get<CollectionSummary>('/manage/fees/summary'),
  });

  const s = summary.data;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <header className="sk-pagehead">
        <h1>Fees</h1>
        <p>What has come in, what is owed, and what needs your eye.</p>
      </header>

      {summary.isLoading && <p className="sk-state">Adding it up…</p>}

      {s && (
        <>
          {/*
            Every tile is a link. `a.sk-kpi:hover` already lifts the card and
            turns its border indigo, so the affordance comes free the moment
            these are anchors — three of them used to be <div> and looked
            identical to the one that worked.
          */}
          <div className="sk-kpis">
            <Link href="/app/fees/verify?status=VERIFIED" className="sk-kpi">
              <div className="lab">Collected today</div>
              <div className="n">{rupees(s.todayTotalMinor)}</div>
              <div className="hint">
                {s.todayByMethod.length
                  ? s.todayByMethod.map((m) => `${METHOD_LABEL[m.method]} ${rupees(m.amountMinor)}`).join(' · ')
                  : 'nothing yet today'}
              </div>
            </Link>
            <Link href="/app/fees/verify" className="sk-kpi" data-tone={s.awaitingReviewCount ? 'warn' : undefined}>
              <div className="lab">Waiting for you</div>
              <div className="n">{s.awaitingReviewCount}</div>
              <div className="hint">{rupees(s.awaitingReviewMinor)} to confirm</div>
            </Link>
            <Link href="/app/fees/students" className="sk-kpi">
              <div className="lab">Billed this session</div>
              <div className="n">{rupees(s.billedMinor)}</div>
              <div className="hint">{rupees(s.collectedMinor)} received</div>
            </Link>
            <Link href="/app/fees/students?owing=1" className="sk-kpi"
                  data-tone={s.outstandingMinor > 0 ? 'bad' : 'good'}>
              <div className="lab">Still outstanding</div>
              <div className="n">{rupees(s.outstandingMinor)}</div>
              <div className="hint">{collectedLabel(s.collectedMinor, s.billedMinor)}</div>
            </Link>
          </div>

          {/*
            auto-FIT, not the class default of auto-fill: with three cards in a
            wide container auto-fill leaves empty tracks, so the row stopped
            short and its right edge did not line up with the four tiles above.
          */}
          <div className="sk-cardgrid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
            {ACTIONS.map((a) => (
              <Link key={a.href} href={a.href} className="sk-entity sk-press">
                <span className="av" style={{ background: a.tint }}>
                  <a.icon size={20} aria-hidden="true" />
                </span>
                {/*
                  Blocks, not spans. `.nm` and `.meta` carry no `display`, so as
                  inline elements they ran together on one line — "Fee
                  setupCategories, terms, class amounts, bills".
                */}
                <div className="min-w-0 flex-1">
                  <div className="nm">{a.title}</div>
                  <div className="meta">{a.meta(s)}</div>
                </div>
                <ArrowUpRight size={16} className="shrink-0" style={{ color: 'var(--sk-ink-3)' }} aria-hidden="true" />
              </Link>
            ))}
          </div>

          {s.billedMinor === 0 && (
            <div className="sk-card">
              <div className="sk-card-b">
                <p className="sk-state">
                  Nothing has been billed yet. Start with <Link href="/app/fees/setup"
                  style={{ color: 'var(--sk-brand-2)' }}>fee setup</Link> — it takes about ten minutes,
                  and you can collect by bank transfer straight away.
                </p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
