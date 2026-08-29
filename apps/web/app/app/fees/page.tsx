'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, ClipboardCheck, Settings2, Wallet } from 'lucide-react';
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
          <div className="sk-kpis">
            <div className="sk-kpi">
              <div className="lab">Collected today</div>
              <div className="n">{rupees(s.todayTotalMinor)}</div>
              <div className="hint">
                {s.todayByMethod.length
                  ? s.todayByMethod.map((m) => `${METHOD_LABEL[m.method]} ${rupees(m.amountMinor)}`).join(' · ')
                  : 'nothing yet today'}
              </div>
            </div>
            <Link href="/app/fees/verify" className="sk-kpi" data-tone={s.awaitingReviewCount ? 'warn' : undefined}>
              <div className="lab"><ClipboardCheck size={12} /> Waiting for you</div>
              <div className="n">{s.awaitingReviewCount}</div>
              <div className="hint">{rupees(s.awaitingReviewMinor)} to confirm</div>
            </Link>
            <div className="sk-kpi">
              <div className="lab">Billed this session</div>
              <div className="n">{rupees(s.billedMinor)}</div>
              <div className="hint">{rupees(s.collectedMinor)} received</div>
            </div>
            <div className="sk-kpi" data-tone={s.outstandingMinor > 0 ? 'bad' : 'good'}>
              <div className="lab">Still outstanding</div>
              <div className="n">{rupees(s.outstandingMinor)}</div>
              <div className="hint">
                {s.billedMinor > 0
                  ? `${Math.round((s.collectedMinor / s.billedMinor) * 100)}% collected`
                  : 'nothing billed yet'}
              </div>
            </div>
          </div>

          <div className="sk-cardgrid">
            <Link href="/app/fees/verify" className="sk-entity">
              <span className="av" style={{ background: 'var(--sk-brand)' }}><ClipboardCheck size={20} /></span>
              <span className="min-w-0">
                <span className="nm">Payments to check</span>
                <span className="meta">
                  {s.awaitingReviewCount
                    ? `${s.awaitingReviewCount} waiting`
                    : 'nothing waiting'}
                </span>
              </span>
              <ArrowUpRight size={16} style={{ marginLeft: 'auto', color: 'var(--sk-ink-3)' }} />
            </Link>

            <Link href="/app/fees/setup" className="sk-entity">
              <span className="av" style={{ background: 'var(--sk-amber)' }}><Settings2 size={20} /></span>
              <span className="min-w-0">
                <span className="nm">Fee setup</span>
                <span className="meta">Categories, terms, class amounts, bills</span>
              </span>
              <ArrowUpRight size={16} style={{ marginLeft: 'auto', color: 'var(--sk-ink-3)' }} />
            </Link>

            <Link href="/app/fees/payment-setup" className="sk-entity">
              <span className="av" style={{ background: 'var(--sk-good)' }}><Wallet size={20} /></span>
              <span className="min-w-0">
                <span className="nm">How parents pay</span>
                <span className="meta">Bank details and online payment</span>
              </span>
              <ArrowUpRight size={16} style={{ marginLeft: 'auto', color: 'var(--sk-ink-3)' }} />
            </Link>
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
