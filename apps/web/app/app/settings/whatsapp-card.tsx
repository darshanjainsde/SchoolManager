'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { QueryError } from '@/components/ui/query-state';

/**
 * The school's WhatsApp switch. Ordered by what the office needs to know:
 * is it on, does it work (a test send to their own phone), and what went
 * out this month with its receipts. The sender number and the template
 * list are shown so the fallback is never a mystery.
 */
interface Delivery {
  id: string;
  phone: string;
  kind: string;
  status: 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
  blame?: 'SETUP' | 'RECIPIENT' | 'CONTENT' | 'UNKNOWN' | null;
  advice?: string | null;
  error: string | null;
  createdAt: string;
  deliveredAt: string | null;
  readAt: string | null;
}
interface WhatsAppSettingsResponse {
  settings: { enabled: boolean; phoneNumberId: string | null };
  platform: { configured: boolean; senderPhoneNumberId: string | null; problem?: string | null };
  templates: { kind: string; name: string; body: string }[];
  thisMonth: Record<string, number>;
  recent: Delivery[];
}

const KIND_WORDS: Record<string, string> = {
  TEST: 'Test message', ABSENCE_NOTICE: 'Absent today', ANNOUNCEMENT: 'Announcement', DIARY_REMARK: 'Diary remark',
  LOW_ATTENDANCE: 'Low attendance', TEST_SCHEDULED: 'Test scheduled', TEST_REMINDER: 'Test reminder', RESULTS_PUBLISHED: 'Results',
};
const STATUS_TONE: Record<Delivery['status'], 'neutral' | 'info' | 'good' | 'bad'> = { QUEUED: 'neutral', SENT: 'info', DELIVERED: 'good', READ: 'good', FAILED: 'bad' };
const STATUS_WORD: Record<Delivery['status'], string> = { QUEUED: 'queued', SENT: 'sent', DELIVERED: 'delivered', READ: 'read', FAILED: 'failed' };
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });

export function WhatsAppCard() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const [testTo, setTestTo] = useState('');

  const q = useQuery({ queryKey: ['whatsapp-settings', host], enabled: !!host, retry: false, queryFn: () => api.get<WhatsAppSettingsResponse>('/manage/whatsapp-settings') });

  const update = useMutation({
    mutationFn: (enabled: boolean) => api.put<WhatsAppSettingsResponse>('/manage/whatsapp-settings', { enabled }),
    onSuccess: (data) => { qc.setQueryData(['whatsapp-settings', host], data); toast.success(data.settings.enabled ? 'WhatsApp is on for your families.' : 'WhatsApp is off.'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const test = useMutation({
    mutationFn: (to: string) => api.post<{ ok: boolean; phone: string }>('/manage/whatsapp-settings/test', { to }),
    onSuccess: (r) => { toast[r.ok ? 'success' : 'error'](r.ok ? `Sent to ${r.phone}. Check the phone.` : `Meta refused the send to ${r.phone} — see the list below.`); qc.invalidateQueries({ queryKey: ['whatsapp-settings', host] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isError) return <QueryError error={q.error} onRetry={q.refetch} className="py-6" />;
  const d = q.data;
  const on = d?.settings.enabled ?? false;
  const live = on && (d?.platform.configured ?? false);
  const sent = d ? Object.entries(d.thisMonth).reduce((n, [, c]) => n + c, 0) : 0;
  const read = d?.thisMonth.READ ?? 0;
  const failed = d?.thisMonth.FAILED ?? 0;
  // Most failures are ours — a lapsed token, a wrong id, a template Meta has
  // not approved. A school can do nothing about any of those.
  const ours = (d?.recent ?? []).some((r) => r.blame === 'SETUP' || r.blame === 'CONTENT');

  return (
    <div className="sk-card" data-testid="whatsapp-card">
      <div className="sk-card-h">
        <h3>WhatsApp</h3>
        {d ? (
          <span className="sk-pill" data-tone={live ? 'good' : on ? 'warn' : 'neutral'} data-testid="whatsapp-state">
            {live ? 'On — families receive WhatsApp' : on ? 'On, waiting for the platform number' : 'Off'}
          </span>
        ) : null}
      </div>
      <div className="sk-card-b">
        {q.isLoading || !d ? <p className="sk-state">Checking WhatsApp…</p> : (
          <>
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--sk-ink-2)' }}>
              Every notice this school sends — absences, remarks, results, announcements — also goes to the family&rsquo;s registered
              phone on WhatsApp, from {d.settings.phoneNumberId ? 'your own number' : 'the Sckools number'}. Each message names your school.
              {!d.platform.configured ? ' The platform number is not connected yet; nothing goes out until it is.' : ''}
            </p>

            {/* Not "not configured" — WHICH thing is wrong. A school staring
                at a dead switch cannot tell a missing token from an id pasted
                into the wrong box, and both look identical from here. */}
            {d.platform.problem ? (
              <p className="sk-state err" data-testid="wa-problem" style={{ marginTop: 6 }}>
                {d.platform.problem}
              </p>
            ) : null}

            <label className="sk-lab" style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', textTransform: 'none', letterSpacing: 0, fontSize: 13.5, color: 'var(--sk-ink)' }}>
              <input type="checkbox" checked={on} disabled={update.isPending} onChange={(e) => update.mutate(e.target.checked)} data-testid="whatsapp-toggle" style={{ width: 18, height: 18, accentColor: 'var(--sk-brand)' }} />
              Send notices to families on WhatsApp
            </label>

            <div className="wa-figs" data-testid="whatsapp-month">
              <div className="f"><div className="k">This month</div><div className="n">{sent}</div><div className="h">messages</div></div>
              <div className="f" data-tone={read ? 'good' : undefined}><div className="k">Read</div><div className="n">{read}</div><div className="h">{sent ? `${Math.round((100 * read) / sent)}% of sent` : '—'}</div></div>
              <div className="f" data-tone={failed ? 'bad' : undefined}>
                <div className="k">Failed</div><div className="n">{failed}</div>
                {/* It counted MESSAGES and called them "numbers to fix", so
                    six failures from an expired token of ours read as six
                    parents to ring. Say whose problem it is instead. */}
                <div className="h">{failed ? (ours ? 'a setup problem, not the families' : 'numbers to check') : 'none'}</div>
              </div>
            </div>

            <form className="wa-test" onSubmit={(e) => { e.preventDefault(); if (testTo.trim()) test.mutate(testTo.trim()); }}>
              <label htmlFor="wa-test-to">Send a test to</label>
              <input id="wa-test-to" className="sk-input" placeholder="98765 43210" value={testTo} onChange={(e) => setTestTo(e.target.value)} inputMode="tel" autoComplete="off" disabled={!d.platform.configured} />
              <button type="submit" className="sk-btn" data-variant="primary" disabled={!d.platform.configured || test.isPending || !testTo.trim()}>
                {test.isPending ? 'Sending…' : 'Send test'}
              </button>
            </form>

            {d.recent.length ? (
              <div className="wa-log" data-testid="whatsapp-recent">
                <div className="sk-lab">Recent</div>
                {d.recent.map((r) => (
                  <div className="row" key={r.id}>
                    <span className="t">{when(r.createdAt)}</span>
                    <span className="k">{KIND_WORDS[r.kind] ?? r.kind}</span>
                    <span className="p">{r.phone}</span>
                    <span className="sk-pill" data-tone={STATUS_TONE[r.status]} title={r.error ?? undefined}>{STATUS_WORD[r.status]}{r.status === 'READ' && r.readAt ? ` ${when(r.readAt).split(', ')[1] ?? ''}` : ''}</span>
                    {r.error ? (
                      <span className="e">
                        {r.error}
                        {/* Meta's own words are the evidence; this is what to
                            DO about them. A school reading "Object with ID …
                            does not exist" has no way to know it is ours. */}
                        {r.advice ? <em style={{ display: 'block', fontStyle: 'normal', opacity: 0.8 }}>{r.advice}</em> : null}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="sk-state" data-testid="whatsapp-empty">Nothing sent yet. Turn it on, or send yourself a test.</p>
            )}

            <details className="wa-tpl">
              <summary>The {d.templates.length} messages families can receive</summary>
              {d.templates.map((t) => (
                <div className="row" key={t.kind}><b>{KIND_WORDS[t.kind] ?? t.kind}</b><span>{t.body}</span></div>
              ))}
            </details>
          </>
        )}
      </div>
    </div>
  );
}
