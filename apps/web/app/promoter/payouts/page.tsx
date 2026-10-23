'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Cell, Field, FieldRow, Row, RowList, RowTitle } from '@/components/ui/kit';
import { Empty, Failed, Loading } from '@/components/promoter/bits';
import { PromoterApiError, promoterApi, rupees, when, type PromoterMe, type PromoterPayout } from '@/lib/promoter-session';
import { usePromoterMe } from '@/components/promoter/use-me';

export default function PromoterPayouts() {
  const me = usePromoterMe();
  const qc = useQueryClient();
  const pays = useQuery({ queryKey: ['promoter-payouts'], queryFn: () => promoterApi.get<PromoterPayout[]>('/promoter/payouts') });
  const [f, setF] = useState({ payeeName: '', pan: '', bankAccount: '', ifsc: '', upi: '', gstin: '', address: '' });
  const [err, setErr] = useState<{ field?: string; msg: string } | null>(null);
  useEffect(() => {
    const m = me.data; if (!m) return;
    setF((s) => ({ ...s, payeeName: s.payeeName || m.payeeName || m.name, ifsc: s.ifsc || m.ifsc || '', upi: s.upi || m.upi || '', gstin: s.gstin || m.gstin || '', address: s.address || m.address || '' }));
  }, [me.data]);
  const save = useMutation({
    mutationFn: () => promoterApi.put<PromoterMe>('/promoter/payout-details', { payeeName: f.payeeName.trim(), pan: f.pan.trim().toUpperCase(), bankAccount: f.bankAccount.trim() || undefined, ifsc: f.ifsc.trim().toUpperCase() || undefined, upi: f.upi.trim() || undefined, gstin: f.gstin.trim().toUpperCase() || undefined, address: f.address.trim() || undefined }),
    onSuccess: () => { toast.success('Saved. Sckools verifies the details before the first payout.'); setF((s) => ({ ...s, pan: '', bankAccount: '' })); void qc.invalidateQueries({ queryKey: ['promoter-me'] }); },
    onError: (e) => setErr({ field: e instanceof PromoterApiError ? e.field : undefined, msg: e instanceof PromoterApiError ? e.message : 'Could not save.' }),
  });
  function submit() {
    setErr(null);
    if (f.payeeName.trim().length < 2) return setErr({ field: 'payeeName', msg: 'The account holder name is needed.' });
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/i.test(f.pan.trim())) return setErr({ field: 'pan', msg: 'PAN is ten characters, like ABCDE1234F. It is needed because commission attracts TDS.' });
    if (!f.upi.trim() && !(f.bankAccount.trim() && f.ifsc.trim())) return setErr({ field: 'upi', msg: 'Give a UPI id, or a bank account with its IFSC.' });
    save.mutate();
  }
  const inv = (k: string) => err?.field === k;
  if (me.isLoading) return <Loading what="payouts" />;
  if (me.isError || !me.data) return <Failed error={me.error} onRetry={() => me.refetch()} />;
  const m = me.data;

  return (
    <>
      <header className="sk-pagehead"><h1>Payouts</h1><p>Where your money goes, and what has been paid.</p></header>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 14, alignItems: 'start' }} className="pr-two">
        <div className="sk-card">
          <div className="sk-card-h"><h3>Payout details</h3>{m.payoutDetailsComplete ? <span className="sk-pill" data-tone={m.kycVerifiedAt ? 'good' : 'info'}>{m.kycVerifiedAt ? 'verified' : 'saved · being verified'}</span> : <span className="sk-pill" data-tone="warn">needed before the first payout</span>}</div>
          <div className="sk-card-b">
            {m.payoutDetailsComplete && <p className="sk-muted" style={{ margin: 0 }}>On file: {m.payeeName} · PAN {m.panMasked} · {m.bankAccountMasked ? `account ${m.bankAccountMasked}${m.ifsc ? ` (${m.ifsc})` : ''}` : ''}{m.upi ? ` UPI ${m.upi}` : ''}. Re-enter PAN and account to change them.</p>}
            <FieldRow>
              <Field id="po-name" label="Account holder" invalid={inv('payeeName')}>{(p) => <input {...p} className="sk-input" value={f.payeeName} onChange={(e) => setF({ ...f, payeeName: e.target.value })} />}</Field>
              <Field id="po-pan" label="PAN" invalid={inv('pan')} hint="Needed because commission attracts TDS.">{(p) => <input {...p} className="sk-input" value={f.pan} onChange={(e) => setF({ ...f, pan: e.target.value.toUpperCase() })} placeholder="ABCDE1234F" maxLength={10} autoComplete="off" />}</Field>
            </FieldRow>
            <FieldRow>
              <Field id="po-acc" label="Bank account" invalid={inv('bankAccount')}>{(p) => <input {...p} className="sk-input" inputMode="numeric" value={f.bankAccount} onChange={(e) => setF({ ...f, bankAccount: e.target.value.replace(/\D/g, '') })} placeholder="9 to 18 digits" autoComplete="off" />}</Field>
              <Field id="po-ifsc" label="IFSC" invalid={inv('ifsc')}>{(p) => <input {...p} className="sk-input" value={f.ifsc} onChange={(e) => setF({ ...f, ifsc: e.target.value.toUpperCase() })} placeholder="HDFC0001234" maxLength={11} />}</Field>
            </FieldRow>
            <Field id="po-upi" label="Or a UPI id" invalid={inv('upi')}>{(p) => <input {...p} className="sk-input" value={f.upi} onChange={(e) => setF({ ...f, upi: e.target.value })} placeholder="name@bank" />}</Field>
            <FieldRow>
              <Field id="po-gst" label="GSTIN (if registered)" invalid={inv('gstin')}>{(p) => <input {...p} className="sk-input" value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} maxLength={15} />}</Field>
              <Field id="po-addr" label="Address (optional)">{(p) => <input {...p} className="sk-input" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />}</Field>
            </FieldRow>
            {err && <span className="sk-state err" role="alert">{err.msg}</span>}
            <div><button className="sk-btn" data-variant="primary" disabled={save.isPending} onClick={submit}>{save.isPending ? 'Saving…' : 'Save details'}</button></div>
          </div>
        </div>

        <div className="sk-card">
          <div className="sk-card-h"><h3>Statement</h3><p className="sk-muted">Gross, tax deducted and net, per school.</p></div>
          {pays.isLoading ? <div className="sk-card-b"><Loading what="statement" /></div> : pays.isError ? <div className="sk-card-b"><Failed error={pays.error} onRetry={() => pays.refetch()} /></div> : (pays.data ?? []).length === 0 ? (
            <div className="sk-card-b"><Empty title="Nothing owed yet">Your first payout appears here {m.payoutDays} days after a referred school pays.</Empty></div>
          ) : (
            <RowList columns="minmax(0,1.3fr) auto auto auto" label="Payouts">
              {(pays.data ?? []).map((y) => (
                <Row key={y.id}>
                  <Cell><RowTitle title={y.referral.schoolName} sub={y.status === 'PAID' ? `Paid ${when(y.paidOn!)} · ${y.utr}` : `Due ${when(y.dueOn)}`} /></Cell>
                  <Cell align="end"><RowTitle title={rupees(y.grossMinor)} sub="gross" /></Cell>
                  <Cell align="end"><RowTitle title={rupees(y.tdsMinor)} sub="TDS" /></Cell>
                  <Cell align="end"><RowTitle title={<b>{rupees(y.netMinor)}</b>} sub={<span className="sk-pill" data-tone={y.status === 'PAID' ? 'good' : 'warn'}>{y.status === 'PAID' ? 'Paid' : 'Due'}</span>} /></Cell>
                </Row>
              ))}
            </RowList>
          )}
        </div>
      </div>
      <style>{`@media (max-width: 860px) { .pr-two { grid-template-columns: 1fr !important; } }`}</style>
    </>
  );
}
