'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { QueryError } from '@/components/ui/query-state';
import { Figure, Figures, Note, Overlay } from '@/components/ui/kit';
import { SettingsCard, SettingsSection } from '../section';
import { messageWords, whenIst } from './labels';

/**
 * WhatsApp and the phone, on the Notifications tab: is it on, does it work
 * (a test to the office's own phone), and — only when asked — what went out
 * with its receipts, and the exact wording families receive. SMS is stated
 * as it is: sign-in codes only.
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
export interface WhatsAppSettingsResponse {
  settings: { enabled: boolean; phoneNumberId: string | null };
  platform: { configured: boolean; senderPhoneNumberId: string | null; problem?: string | null };
  templates: { kind: string; name: string; body: string }[];
  thisMonth: Record<string, number>;
  recent: Delivery[];
}

const STATUS_TONE: Record<Delivery['status'], 'neutral' | 'info' | 'good' | 'bad'> = { QUEUED: 'neutral', SENT: 'info', DELIVERED: 'good', READ: 'good', FAILED: 'bad' };
const STATUS_WORD: Record<Delivery['status'], string> = { QUEUED: 'queued', SENT: 'sent', DELIVERED: 'delivered', READ: 'read', FAILED: 'failed' };

/** The month in numbers, shared by the section, the overview tile and the log. */
export function whatsAppMonth(d: WhatsAppSettingsResponse | undefined) {
  const sent = d ? Object.values(d.thisMonth).reduce((n, c) => n + c, 0) : 0;
  const read = d?.thisMonth.READ ?? 0;
  const failed = d?.thisMonth.FAILED ?? 0;
  // Most failures are ours — a lapsed token, a wrong id, wording Meta has not
  // approved. A school can do nothing about any of those.
  const ours = (d?.recent ?? []).some((r) => r.blame === 'SETUP' || r.blame === 'CONTENT');
  return { sent, read, failed, ours, pct: sent ? Math.round((100 * read) / sent) : null };
}

export function whatsAppState(d: WhatsAppSettingsResponse | undefined) {
  const on = d?.settings.enabled ?? false;
  const live = on && (d?.platform.configured ?? false);
  return {
    on,
    live,
    tone: live ? 'good' : on ? 'warn' : 'neutral',
    text: live ? 'On — families receive WhatsApp' : on ? 'On, waiting for the platform number' : 'Off',
  } as const;
}

export function useWhatsAppSettings() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const q = useQuery({
    queryKey: ['whatsapp-settings', host],
    enabled: !!host,
    retry: false,
    queryFn: () => api.get<WhatsAppSettingsResponse>('/manage/whatsapp-settings'),
  });
  return { q, api, host };
}

export function WhatsAppSettings() {
  const { q, api, host } = useWhatsAppSettings();
  const qc = useQueryClient();
  const [testTo, setTestTo] = useState('');
  const [open, setOpen] = useState<null | 'log' | 'wording'>(null);

  const update = useMutation({
    mutationFn: (enabled: boolean) => api.put<WhatsAppSettingsResponse>('/manage/whatsapp-settings', { enabled }),
    onSuccess: (data) => {
      qc.setQueryData(['whatsapp-settings', host], data);
      toast.success(data.settings.enabled ? 'WhatsApp is on for your families.' : 'WhatsApp is off.');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const test = useMutation({
    mutationFn: (to: string) => api.post<{ ok: boolean; phone: string }>('/manage/whatsapp-settings/test', { to }),
    onSuccess: (r) => {
      toast[r.ok ? 'success' : 'error'](r.ok ? `Sent to ${r.phone}. Check the phone.` : `WhatsApp refused the send to ${r.phone}. The delivery log says why.`);
      void qc.invalidateQueries({ queryKey: ['whatsapp-settings', host] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isError) {
    return (
      <SettingsSection title="WhatsApp" testId="whatsapp-card">
        <SettingsCard><QueryError error={q.error} onRetry={q.refetch} /></SettingsCard>
      </SettingsSection>
    );
  }
  const d = q.data;
  const state = whatsAppState(d);
  const month = whatsAppMonth(d);

  return (
    <>
      <SettingsSection
        title="WhatsApp"
        hint="School messages also go to each person's verified phone on WhatsApp, and every message names your school."
        testId="whatsapp-card"
        aside={d ? <span className="sk-pill" data-tone={state.tone} data-testid="whatsapp-state">{state.text}</span> : null}
      >
        <SettingsCard>
          {q.isLoading || !d ? <p className="sk-state">Checking WhatsApp…</p> : (
            <>
              {/* WHICH thing is wrong, not just "not configured". */}
              {d.platform.problem ? <Note tone="bad"><span data-testid="wa-problem">{d.platform.problem}</span></Note> : null}
              {!d.platform.configured && !d.platform.problem ? (
                <Note>The platform number is not connected yet. Nothing goes out until it is.</Note>
              ) : null}
              <label className="sk-setline" style={{ cursor: 'pointer', justifyContent: 'flex-start' }}>
                <input type="checkbox" checked={state.on} disabled={update.isPending} onChange={(e) => update.mutate(e.target.checked)}
                  data-testid="whatsapp-toggle" style={{ width: 20, height: 20, accentColor: 'var(--sk-brand)', flex: 'none' }} />
                <span className="txt"><b>Send school messages on WhatsApp</b><br />
                  From {d.settings.phoneNumberId ? 'your own number' : 'the Sckools number'}.</span>
              </label>
              <form className="sk-field" onSubmit={(e) => { e.preventDefault(); if (testTo.trim()) test.mutate(testTo.trim()); }}>
                <label htmlFor="wa-test-to" className="sk-lab">Send a test to</label>
                <div className="sk-settest">
                  <input id="wa-test-to" className="sk-input" placeholder="e.g. 10-digit mobile" value={testTo}
                    onChange={(e) => setTestTo(e.target.value)} inputMode="tel" autoComplete="off" disabled={!d.platform.configured} />
                  <button type="submit" className="sk-btn" disabled={!d.platform.configured || test.isPending || !testTo.trim()}>
                    {test.isPending ? 'Sending…' : 'Send test'}
                  </button>
                </div>
              </form>
              <div className="sk-setline" data-testid="whatsapp-month">
                <span className="txt">
                  <b>{month.sent}</b> {month.sent === 1 ? 'message' : 'messages'} this month
                  {month.pct !== null ? <> · {month.pct}% read</> : null}
                  {month.failed ? <> · <b style={{ color: 'var(--sk-bad)' }}>{month.failed} failed</b>{month.ours ? ' (a setup problem, not the families)' : ''}</> : null}
                </span>
                <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" className="sk-btn" onClick={() => setOpen('wording')}>Message wording</button>
                  <button type="button" className="sk-btn" onClick={() => setOpen('log')} data-testid="whatsapp-open-log">View delivery log</button>
                </span>
              </div>
            </>
          )}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="SMS" hint="Text messages to phones." testId="sms-section"
        aside={<span className="sk-pill" data-tone="neutral">Sign-in codes only</span>}>
        <SettingsCard>
          <p className="sk-setline" style={{ margin: 0 }}>
            <span className="txt">SMS is used only to send sign-in codes. School messages go by the app, WhatsApp and email.</span>
          </p>
        </SettingsCard>
      </SettingsSection>

      {open === 'log' && d ? (
        <Overlay title="WhatsApp delivery log" subtitle="This month, newest first" onClose={() => setOpen(null)}>
          <Figures count={3}>
            <Figure value={month.sent} label="Messages this month" />
            <Figure value={month.read} label={month.pct !== null ? `Read · ${month.pct}% of sent` : 'Read'} />
            <Figure value={month.failed} label={month.failed ? (month.ours ? 'Failed · setup problem' : 'Failed · numbers to check') : 'Failed · none'} />
          </Figures>
          {d.recent.length ? (
            <div className="sk-dlog" data-testid="whatsapp-recent">
              {d.recent.map((r) => (
                <div className="row" key={r.id}>
                  <span className="k">{messageWords(r.kind)}</span>
                  <span className="m">{r.phone} · {whenIst(r.createdAt)}</span>
                  <span className="st sk-pill" data-tone={STATUS_TONE[r.status]}>
                    {STATUS_WORD[r.status]}{r.status === 'READ' && r.readAt ? ` ${whenIst(r.readAt).split(', ')[1] ?? ''}` : ''}
                  </span>
                  {r.error ? (
                    <span className="e">
                      {r.error}
                      {/* Meta's words are the evidence; this is what to DO. */}
                      {r.advice ? <em>{r.advice}</em> : null}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="sk-state" data-testid="whatsapp-empty">Nothing sent yet. Turn it on, or send yourself a test.</p>
          )}
        </Overlay>
      ) : null}

      {open === 'wording' && d ? (
        <Overlay title="Message wording" subtitle={`The ${d.templates.length} messages WhatsApp has approved, exactly as people receive them`} onClose={() => setOpen(null)}>
          {d.templates.map((t) => (
            <div className="sk-dlog-tpl" key={t.kind}><b>{messageWords(t.kind)}</b><span>{t.body}</span></div>
          ))}
        </Overlay>
      ) : null}
    </>
  );
}
