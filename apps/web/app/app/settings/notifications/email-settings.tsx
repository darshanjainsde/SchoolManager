'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { QueryError } from '@/components/ui/query-state';
import { Field, FieldRow, Figure, Figures, Note, Overlay } from '@/components/ui/kit';
import { SettingsActions, SettingsCard, SettingsSection } from '../section';
import { messageWords, whenIst } from './labels';

/**
 * Email, on the Notifications tab. Ordered by what a school needs: how its mail
 * LOOKS (every school gets this, configured or not), then the optional "send
 * from our own mailbox", then the receipts. The receipts and the preview open
 * behind a button — they used to sit on the page and grow it by 20+ rows.
 */

type Template = 'CLASSIC' | 'BANNER' | 'MINIMAL';

const TEMPLATE_COPY: Record<Template, { name: string; hint: string }> = {
  CLASSIC: { name: 'Classic', hint: 'Colour band, crest and name. The default.' },
  BANNER: { name: 'Banner', hint: 'Your colour fills the header, name reversed out.' },
  MINIMAL: { name: 'Minimal', hint: 'A quiet rule and small logo. Reads like a note.' },
};

export interface EmailSettingsResponse {
  settings: {
    template: Template;
    senderName: string | null;
    replyTo: string | null;
    accentColor: string | null;
    logoAssetId: string | null;
    footerLines: string[];
    /** The master switch. Missing (an older API) reads as on. */
    enabled?: boolean;
  };
  effective: {
    schoolName: string;
    senderName: string;
    fromAddress: string;
    replyTo: string | null;
    accent: string;
    logoUrl: string | null;
    template: Template;
    footerLines: string[];
    usingCustomSender: boolean;
    showPlatformCredit: boolean;
  };
  deliveries: {
    thisMonth: Record<string, number>;
    recent: { id: string; to: string; kind: string; provider: string; status: 'QUEUED' | 'SENT' | 'DELIVERED' | 'BOUNCED' | 'COMPLAINED' | 'FAILED' | 'SUPPRESSED'; error: string | null; createdAt: string; deliveredAt: string | null; bouncedAt: string | null }[];
    suppressed: { email: string; reason: string; detail: string | null; createdAt: string }[];
  };
  sender: {
    mode: 'DEFAULT' | 'CUSTOM';
    status: 'UNVERIFIED' | 'VERIFIED' | 'FAILING';
    fromAddress: string | null;
    smtpHost: string | null;
    smtpPort: number | null;
    smtpUser: string | null;
    hasPassword: boolean;
    verifiedAt: string | null;
    lastError: string | null;
    lastErrorAt: string | null;
    canConfigure: boolean;
  };
  previews: { template: Template; html: string }[];
}

/** Is the school's email switched on? Missing reads as on — the default. */
export function emailOn(d: EmailSettingsResponse | undefined): boolean {
  return d?.settings.enabled !== false;
}

/** The month in three numbers, shared by the section line, the overview tile and the log. */
export function emailMonth(d: EmailSettingsResponse | undefined) {
  const m = d?.deliveries?.thisMonth ?? {};
  const total = Object.values(m).reduce((n, c) => n + c, 0);
  const delivered = m.DELIVERED ?? 0;
  const bad = (m.BOUNCED ?? 0) + (m.COMPLAINED ?? 0) + (m.FAILED ?? 0) + (m.SUPPRESSED ?? 0);
  return { total, delivered, bad, pct: total ? Math.round((100 * delivered) / total) : null };
}

export function useEmailSettings() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const q = useQuery({
    queryKey: ['email-settings'],
    enabled: !!host,
    queryFn: () => api.get<EmailSettingsResponse>('/manage/email-settings'),
  });
  return { q, api, host };
}

export function EmailSettings() {
  const { q, api, host } = useEmailSettings();
  const qc = useQueryClient();

  const [template, setTemplate] = useState<Template>('CLASSIC');
  const [senderName, setSenderName] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [accent, setAccent] = useState('');
  const [footer, setFooter] = useState('');
  const [testTo, setTestTo] = useState('');
  const [fromAddress, setFromAddress] = useState('');
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [open, setOpen] = useState<null | 'preview' | 'sender' | 'log'>(null);

  // Seed the form from the server exactly once per load, so typing is never
  // clobbered by a refetch mid-edit.
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (!q.data || seeded) return;
    setTemplate(q.data.settings.template);
    setSenderName(q.data.settings.senderName ?? '');
    setReplyTo(q.data.settings.replyTo ?? '');
    setAccent(q.data.settings.accentColor ?? '');
    setFooter(q.data.settings.footerLines.join('\n'));
    setFromAddress(q.data.sender.fromAddress ?? '');
    setSmtpHost(q.data.sender.smtpHost ?? '');
    setSmtpPort(String(q.data.sender.smtpPort ?? 587));
    setSmtpUser(q.data.sender.smtpUser ?? '');
    setSeeded(true);
  }, [q.data, seeded]);

  // The preview measures its own box and scales the 600px email to fit. A
  // CALLBACK ref: the box only exists once the preview panel opens.
  const [previewScale, setPreviewScale] = useState(1);
  const observerRef = useRef<ResizeObserver | null>(null);
  const previewBoxRef = useCallback((el: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) setPreviewScale(Math.min(1, w / 600));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    observerRef.current = ro;
  }, []);
  useEffect(() => () => observerRef.current?.disconnect(), []);

  const save = useMutation({
    mutationFn: () =>
      api.put<EmailSettingsResponse>('/manage/email-settings', {
        template,
        senderName,
        replyTo,
        accentColor: accent,
        footerLines: footer.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 4),
      }),
    onSuccess: (d) => {
      qc.setQueryData(['email-settings'], d);
      toast.success('Letterhead saved. Every email now uses it.');
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const saveSender = useMutation({
    mutationFn: () =>
      api.put<EmailSettingsResponse>('/manage/email-settings/sender', {
        fromAddress,
        smtpHost,
        smtpPort: Number(smtpPort),
        smtpUser: smtpUser || undefined,
        ...(smtpPass ? { smtpPass } : {}),
      }),
    onSuccess: (d) => {
      qc.setQueryData(['email-settings'], d);
      setSmtpPass('');
      toast.success('Saved. Now send a test to check it before it goes live.');
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const verify = useMutation({
    mutationFn: (to: string) =>
      api.post<EmailSettingsResponse & { ok: boolean; error?: string }>('/manage/email-settings/sender/verify', { to }),
    onSuccess: (d) => {
      qc.setQueryData(['email-settings'], d);
      if (d.ok) toast.success('Checked. Your school now sends from its own address.');
      else toast.error(`Could not send: ${d.error}`);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const disable = useMutation({
    mutationFn: () => api.post<EmailSettingsResponse>('/manage/email-settings/sender/disable', {}),
    onSuccess: (d) => {
      qc.setQueryData(['email-settings'], d);
      setSmtpPass('');
      toast.success('Back to sending through Sckools with your branding.');
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const toggle = useMutation({
    mutationFn: (enabled: boolean) => api.put<EmailSettingsResponse>('/manage/email-settings', { enabled }),
    onSuccess: (d) => {
      qc.setQueryData(['email-settings'], d);
      toast.success(emailOn(d) ? 'Email is on. School messages go by email again.' : 'Email is off. Nothing is emailed until you turn it back on.');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const unsuppress = useMutation({
    mutationFn: (email: string) => api.post('/manage/email-settings/unsuppress', { to: email }),
    onSuccess: () => {
      toast.success('Cleared. Mail to that address will be sent again.');
      void qc.invalidateQueries({ queryKey: ['email-settings'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sendTest = useMutation({
    mutationFn: (to: string) =>
      api.post<{ sent: boolean; from: string; usingCustomSender: boolean }>('/manage/email-settings/test', { to }),
    onSuccess: (d) =>
      d.sent ? toast.success(`Sample sent from ${d.from}. Check that inbox.`) : toast.error('Could not send. Check the mailbox settings.'),
    onError: (e) => toast.error((e as Error).message),
  });

  if (q.isError) {
    return (
      <SettingsSection title="Email" testId="email-section">
        <SettingsCard><QueryError error={q.error} onRetry={q.refetch} /></SettingsCard>
      </SettingsSection>
    );
  }
  if (q.isLoading || !q.data || !host) {
    return (
      <SettingsSection title="Email" testId="email-section">
        <SettingsCard><p className="sk-state">Loading email settings…</p></SettingsCard>
      </SettingsSection>
    );
  }

  const d = q.data;
  const preview = d.previews.find((p) => p.template === template)?.html ?? '';
  const month = emailMonth(d);
  const fixes = d.deliveries?.suppressed ?? [];
  const senderSet = d.sender.mode === 'CUSTOM' || !!d.sender.smtpHost;
  const senderPill =
    d.sender.status === 'VERIFIED' ? { tone: 'good', text: 'Working' }
      : d.sender.status === 'FAILING' ? { tone: 'bad', text: 'Not working' }
        : senderSet ? { tone: 'warn', text: 'Not checked yet' } : { tone: 'neutral', text: 'Not set up' };

  const on = emailOn(d);

  return (
    <>
      <SettingsSection
        title="Email"
        hint="School messages also go to each person's email address, when one is on file."
        testId="email-switch"
        aside={<span className="sk-pill" data-tone={on ? 'good' : 'neutral'} data-testid="email-state">{on ? 'On' : 'Off'}</span>}
      >
        <SettingsCard>
          <label className="sk-setline" style={{ cursor: 'pointer', justifyContent: 'flex-start' }}>
            <input type="checkbox" checked={on} disabled={toggle.isPending} onChange={(e) => toggle.mutate(e.target.checked)}
              data-testid="email-toggle" style={{ width: 20, height: 20, accentColor: 'var(--sk-brand)', flex: 'none' }} />
            <span className="txt"><b>Send school messages by email</b><br />
              {on
                ? 'Turn this off for a practice school whose email addresses are made up, so nothing bounces back to you.'
                : 'Off. No notices, invites, results or reminders are emailed.'}</span>
          </label>
          {on ? null : (
            <Note>
              <span data-testid="email-off-note">
                Families and staff still get every message in the Sckools app, and on WhatsApp when it is on.
                Only a password reset someone asks for, and your own test email, still go by email.
              </span>
            </Note>
          )}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title="How emails look"
        hint="The letterhead on every email to families and staff."
        testId="email-letterhead"
      >
        <SettingsCard>
          <p className="sk-setline" style={{ margin: 0 }}>
            <span className="txt">
              Families receive email from <b>{d.effective.senderName}</b>{' '}
              <span className="sk-setmono">&lt;{d.effective.fromAddress}&gt;</span>
              {d.effective.replyTo ? <> · replies go to <b>{d.effective.replyTo}</b></> : null}
              {d.effective.usingCustomSender ? ' · from your own mailbox' : ' · sent for you by Sckools'}
            </span>
          </p>
          <div className="sk-setchoice" role="radiogroup" aria-label="Letterhead style">
            {(Object.keys(TEMPLATE_COPY) as Template[]).map((t) => (
              <label key={t} data-on={template === t || undefined}>
                <input type="radio" name="email-template" checked={template === t} onChange={() => setTemplate(t)} />
                <span><span className="n">{TEMPLATE_COPY[t].name}</span><span className="h">{TEMPLATE_COPY[t].hint}</span></span>
              </label>
            ))}
          </div>
          <FieldRow min={220}>
            <Field id="em-name" label="Sender name" hint="Blank uses your school's name.">
              {(p) => <input {...p} className="sk-input" value={senderName} placeholder={`e.g. ${d.effective.schoolName}`} onChange={(e) => setSenderName(e.target.value)} />}
            </Field>
            <Field id="em-reply" label="Replies go to" hint="Without one, replies reach nobody at the school.">
              {(p) => <input {...p} className="sk-input" type="email" value={replyTo} placeholder="e.g. office@yourschool.in" onChange={(e) => setReplyTo(e.target.value)} />}
            </Field>
          </FieldRow>
          <FieldRow min={220}>
            <Field id="em-accent" label="Colour">
              {(p) => (
                <span className="sk-setline" style={{ justifyContent: 'flex-start' }}>
                  <input {...p} type="color" value={accent || d.effective.accent} onChange={(e) => setAccent(e.target.value)}
                    style={{ width: 48, height: 40, border: '1px solid var(--sk-line-2)', borderRadius: 10, background: 'var(--sk-card)', padding: 2 }} />
                  <button type="button" className="sk-btn" data-size="sm" onClick={() => setAccent('')}>Use website colour</button>
                </span>
              )}
            </Field>
            <Field id="em-footer" label="Footer lines" hint="One per line, up to four: address and contact details.">
              {(p) => <textarea {...p} className="sk-input" rows={3} value={footer} placeholder={'e.g. 14 Lake Road, Indiranagar\noffice@yourschool.in'} onChange={(e) => setFooter(e.target.value)} />}
            </Field>
          </FieldRow>
          <SettingsActions>
            <button type="button" className="sk-btn" onClick={() => setOpen('preview')}>Preview and send a test</button>
            <button type="button" className="sk-btn" data-variant="primary" onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save letterhead'}
            </button>
          </SettingsActions>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title="Send from your own mailbox"
        hint="Optional. Without it, email goes from Sckools in your school's name."
        testId="email-sender"
        aside={<span className="sk-pill" data-tone={senderPill.tone}>{senderPill.text}</span>}
      >
        <SettingsCard>
          {d.sender.status === 'FAILING' ? (
            <Note tone="bad"><b>Your mailbox stopped working, so email went back to Sckools.</b> {d.sender.lastError}</Note>
          ) : null}
          <div className="sk-setline">
            <span className="txt">
              {d.sender.status === 'VERIFIED' && d.sender.fromAddress
                ? <>All email sends from <b>{d.sender.fromAddress}</b>.</>
                : senderSet
                  ? <>Saved for <b>{d.sender.fromAddress ?? 'your mailbox'}</b>. Nothing switches over until a test email arrives.</>
                  : 'Gmail, Outlook or your own domain. You need its server details and an app password.'}
            </span>
            <button type="button" className="sk-btn" onClick={() => setOpen('sender')}>{senderSet ? 'Change' : 'Set up'}</button>
          </div>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title="Email deliveries"
        hint="What went out this month. The full log opens only when you need it."
        testId="email-month-line"
      >
        <SettingsCard>
          {fixes.length ? (
            <Note tone="bad">
              {fixes.length} {fixes.length === 1 ? 'address bounces' : 'addresses bounce'}, so nothing reaches {fixes.length === 1 ? 'it' : 'them'}.
              Fix the address on the person&rsquo;s record, then clear it in the log.
            </Note>
          ) : null}
          <div className="sk-setline">
            <span className="txt">
              <b>{month.total}</b> {month.total === 1 ? 'email' : 'emails'} this month
              {month.pct !== null ? <> · {month.pct}% delivered</> : null}
              {month.bad ? <> · <b style={{ color: 'var(--sk-bad)' }}>{month.bad} not delivered</b></> : null}
            </span>
            <button type="button" className="sk-btn" onClick={() => setOpen('log')} data-testid="email-open-log">View delivery log</button>
          </div>
        </SettingsCard>
      </SettingsSection>

      {open === 'preview' ? (
        <Overlay title="Email preview" subtitle={`${TEMPLATE_COPY[template].name} letterhead, as an inbox shows it`} onClose={() => setOpen(null)}>
          <div ref={previewBoxRef} className="sk-setpreview" style={{ height: 470 * previewScale + 2 }}>
            {/* Rendered at the real 600px an inbox gives it, then scaled. */}
            <iframe title="Email preview" srcDoc={preview} sandbox=""
              style={{ width: 600, height: 470, border: 0, display: 'block', transform: `scale(${previewScale})`, transformOrigin: 'top left' }} />
          </div>
          <p className="sk-fieldhint" style={{ margin: 0 }}>Unsaved changes show here. Save the letterhead to use them.</p>
          <Field id="em-test-to" label="Send a test to" hint="Sends a real sample through whatever is in force now.">
            {(p) => <input {...p} className="sk-input" type="email" value={testTo} placeholder="e.g. you@example.com" onChange={(e) => setTestTo(e.target.value)} />}
          </Field>
          <div><button type="button" className="sk-btn" disabled={!testTo || sendTest.isPending} onClick={() => sendTest.mutate(testTo)}>
            {sendTest.isPending ? 'Sending…' : 'Send test'}
          </button></div>
        </Overlay>
      ) : null}

      {open === 'sender' ? (
        <Overlay
          title="Your own mailbox"
          subtitle="Nothing switches over until a test email actually arrives."
          onClose={() => setOpen(null)}
          footer={
            <>
              {senderSet ? (
                <button type="button" className="sk-btn" data-tone="bad" onClick={() => disable.mutate()} disabled={disable.isPending}>Remove, use Sckools</button>
              ) : <span />}
              <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="sk-btn" onClick={() => saveSender.mutate()}
                  disabled={saveSender.isPending || !d.sender.canConfigure || !fromAddress || !smtpHost}>
                  {saveSender.isPending ? 'Saving…' : 'Save'}
                </button>
                <button type="button" className="sk-btn" data-variant="primary" onClick={() => verify.mutate(testTo || fromAddress)}
                  disabled={verify.isPending || !d.sender.smtpHost} title="Sends a real email with these settings">
                  {verify.isPending ? 'Testing…' : 'Send test and switch on'}
                </button>
              </span>
            </>
          }
        >
          {!d.sender.canConfigure ? <Note>This server cannot store mail passwords yet. Email keeps sending from Sckools with your branding.</Note> : null}
          {d.sender.status === 'VERIFIED' ? <Note tone="good">Working. All email sends from {d.sender.fromAddress}.</Note> : null}
          {d.sender.status === 'UNVERIFIED' && d.sender.lastError ? <Note tone="bad">Last test failed: {d.sender.lastError}</Note> : null}
          <Field id="sm-from" label="Send as">
            {(p) => <input {...p} className="sk-input" type="email" value={fromAddress} placeholder="e.g. office@yourschool.in" onChange={(e) => setFromAddress(e.target.value)} />}
          </Field>
          <FieldRow min={150}>
            <Field id="sm-host" label="Mail server" hint="SMTP, e.g. smtp.gmail.com">
              {(p) => <input {...p} className="sk-input" value={smtpHost} placeholder="e.g. smtp.gmail.com" onChange={(e) => setSmtpHost(e.target.value)} />}
            </Field>
            <Field id="sm-port" label="Port">
              {(p) => <input {...p} className="sk-input" value={smtpPort} inputMode="numeric" onChange={(e) => setSmtpPort(e.target.value)} />}
            </Field>
          </FieldRow>
          <Field id="sm-user" label="Username">
            {(p) => <input {...p} className="sk-input" value={smtpUser} placeholder="e.g. office@yourschool.in" onChange={(e) => setSmtpUser(e.target.value)} />}
          </Field>
          <Field id="sm-pass" label={d.sender.hasPassword ? 'Password (saved, type to replace)' : 'App password'}>
            {(p) => <input {...p} className="sk-input" type="password" autoComplete="new-password" value={smtpPass}
              placeholder={d.sender.hasPassword ? '••••••••' : ''} onChange={(e) => setSmtpPass(e.target.value)} />}
          </Field>
          <Field id="sm-test" label="Send the test to" hint="Blank sends it to the mailbox itself.">
            {(p) => <input {...p} className="sk-input" type="email" value={testTo} placeholder={fromAddress ? `e.g. ${fromAddress}` : 'e.g. you@example.com'} onChange={(e) => setTestTo(e.target.value)} />}
          </Field>
        </Overlay>
      ) : null}

      {open === 'log' ? (
        <EmailLog d={d} onClose={() => setOpen(null)} onUnsuppress={(e) => unsuppress.mutate(e)} unsuppressing={unsuppress.isPending} />
      ) : null}
    </>
  );
}

/** The receipts, only when asked for. */
export function EmailLog({ d, onClose, onUnsuppress, unsuppressing }: {
  d: EmailSettingsResponse;
  onClose: () => void;
  onUnsuppress: (email: string) => void;
  unsuppressing: boolean;
}) {
  const month = emailMonth(d);
  const fixes = d.deliveries?.suppressed ?? [];
  const recent = d.deliveries?.recent ?? [];
  return (
    <Overlay title="Email delivery log" subtitle="This month, newest first" onClose={onClose}>
      <div data-testid="email-deliveries">
        <Figures count={3}>
          <Figure value={month.total} label="Emails this month" />
          <Figure value={month.delivered} label={month.pct !== null ? `Delivered · ${month.pct}% of sent` : 'Delivered'} />
          <Figure value={month.bad} label={month.bad ? 'Not delivered' : 'Not delivered · none'} />
        </Figures>
      </div>
      {fixes.length ? (
        <div data-testid="email-suppressed">
          <div className="sk-lab" style={{ color: 'var(--sk-bad)' }}>Addresses to fix</div>
          {fixes.map((sp) => (
            <div className="sk-dlog-fix" key={sp.email}>
              <span className="p">{sp.email}</span>
              <span className="r">{sp.reason === 'COMPLAINT' ? 'Marked our mail as spam' : `Bounced${sp.detail ? `: ${sp.detail}` : ''}`}</span>
              <button type="button" className="sk-btn" data-size="sm" onClick={() => onUnsuppress(sp.email)} disabled={unsuppressing}>Fixed — send again</button>
            </div>
          ))}
        </div>
      ) : null}
      {recent.length ? (
        <div className="sk-dlog" data-testid="email-recent">
          <div className="sk-lab">Recent</div>
          {recent.map((r) => (
            <div className="row" key={r.id}>
              <span className="k">{messageWords(r.kind)}</span>
              <span className="m">{r.to} · {whenIst(r.createdAt)}</span>
              <span className="st sk-pill" data-tone={r.status === 'DELIVERED' ? 'good' : r.status === 'SENT' || r.status === 'QUEUED' ? 'info' : 'bad'}>{r.status.toLowerCase()}</span>
              {r.error ? <span className="e">{r.error}</span> : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="sk-state">Nothing sent yet this month.</p>
      )}
    </Overlay>
  );
}
