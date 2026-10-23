'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Cell, Row, RowList, RowTitle } from '@/components/ui/kit';
import { Empty, Failed, Loading, StagePill } from '@/components/promoter/bits';
import { LogReferral } from '@/components/promoter/log-referral';
import { PromoterApiError, promoterApi, rupees, when, STAGE_LABEL, STAGE_ORDER, type PromoterReferral } from '@/lib/promoter-session';
import { usePromoterMe } from '@/components/promoter/use-me';

export default function PromoterReferrals() {
  const me = usePromoterMe();
  const qc = useQueryClient();
  const refs = useQuery({ queryKey: ['promoter-referrals'], queryFn: () => promoterApi.get<PromoterReferral[]>('/promoter/referrals') });
  const [openId, setOpenId] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [note, setNote] = useState('');
  useEffect(() => {
    const read = () => { const h = window.location.hash.slice(1); if (h) setOpenId(h); };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);
  useEffect(() => { if (!openId && refs.data?.length) setOpenId(refs.data[0].id); }, [refs.data, openId]);

  const addNote = useMutation({
    mutationFn: (id: string) => promoterApi.post<PromoterReferral>(`/promoter/referrals/${id}/notes`, { body: note.trim() }),
    onSuccess: () => { setNote(''); toast.success('Note sent to Sckools.'); void qc.invalidateQueries({ queryKey: ['promoter-referrals'] }); },
    onError: (e) => toast.error(e instanceof PromoterApiError ? e.message : 'Could not send the note.'),
  });

  if (refs.isLoading) return <Loading what="your referrals" />;
  if (refs.isError) return <Failed error={refs.error} onRetry={() => refs.refetch()} />;
  const list = refs.data ?? [];
  const open = list.find((r) => r.id === openId) ?? null;
  const active = me.data?.status === 'ACTIVE';

  return (
    <>
      <header className="sk-pagehead" style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h1>My referrals</h1>
          <p>Every school you logged, and where it stands. Open one for its timeline.</p>
        </div>
        <button className="sk-btn" data-variant="primary" onClick={() => setLogOpen(true)} disabled={!active}>+ Log a referral</button>
      </header>

      {list.length === 0 ? (
        <Empty title="No referrals yet">Log the first school you have in mind. It takes a minute.</Empty>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr)', gap: 14, alignItems: 'start' }} className="pr-two">
          <div className="sk-card">
            <RowList columns="minmax(0,1.4fr) auto auto" label="Referrals">
              {list.map((r) => (
                <Row key={r.id} current={r.id === openId} onClick={() => { setOpenId(r.id); history.replaceState(null, '', `#${r.id}`); }}>
                  <Cell><RowTitle title={r.schoolName} sub={`${[r.area, r.city].filter(Boolean).join(', ')} · ${r.contactName}`} /></Cell>
                  <Cell><StagePill status={r.status} /></Cell>
                  <Cell align="end">{r.willEarnMinor ? <b>{rupees(r.willEarnMinor)}</b> : <span className="sk-muted">{when(r.updatedAt)}</span>}</Cell>
                </Row>
              ))}
            </RowList>
          </div>

          {open && (
            <div className="sk-card" aria-live="polite">
              <div className="sk-card-h"><h3>{open.schoolName}</h3><StagePill status={open.status} /><p className="sk-muted">{[open.area, open.city].filter(Boolean).join(', ')}{open.studentsApprox ? ` · about ${open.studentsApprox.toLocaleString('en-IN')} students` : ''} · {open.contactName}{open.contactRole ? `, ${open.contactRole}` : ''}</p></div>
              <div className="sk-card-b">
                {open.statusReason && (open.status === 'REJECTED' || open.status === 'LOST') && <div className="sk-note" data-tone="bad"><b>Why:</b> {open.statusReason}</div>}
                {open.lapsed && <div className="sk-note" data-tone="warn">This referral has lapsed: the school was not accepted within {me.data?.attributionDays ?? 90} days, so another promoter may refer it.</div>}
                <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 2 }} aria-label="Timeline">
                  {STAGE_ORDER.filter((s) => s !== 'LIVE' || open.events.some((e) => e.toStatus === 'LIVE')).map((s) => {
                    const hit = open.events.find((e) => e.toStatus === s);
                    const done = !!hit;
                    return (
                      <li key={s} style={{ display: 'grid', gridTemplateColumns: '18px minmax(0,1fr)', gap: 10, padding: '5px 0', fontSize: 13.5, color: done ? 'var(--sk-ink)' : 'var(--sk-ink-3)' }}>
                        <i aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 999, background: done ? 'var(--sk-good)' : 'var(--sk-line-2)', marginTop: 6, marginLeft: 4 }} />
                        <div>{STAGE_LABEL[s]}{hit ? <span className="sk-rowsub">{when(hit.at)}{hit.body ? ` · ${hit.body}` : ''}</span> : null}</div>
                      </li>
                    );
                  })}
                  {open.events.filter((e) => e.toStatus === 'REJECTED' || e.toStatus === 'LOST').map((e, i) => (
                    <li key={`x${i}`} style={{ display: 'grid', gridTemplateColumns: '18px minmax(0,1fr)', gap: 10, padding: '5px 0', fontSize: 13.5 }}>
                      <i aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 999, background: 'var(--sk-bad)', marginTop: 6, marginLeft: 4 }} />
                      <div>{STAGE_LABEL[e.toStatus!]}<span className="sk-rowsub">{when(e.at)}</span></div>
                    </li>
                  ))}
                </ol>
                {open.payout && (
                  <p className="sk-muted" style={{ margin: 0 }}>
                    Reward <b>{rupees(open.payout.grossMinor)}</b> (TDS {rupees(open.payout.tdsMinor)}, net <b>{rupees(open.payout.netMinor)}</b>) · {open.payout.status === 'PAID' ? `paid ${when(open.payout.paidOn!)}, ref ${open.payout.utr}` : `due ${when(open.payout.dueOn)}`}
                  </p>
                )}
                {!open.payout && !['REJECTED', 'LOST'].includes(open.status) && (
                  <p className="sk-muted" style={{ margin: 0 }}>This referral is yours until <b>{when(open.attributionUntil)}</b>.{open.rateKnown ? ' Earns your commission once the school is live and has paid.' : ' Earns your commission once it is set.'}</p>
                )}
                {open.events.filter((e) => e.actor === 'PROMOTER' && e.body).length > 0 && (
                  <div>
                    <span className="sk-lab">Your notes</span>
                    {open.events.filter((e) => e.actor === 'PROMOTER' && e.body).map((e, i) => <p key={i} style={{ margin: '4px 0 0', fontSize: 13.5 }}>{e.body} <span className="sk-muted">· {when(e.at)}</span></p>)}
                  </div>
                )}
                {!['REJECTED', 'LOST', 'PAID'].includes(open.status) && active && (
                  <div className="sk-field">
                    <label className="sk-lab" htmlFor="pr-note">Add a note for Sckools</label>
                    <textarea id="pr-note" className="sk-input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="The principal is away till Diwali; call after 25 Oct." />
                    <div><button className="sk-btn" disabled={note.trim().length < 1 || addNote.isPending} onClick={() => addNote.mutate(open.id)}>{addNote.isPending ? 'Sending…' : 'Send note'}</button></div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
      <style>{`@media (max-width: 860px) { .pr-two { grid-template-columns: 1fr !important; } }`}</style>
      {logOpen && <LogReferral onClose={() => setLogOpen(false)} />}
    </>
  );
}
