'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Cell, Row, RowList, RowTitle } from '@/components/ui/kit';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Empty, Failed, Loading, StagePill, Tile } from '@/components/promoter/bits';
import { LogReferral } from '@/components/promoter/log-referral';
import { PromoterApiError, promoterApi, rupees, when, type PromoterReferral } from '@/lib/promoter-session';
import { usePromoterMe } from '@/components/promoter/use-me';

export default function PromoterDashboard() {
  const router = useRouter();
  const me = usePromoterMe();
  const refs = useQuery({ queryKey: ['promoter-referrals'], queryFn: () => promoterApi.get<PromoterReferral[]>('/promoter/referrals') });
  const qc = useQueryClient();
  const [logOpen, setLogOpen] = useState(false);
  const ask = useMutation({
    mutationFn: () => promoterApi.post<{ requestedAt: string }>('/promoter/commission-request'),
    onSuccess: () => { toast.success('Request sent. Sckools replies within two working days.'); void qc.invalidateQueries({ queryKey: ['promoter-me'] }); },
    onError: (e) => toast.error(e instanceof PromoterApiError ? e.message : 'Could not send the request.'),
  });

  if (me.isLoading) return <Loading what="your dashboard" />;
  if (me.isError || !me.data) return <Failed error={me.error} onRetry={() => me.refetch()} />;
  const m = me.data;
  const first = m.name.split(' ')[0];
  const active = m.status === 'ACTIVE';
  const list = (refs.data ?? []).slice(0, 6);

  return (
    <>
      <header className="sk-pagehead" style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h1>Good day, {first}</h1>
          <p>{m.figures.referred ? `${m.figures.referred} school${m.figures.referred === 1 ? '' : 's'} referred · ${m.figures.live} live` : 'No referrals yet. Log the first school you have in mind.'}</p>
        </div>
        <button className="sk-btn" data-variant="primary" onClick={() => setLogOpen(true)} disabled={!active}>+ Log a referral</button>
      </header>

      {!m.questionnaireComplete && (
        <div className="sk-note" data-tone="warn">Two quick answers decide your rate. <Link href="/promoter/profile">Finish the questionnaire</Link>.</div>
      )}
      {!m.payoutDetailsComplete && m.figures.live > 0 && (
        <div className="sk-note" data-tone="warn">A school you referred is live. <Link href="/promoter/payouts">Add your payout details</Link> so the reward can be paid.</div>
      )}

      {/* The commission card: not set / requested / set. The one thing a promoter looks for first. */}
      <div className="sk-card" style={{ borderLeft: `5px solid ${m.commissionPct ? 'var(--sk-good)' : m.commissionRequestedAt ? 'var(--sk-amber)' : 'var(--sk-brand)'}` }}>
        <div className="sk-card-b" style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 16 }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            {m.commissionPct ? (
              <>
                <h3 style={{ margin: 0, fontSize: 15.5 }}>Your commission</h3>
                <p className="sk-muted" style={{ margin: '4px 0 0' }}>On each school you refer that goes live and pays: <b>{m.commissionPct}% of its first-year payment</b>{m.commissionCapMinor ? `, up to ${rupees(m.commissionCapMinor)} per school` : ', with no cap'}. Set on {when(m.commissionSetAt!)}.{m.commissionNote ? <> <i>{m.commissionNote}</i></> : null}</p>
              </>
            ) : m.commissionRequestedAt ? (
              <>
                <h3 style={{ margin: 0, fontSize: 15.5 }}>Commission requested</h3>
                <p className="sk-muted" style={{ margin: '4px 0 0' }}>Asked on {when(m.commissionRequestedAt)}. Sckools reads your answers and sets your rate within two working days. You can log referrals meanwhile; they wait for the rate.</p>
              </>
            ) : (
              <>
                <h3 style={{ margin: 0, fontSize: 15.5 }}>Your commission is not set yet</h3>
                <p className="sk-muted" style={{ margin: '4px 0 0' }}>Ask for it now. Sckools reads your questionnaire and sets a rate for your account, usually within two working days.</p>
              </>
            )}
          </div>
          {m.commissionPct ? (
            <span style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-.03em', color: 'var(--sk-good)', fontVariantNumeric: 'tabular-nums' }}>{m.commissionPct}%<small style={{ fontSize: 13, color: 'var(--sk-ink-2)', fontWeight: 600, marginLeft: 6 }}>per school</small></span>
          ) : m.commissionRequestedAt ? (
            <span className="sk-pill" data-tone="warn">Pending with Sckools</span>
          ) : (
            <button className="sk-btn" data-variant="primary" disabled={!active || ask.isPending || !m.questionnaireComplete} onClick={() => ask.mutate()} title={m.questionnaireComplete ? undefined : 'Finish the questionnaire first'}>{ask.isPending ? 'Sending…' : 'Get my commission %'}</button>
          )}
        </div>
      </div>

      <div className="sk-kpis">
        <Tile label="Referred" value={String(m.figures.referred)} />
        <Tile label="In progress" value={String(m.figures.inProgress)} />
        <Tile label="Live" value={String(m.figures.live)} />
        <Tile label="Earned" value={rupees(m.figures.earnedMinor)} hint={m.figures.paidMinor ? `${rupees(m.figures.paidMinor)} paid` : undefined} tone={m.figures.earnedMinor ? 'good' : undefined} />
      </div>

      {refs.isLoading ? <Loading what="referrals" /> : refs.isError ? <Failed error={refs.error} onRetry={() => refs.refetch()} /> : list.length === 0 ? (
        <Empty title="No referrals yet">Log the first school you have in mind. It takes a minute, and we check it against schools already with us the moment you save.</Empty>
      ) : (
        <div className="sk-card">
          <div className="sk-card-h"><h3>Latest referrals</h3><Link className="sk-btn" href="/promoter/referrals" style={{ marginLeft: 'auto' }}>All referrals</Link></div>
          <RowList columns="minmax(0,1.4fr) minmax(0,1fr) auto auto" label="Latest referrals">
            {list.map((r) => (
              <Row key={r.id} onClick={() => router.push(`/promoter/referrals#${r.id}`)}>
                <Cell><RowTitle title={r.schoolName} sub={[r.area, r.city].filter(Boolean).join(', ')} /></Cell>
                <Cell><RowTitle title={r.contactName} sub={r.contactRole ?? ''} /></Cell>
                <Cell><StagePill status={r.status} /></Cell>
                <Cell align="end">{r.willEarnMinor ? <b>{rupees(r.willEarnMinor)}</b> : r.status === 'REJECTED' || r.status === 'LOST' ? '—' : <span className="sk-muted">{r.rateKnown ? 'after live' : 'rate pending'}</span>}</Cell>
              </Row>
            ))}
          </RowList>
        </div>
      )}

      {logOpen && <LogReferral onClose={() => setLogOpen(false)} />}
    </>
  );
}
