'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

export interface PayDetails {
  bankAccount: string | null; bankIfsc: string | null; bankName: string | null;
  pan: string | null; uan: string | null; esiNumber: string | null;
  onPay: boolean;
  /** What the school cannot pay or file without, named rather than counted. */
  missing: string[];
}

/** The same shapes the server enforces, so a typo is caught before a round trip. */
const RE = {
  account: /^[0-9]{9,18}$/,
  ifsc: /^[A-Z]{4}0[A-Z0-9]{6}$/,
  pan: /^[A-Z]{5}[0-9]{4}[A-Z]$/,
  uan: /^[0-9]{12}$/,
};

/**
 * WHERE MY MONEY GOES — the employee's own copy of the details the office
 * needs, and the office's copy of the same thing. One card, two callers.
 *
 * `endpoint` is `/me/pay/details` for a person editing their own, and
 * `/payroll/people/:kind/:id/details` for an admin editing someone's. They
 * write the SAME rows, so whichever of them types it, the other sees it on
 * their next load — there is no second copy of this anywhere.
 *
 * Saving does NOT create a new pay row. A raise is versioned because June must
 * keep the figure June was run on; a bank account is not a pay term, and money
 * paid today goes to the account the person has today.
 */
export function PayDetailsCard({
  endpoint,
  title = 'Where my pay goes',
  invalidate = [],
}: {
  endpoint: string;
  title?: string;
  invalidate?: string[][];
}) {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const uid = endpoint.replace(/[^a-z0-9]+/gi, '-');
  const q = useQuery({ queryKey: ['pay-details', endpoint], enabled: !!host, queryFn: () => api.get<PayDetails>(endpoint) });

  const [form, setForm] = useState({ bankAccount: '', bankIfsc: '', bankName: '', pan: '', uan: '' });
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the server's answer in once, and never again over something typed.
  useEffect(() => {
    if (!q.data || dirty) return;
    setForm({
      bankAccount: q.data.bankAccount ?? '', bankIfsc: q.data.bankIfsc ?? '', bankName: q.data.bankName ?? '',
      pan: q.data.pan ?? '', uan: q.data.uan ?? '',
    });
  }, [q.data, dirty]);

  const save = useMutation({
    mutationFn: () => api.post<PayDetails>(endpoint, form),
    onSuccess: (d) => {
      setError(null); setDirty(false); setSaved(true);
      qc.setQueryData(['pay-details', endpoint], d);
      // The office's screens count on this too: the month's "no bank account"
      // exception must clear the moment a person fills theirs in.
      for (const key of invalidate) void qc.invalidateQueries({ queryKey: key });
    },
    onError: (e: Error) => { setError(e.message); setSaved(false); },
  });

  const set = (k: keyof typeof form) => (v: string) => {
    setForm({ ...form, [k]: k === 'bankIfsc' || k === 'pan' ? v.toUpperCase() : v });
    setDirty(true); setSaved(false);
  };

  const bad = (k: keyof typeof RE, v: string) => v.trim() !== '' && !RE[k].test(v.trim());
  const pairBroken = !!form.bankAccount.trim() !== !!form.bankIfsc.trim();
  const blocked = bad('account', form.bankAccount) || bad('ifsc', form.bankIfsc)
    || bad('pan', form.pan) || bad('uan', form.uan) || pairBroken;

  if (q.isError) return null;
  const d = q.data;

  return (
    <div className="sk-card">
      <div className="sk-card-h">
        <h3>{title}</h3>
        {d && d.missing.length === 0 ? <span className="sk-pill" data-tone="good">Complete</span> : null}
      </div>
      <div className="sk-card-b grid gap-3">
        {q.isPending ? <p className="sk-state">Loading…</p> : null}

        {d && !d.onPay ? (
          <p className="sk-state">
            Your pay has not been set up yet. Once the office puts you on a grade, your bank details
            can be saved here.
          </p>
        ) : null}

        {d && d.onPay ? (
          <>
            {d.missing.length > 0 ? (
              <div
                style={{
                  borderLeft: '3px solid var(--sk-amber)', background: 'var(--sk-amber-tint)',
                  padding: '10px 12px', borderRadius: '0 9px 9px 0', fontSize: 12.5, color: 'var(--sk-ink-2)',
                }}
              >
                Still needed: {d.missing.join(', ')}. Without these the school cannot pay you by bank
                transfer or file your tax correctly.
              </div>
            ) : null}

            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))' }}>
              <Field
                id={`${uid}-bankAccount`} label="Bank account number" value={form.bankAccount} onChange={set('bankAccount')}
                inputMode="numeric" maxLength={18} placeholder="30123456789"
                bad={bad('account', form.bankAccount)} hint="9 to 18 digits, exactly as the passbook prints it."
              />
              <Field
                id={`${uid}-bankIfsc`} label="IFSC" value={form.bankIfsc} onChange={set('bankIfsc')}
                maxLength={11} placeholder="SBIN0001234"
                bad={bad('ifsc', form.bankIfsc)} hint="Four letters, a zero, then six characters."
              />
              <Field
                id={`${uid}-bankName`} label="Bank name" value={form.bankName} onChange={set('bankName')}
                maxLength={60} placeholder="State Bank of India" hint="Optional — it helps the office spot a wrong IFSC."
              />
              <Field
                id={`${uid}-pan`} label="PAN" value={form.pan} onChange={set('pan')}
                maxLength={10} placeholder="ABCDE1234F"
                bad={bad('pan', form.pan)} hint="Without it, tax is deducted at the higher rate."
              />
              <Field
                id={`${uid}-uan`} label="Provident fund number (UAN)" value={form.uan} onChange={set('uan')}
                inputMode="numeric" maxLength={12} placeholder="100123456789"
                bad={bad('uan', form.uan)} hint="Twelve digits. Optional if you are not a member."
              />
            </div>

            {pairBroken ? (
              <p className="sk-state" role="alert" style={{ color: 'var(--sk-bad)' }}>
                An account number needs its IFSC, and an IFSC needs its account — fill both, or clear both.
              </p>
            ) : null}
            {error ? <p className="sk-state" role="alert" style={{ color: 'var(--sk-bad)' }}>{error}</p> : null}

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button" className="sk-btn sk-press" data-variant="primary"
                disabled={save.isPending || blocked || !dirty}
                onClick={() => save.mutate()}
              >
                {save.isPending ? 'Saving…' : 'Save'}
              </button>
              {saved ? <span className="sk-muted" style={{ fontSize: 12.5 }}>Saved. The office sees this straight away.</span> : null}
              {!saved && dirty ? <span className="sk-muted" style={{ fontSize: 12.5 }}>Not saved yet.</span> : null}
            </div>

            <p className="sk-muted" style={{ fontSize: 12 }}>
              You can change these whenever you like. A change applies to money paid from now on —
              it does not alter a payslip already issued.
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The hint is DESCRIBED BY the input, not part of its label.
 *
 * Nested inside the `<label>` it became part of the accessible name — a screen
 * reader announced "Bank account number 9 to 18 digits, exactly as the
 * passbook prints it" as the field's name. `aria-describedby` is what a hint
 * is for: read after the name, and skippable.
 */
function Field({ id, label, value, onChange, hint, bad, ...rest }: {
  id: string; label: string; value: string; onChange: (v: string) => void; hint?: string; bad?: boolean;
  inputMode?: 'numeric'; maxLength?: number; placeholder?: string;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="grid gap-1" style={{ minWidth: 0 }}>
      <label className="sk-lab" htmlFor={id}>{label}</label>
      <input
        id={id}
        className="sk-input"
        style={{ width: '100%', boxSizing: 'border-box', borderColor: bad ? 'var(--sk-bad)' : undefined }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={bad || undefined}
        aria-describedby={hintId}
        {...rest}
      />
      {hint ? <span id={hintId} className="sk-muted" style={{ fontSize: 11.5, color: bad ? 'var(--sk-bad)' : undefined }}>{hint}</span> : null}
    </div>
  );
}
