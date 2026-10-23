'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Field, FieldRow, Overlay } from '@/components/ui/kit';
import { PromoterApiError, promoterApi, type PromoterReferral } from '@/lib/promoter-session';

const STUDENTS: { l: string; n: number | null }[] = [{ l: 'Not sure', n: null }, { l: 'Under 300', n: 250 }, { l: '300 – 800', n: 550 }, { l: '800 – 1,500', n: 1150 }, { l: '1,500+', n: 2000 }];

/**
 * Log a referral. Required: the school, its city, the contact's name and
 * phone, and the consent line. Everything else is there for a better
 * first call but never blocks the save.
 */
export function LogReferral({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [f, setF] = useState({ schoolName: '', city: '', area: '', students: '', board: '', contactName: '', contactRole: 'Principal', contactPhone: '', contactEmail: '', planInterest: '', howKnown: '', consent: false });
  const [err, setErr] = useState<{ field?: string; msg: string } | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }));

  const save = useMutation({
    mutationFn: () => promoterApi.post<PromoterReferral>('/promoter/referrals', {
      schoolName: f.schoolName.trim(), city: f.city.trim(), area: f.area.trim() || undefined, studentsApprox: STUDENTS.find((s) => s.l === f.students)?.n ?? undefined, board: f.board || undefined,
      contactName: f.contactName.trim(), contactRole: f.contactRole || undefined, contactPhone: f.contactPhone.trim(), contactEmail: f.contactEmail.trim() || undefined,
      planInterest: f.planInterest || undefined, howKnown: f.howKnown.trim() || undefined, consent: f.consent,
    }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['promoter-referrals'] });
      void qc.invalidateQueries({ queryKey: ['promoter-me'] });
      if (r.status === 'REJECTED') toast.error(r.statusReason || 'This school is already with us.');
      else toast.success(`Saved. Sckools accepts it, then calls ${r.contactName}.`);
      onClose();
      router.push(`/promoter/referrals#${r.id}`);
    },
    onError: (e) => setErr({ field: e instanceof PromoterApiError ? e.field : undefined, msg: e instanceof PromoterApiError ? e.message : 'Could not save. Try again.' }),
  });

  function submit() {
    setErr(null);
    if (f.schoolName.trim().length < 2) return setErr({ field: 'schoolName', msg: 'The school name is needed.' });
    if (f.city.trim().length < 2) return setErr({ field: 'city', msg: 'The city is needed.' });
    if (f.contactName.trim().length < 2) return setErr({ field: 'contactName', msg: 'The contact person is needed.' });
    if (f.contactPhone.replace(/\D/g, '').length < 10) return setErr({ field: 'contactPhone', msg: 'A ten-digit phone for the contact is needed.' });
    if (!f.consent) return setErr({ field: 'consent', msg: 'Tick the consent line: we only call people who expect it.' });
    save.mutate();
  }
  const inv = (k: string) => err?.field === k;

  return (
    <Overlay
      title="Log a referral"
      subtitle="We check it against schools already with us the moment you save."
      onClose={onClose}
      footer={
        <>
          {err ? <span className="sk-state err" role="alert">{err.msg}</span> : <span />}
          <button className="sk-btn" onClick={onClose} disabled={save.isPending}>Cancel</button>
          <button className="sk-btn" data-variant="primary" onClick={submit} disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save referral'}</button>
        </>
      }
    >
      <FieldRow>
        <Field id="lr-school" label="School name" invalid={inv('schoolName')}>{(p) => <input {...p} className="sk-input" value={f.schoolName} onChange={set('schoolName')} placeholder="Green Valley School" autoFocus />}</Field>
        <Field id="lr-city" label="City" invalid={inv('city')}>{(p) => <input {...p} className="sk-input" value={f.city} onChange={set('city')} placeholder="Kota" />}</Field>
      </FieldRow>
      <FieldRow>
        <Field id="lr-area" label="Area (optional)">{(p) => <input {...p} className="sk-input" value={f.area} onChange={set('area')} placeholder="Talwandi" />}</Field>
        <Field id="lr-students" label="Students, roughly">{(p) => <select {...p} className="sk-input" value={f.students} onChange={set('students')}>{STUDENTS.map((s) => <option key={s.l} value={s.l}>{s.l}</option>)}</select>}</Field>
        <Field id="lr-board" label="Board">{(p) => <select {...p} className="sk-input" value={f.board} onChange={set('board')}><option value="">Not sure</option><option>CBSE</option><option>State board</option><option>ICSE</option><option>Other</option></select>}</Field>
      </FieldRow>
      <FieldRow>
        <Field id="lr-contact" label="Contact person" invalid={inv('contactName')}>{(p) => <input {...p} className="sk-input" value={f.contactName} onChange={set('contactName')} placeholder="Mrs Singh" />}</Field>
        <Field id="lr-role" label="Their role">{(p) => <select {...p} className="sk-input" value={f.contactRole} onChange={set('contactRole')}><option>Principal</option><option>Owner / director</option><option>Admin / office</option><option>Trustee</option><option>Teacher</option><option>Other</option></select>}</Field>
      </FieldRow>
      <FieldRow>
        <Field id="lr-phone" label="Phone" invalid={inv('contactPhone')}>{(p) => <input {...p} className="sk-input" type="tel" inputMode="tel" value={f.contactPhone} onChange={set('contactPhone')} placeholder="98765 43210" />}</Field>
        <Field id="lr-email" label="Email (optional)" invalid={inv('contactEmail')}>{(p) => <input {...p} className="sk-input" type="email" value={f.contactEmail} onChange={set('contactEmail')} placeholder="principal@school.in" />}</Field>
      </FieldRow>
      <Field id="lr-plan" label="Which plan might they want?">{(p) => <select {...p} className="sk-input" value={f.planInterest} onChange={set('planInterest')}><option value="">Not sure</option><option>Basic</option><option>Standard</option><option>Pro</option></select>}</Field>
      <Field id="lr-how" label="How do you know them? (optional)" hint="One line helps the first call: who you are to them, when you last spoke.">{(p) => <textarea {...p} className="sk-input" rows={3} value={f.howKnown} onChange={set('howKnown')} placeholder="My daughter studies there; I spoke to the principal at the PTA on 20 Oct." />}</Field>
      <label className="sk-field" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13.5, color: inv('consent') ? 'var(--sk-bad)' : undefined }}>
        <input type="checkbox" className="sk-check" checked={f.consent} onChange={set('consent')} aria-invalid={inv('consent') || undefined} style={{ marginTop: 2 }} />
        <span>This person knows I am sharing their number and agrees to a call from Sckools.</span>
      </label>
    </Overlay>
  );
}
