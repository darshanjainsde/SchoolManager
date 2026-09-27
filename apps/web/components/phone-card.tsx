'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { QueryError } from '@/components/ui/query-state';

/**
 * "My WhatsApp number" — the one card an admin, a teacher or a staff member
 * uses to prove a number is theirs. Three states, in the order they happen:
 * nothing yet (type a number → Send code), a code on its way (type it →
 * Verify), verified (change or remove). Nothing is ever sent to a number
 * that has not been verified, so the copy says exactly what verifying buys:
 * requests and notices on WhatsApp, with buttons that act.
 */
interface PhoneStatus {
  phone: string | null;
  verified: boolean;
  verifiedAt: string | null;
  pending: string | null;
  pendingUntil: string | null;
  platformReady: boolean;
}

export function PhoneCard({ role }: { role: 'admin' | 'teacher' | 'staff' }) {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [editing, setEditing] = useState(false);
  const key = ['me-phone', host];

  const q = useQuery({ queryKey: key, enabled: !!host, retry: false, queryFn: () => api.get<PhoneStatus>('/me/phone') });
  const request = useMutation({
    mutationFn: (p: string) => api.post<{ ok: boolean; pending: string }>('/me/phone/request', { phone: p }),
    onSuccess: (r) => { toast.success(`Code sent to ${r.pending} on WhatsApp.`); setCode(''); qc.invalidateQueries({ queryKey: key }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const verify = useMutation({
    mutationFn: (c: string) => api.post<PhoneStatus>('/me/phone/verify', { code: c }),
    onSuccess: (s) => { qc.setQueryData(key, s); setEditing(false); setPhone(''); setCode(''); toast.success('Verified — your WhatsApp is connected.'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const clear = useMutation({
    mutationFn: () => api.del<PhoneStatus>('/me/phone'),
    onSuccess: (s) => { qc.setQueryData(key, s); toast.success('Removed. Nothing more will be sent to WhatsApp for you.'); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isError) return <QueryError error={q.error} onRetry={q.refetch} className="py-6" />;
  const d = q.data;
  const what = role === 'admin'
    ? 'Leave requests and other things that need your decision arrive here with Approve / Reject buttons that act — the same as the Requests tab.'
    : role === 'teacher'
      ? 'Your leave decisions and the classes you are asked to cover arrive here. Without a verified number they still reach the app and your email.'
      : 'Notices for you arrive here as well as in the app.';

  return (
    <div className="sk-card" data-testid="phone-card">
      <div className="sk-card-h">
        <h3>My WhatsApp number</h3>
        {d ? (
          <span className="sk-pill" data-tone={d.verified ? 'good' : d.pending ? 'warn' : 'neutral'} data-testid="phone-state">
            {d.verified ? `Verified · ${d.phone}` : d.pending ? `Code sent to ${d.pending}` : 'Not set'}
          </span>
        ) : null}
      </div>
      <div className="sk-card-b">
        {q.isLoading || !d ? <p className="sk-state">Checking…</p> : (
          <>
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--sk-ink-2)' }}>{what}</p>
            {!d.platformReady ? <p className="sk-state" data-testid="phone-platform-off">WhatsApp is not connected on the platform yet — you can verify once it is.</p> : null}

            {d.verified && !editing ? (
              <div className="ph-row">
                <span className="ph-num">{d.phone}</span>
                <button type="button" className="sk-btn ghost" onClick={() => setEditing(true)}>Change</button>
                <button type="button" className="sk-btn ghost" onClick={() => clear.mutate()} disabled={clear.isPending}>Remove</button>
              </div>
            ) : (
              <form className="ph-form" onSubmit={(e) => { e.preventDefault(); if (phone.trim()) request.mutate(phone.trim()); }}>
                <label htmlFor="ph-number">WhatsApp number</label>
                <div className="ph-row">
                  <input id="ph-number" className="sk-input" inputMode="tel" autoComplete="tel" placeholder="98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={!d.platformReady || request.isPending} />
                  <button type="submit" className="sk-btn" data-variant="primary" disabled={!d.platformReady || request.isPending || !phone.trim()}>
                    {request.isPending ? 'Sending…' : d.pending ? 'Send again' : 'Send code'}
                  </button>
                  {editing ? <button type="button" className="sk-btn ghost" onClick={() => { setEditing(false); setPhone(''); }}>Cancel</button> : null}
                </div>
              </form>
            )}

            {d.pending && !d.verified ? (
              <form className="ph-form" data-testid="phone-verify" onSubmit={(e) => { e.preventDefault(); if (code.trim().length === 6) verify.mutate(code.trim()); }}>
                <label htmlFor="ph-code">The 6-digit code from WhatsApp</label>
                <div className="ph-row">
                  <input id="ph-code" className="sk-input ph-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="482911" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
                  <button type="submit" className="sk-btn" data-variant="primary" disabled={verify.isPending || code.trim().length !== 6}>{verify.isPending ? 'Checking…' : 'Verify'}</button>
                </div>
                <div className="ph-hint">Sent to {d.pending}. It works for 10 minutes; ask for another after a minute if it does not arrive.</div>
              </form>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
