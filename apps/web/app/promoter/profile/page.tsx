'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Field, FieldRow } from '@/components/ui/kit';
import { Failed, Loading } from '@/components/promoter/bits';
import { PromoterApiError, promoterApi, type PromoterMe } from '@/lib/promoter-session';
import { usePromoterMe } from '@/components/promoter/use-me';

const WHO = ['Teacher', 'Parent, PTA member', 'Tuition owner', 'School supplier', 'Ed consultant', 'Other'];
const EXPECT: { k: string; l: string }[] = [{ k: '1-2', l: '1 – 2' }, { k: '3-5', l: '3 – 5' }, { k: '6-10', l: '6 – 10' }, { k: '10+', l: '10+' }];

export default function PromoterProfile() {
  const me = usePromoterMe();
  const qc = useQueryClient();
  const [f, setF] = useState({ name: '', city: '', who: '', expect: '', areas: '', know: '', schoolsInMind: '', hasGst: false });
  useEffect(() => { const m = me.data; if (m) setF({ name: m.name, city: m.city ?? '', who: m.who ?? '', expect: m.expect ?? '', areas: m.areas ?? '', know: m.know ?? '', schoolsInMind: m.schoolsInMind ?? '', hasGst: m.hasGst }); }, [me.data]);
  const [err, setErr] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => promoterApi.patch<PromoterMe>('/promoter/me', { name: f.name.trim(), city: f.city.trim(), who: f.who || undefined, expect: f.expect || undefined, areas: f.areas.trim(), know: f.know.trim(), schoolsInMind: f.schoolsInMind.trim(), hasGst: f.hasGst }),
    onSuccess: () => { toast.success('Saved.'); void qc.invalidateQueries({ queryKey: ['promoter-me'] }); },
    onError: (e) => setErr(e instanceof PromoterApiError ? e.message : 'Could not save.'),
  });
  if (me.isLoading) return <Loading what="your profile" />;
  if (me.isError || !me.data) return <Failed error={me.error} onRetry={() => me.refetch()} />;
  const m = me.data;
  const seg = (name: string, value: string, opts: { k: string; l: string }[], on: (k: string) => void) => (
    <div role="group" aria-label={name} style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {opts.map((o) => <button key={o.k} type="button" className="sk-btn" aria-pressed={value === o.k} onClick={() => on(o.k)}>{o.l}</button>)}
    </div>
  );
  return (
    <>
      <header className="sk-pagehead"><h1>Profile</h1><p>What you told us when you joined. A changed answer may change your rate.</p></header>
      <div className="sk-card">
        <div className="sk-card-b">
          <FieldRow>
            <Field id="pf-name" label="Name">{(p) => <input {...p} className="sk-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
            <Field id="pf-city" label="City">{(p) => <input {...p} className="sk-input" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} />}</Field>
          </FieldRow>
          <FieldRow>
            <Field id="pf-email" label="Email">{(p) => <input {...p} className="sk-input" value={m.email ?? ''} readOnly disabled />}</Field>
            <Field id="pf-phone" label="WhatsApp number">{(p) => <input {...p} className="sk-input" value={m.phoneE164 ?? ''} readOnly disabled />}</Field>
          </FieldRow>
          <div className="sk-field"><span className="sk-lab">Who are you, mostly?</span>{seg('Who are you, mostly?', f.who, WHO.map((w) => ({ k: w, l: w })), (k) => setF({ ...f, who: k }))}</div>
          <div className="sk-field"><span className="sk-lab">Schools you can introduce in six months</span>{seg('Schools in six months', f.expect, EXPECT, (k) => setF({ ...f, expect: k }))}</div>
          <Field id="pf-areas" label="Cities or areas">{(p) => <input {...p} className="sk-input" value={f.areas} onChange={(e) => setF({ ...f, areas: e.target.value })} />}</Field>
          <Field id="pf-know" label="How you know these schools">{(p) => <textarea {...p} className="sk-input" rows={3} value={f.know} onChange={(e) => setF({ ...f, know: e.target.value })} />}</Field>
          <Field id="pf-schools" label="Schools you have in mind (optional)">{(p) => <input {...p} className="sk-input" value={f.schoolsInMind} onChange={(e) => setF({ ...f, schoolsInMind: e.target.value })} />}</Field>
          <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13.5 }}><input type="checkbox" className="sk-check" checked={f.hasGst} onChange={(e) => setF({ ...f, hasGst: e.target.checked })} /> I have a GST registration</label>
          {err && <span className="sk-state err" role="alert">{err}</span>}
          <div><button className="sk-btn" data-variant="primary" disabled={save.isPending || f.name.trim().length < 2} onClick={() => { setErr(null); save.mutate(); }}>{save.isPending ? 'Saving…' : 'Save'}</button></div>
        </div>
      </div>
    </>
  );
}
