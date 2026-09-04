'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

/**
 * The school's letterhead, and optionally its own sender.
 *
 * The screen is deliberately ordered by what a school actually needs: what its
 * mail LOOKS like first (which every school gets, configured or not), and only
 * then the advanced "send from our own address" step. The effective values are
 * always shown in plain words so the fallback is never a mystery — an admin who
 * has set nothing can see exactly what a parent receives.
 */

type Template = 'CLASSIC' | 'BANNER' | 'MINIMAL';

const TEMPLATE_COPY: Record<Template, { name: string; hint: string }> = {
  CLASSIC: { name: 'Classic', hint: 'Colour band, crest and name — the default.' },
  BANNER: { name: 'Banner', hint: 'Your colour fills the header, name reversed out.' },
  MINIMAL: { name: 'Minimal', hint: 'A quiet rule and small logo. Reads like a note.' },
};

interface EmailSettingsResponse {
  settings: {
    template: Template;
    senderName: string | null;
    replyTo: string | null;
    accentColor: string | null;
    logoAssetId: string | null;
    footerLines: string[];
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

const field: React.CSSProperties = {
  border: '1px solid var(--sk-line)',
  borderRadius: 9,
  padding: '8px 10px',
  fontSize: 14,
  background: 'var(--sk-card)',
  color: 'var(--sk-ink)',
  width: '100%',
};

export function EmailSettingsCard() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ['email-settings'],
    enabled: !!host,
    queryFn: () => api.get<EmailSettingsResponse>('/manage/email-settings'),
  });

  const [template, setTemplate] = useState<Template>('CLASSIC');
  const [senderName, setSenderName] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [accent, setAccent] = useState('');
  const [footer, setFooter] = useState('');
  const [showSender, setShowSender] = useState(false);
  const [testTo, setTestTo] = useState('');

  // Sender form
  const [fromAddress, setFromAddress] = useState('');
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');

  // Seed the form from the server exactly once per load, so typing is never
  // clobbered by a refetch mid-edit.
  // The preview box measures ITSELF and scales the 600px email to fit.
  //
  // A CALLBACK ref, not useRef + useEffect([]): this card returns a loading
  // shell first, so on the mount the effect would run the box does not exist
  // yet, and with empty deps it would never look again — the preview would
  // silently stay unscaled and clip. The callback fires exactly when the node
  // appears. Only WIDTH is read, and the height it sets cannot feed back into
  // that width (the box is a grid column), so there is no resize loop.
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
    setShowSender(q.data.sender.mode === 'CUSTOM' || !!q.data.sender.smtpHost);
    setSeeded(true);
  }, [q.data, seeded]);

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
      toast.success('Letterhead saved — every email now uses it.');
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
      toast.success('Saved. Now send a test to verify it before it goes live.');
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const verify = useMutation({
    mutationFn: (to: string) =>
      api.post<EmailSettingsResponse & { ok: boolean; error?: string }>(
        '/manage/email-settings/sender/verify',
        { to },
      ),
    onSuccess: (d) => {
      qc.setQueryData(['email-settings'], d);
      if (d.ok) toast.success('Verified — your school now sends from its own address.');
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
  });

  const sendTest = useMutation({
    mutationFn: (to: string) =>
      api.post<{ sent: boolean; from: string; usingCustomSender: boolean }>('/manage/email-settings/test', { to }),
    onSuccess: (d) =>
      d.sent
        ? toast.success(`Sample sent from ${d.from} — check that inbox.`)
        : toast.error('Could not send — see the mail settings below.'),
    onError: (e) => toast.error((e as Error).message),
  });

  if (q.isLoading || !q.data) {
    return (
      <div className="sk-card">
        <div className="sk-card-h"><h3>Email</h3></div>
        <div className="sk-card-b"><p className="sk-muted">Loading…</p></div>
      </div>
    );
  }

  const d = q.data;
  const preview = d.previews.find((p) => p.template === template)?.html ?? '';

  return (
    <div className="sk-card" style={{ gridColumn: '1 / -1' }}>
      <div className="sk-card-h">
        <h3>Email</h3>
        <p className="sk-muted" style={{ margin: 0, fontSize: 12.5 }}>
          How every email from your school looks, and who it comes from.
        </p>
      </div>
      <div className="sk-card-b" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {/* What is actually in force — stated plainly, so the default is never a mystery. */}
        <div
          style={{
            background: 'var(--sk-brand-tint)',
            border: '1px solid var(--sk-line)',
            borderRadius: 10,
            padding: '10px 14px',
            fontSize: 13,
            color: 'var(--sk-ink-2)',
          }}
        >
          Right now families receive email from <b>{d.effective.senderName}</b>{' '}
          <span style={{ fontFamily: 'ui-monospace,monospace', fontSize: 12 }}>&lt;{d.effective.fromAddress}&gt;</span>
          {d.effective.replyTo ? <> · replies go to <b>{d.effective.replyTo}</b></> : null}
          {d.effective.usingCustomSender ? (
            <span style={{ color: 'var(--sk-good)', fontWeight: 700 }}> · your own address</span>
          ) : (
            <span> · sent for you by Sckools</span>
          )}
        </div>

        {/* ── Letterhead ─────────────────────────────────────────────── */}
        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' }} className="sk-email-grid">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <span className="sk-lab" style={{ display: 'block', marginBottom: 6 }}>Letterhead</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(Object.keys(TEMPLATE_COPY) as Template[]).map((t) => (
                  <label
                    key={t}
                    style={{
                      display: 'flex', gap: 9, alignItems: 'flex-start', cursor: 'pointer',
                      border: `1px solid ${template === t ? 'var(--sk-brand)' : 'var(--sk-line)'}`,
                      background: template === t ? 'var(--sk-brand-tint)' : 'var(--sk-card)',
                      borderRadius: 9, padding: '9px 11px',
                    }}
                  >
                    <input
                      type="radio"
                      name="email-template"
                      checked={template === t}
                      onChange={() => setTemplate(t)}
                      style={{ marginTop: 3 }}
                    />
                    <span>
                      <span style={{ fontWeight: 700, fontSize: 13.5 }}>{TEMPLATE_COPY[t].name}</span>
                      <span style={{ display: 'block', fontSize: 12, color: 'var(--sk-ink-3)' }}>
                        {TEMPLATE_COPY[t].hint}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label className="sk-lab" htmlFor="em-name">Sender name</label>
              <input
                id="em-name" style={field} value={senderName} placeholder={d.effective.schoolName}
                onChange={(e) => setSenderName(e.target.value)}
              />
              <span style={{ fontSize: 11.5, color: 'var(--sk-ink-3)' }}>
                Shown as the sender. Blank uses your school name.
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label className="sk-lab" htmlFor="em-reply">Reply-to address</label>
              <input
                id="em-reply" style={field} value={replyTo} placeholder="office@yourschool.in"
                onChange={(e) => setReplyTo(e.target.value)}
              />
              <span style={{ fontSize: 11.5, color: 'var(--sk-ink-3)' }}>
                Where replies land. Blank means replies go nowhere useful — worth setting.
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label className="sk-lab" htmlFor="em-accent">Accent colour</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  id="em-accent" type="color" value={accent || d.effective.accent}
                  onChange={(e) => setAccent(e.target.value)}
                  style={{ width: 44, height: 34, border: '1px solid var(--sk-line)', borderRadius: 8, background: 'var(--sk-card)' }}
                />
                <button type="button" className="sk-btn ghost" onClick={() => setAccent('')} style={{ fontSize: 12 }}>
                  Use website colour
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label className="sk-lab" htmlFor="em-footer">Footer lines</label>
              <textarea
                id="em-footer" style={{ ...field, minHeight: 62, fontFamily: 'inherit' }} value={footer}
                placeholder={'14 Lake Road, Indiranagar\noffice@yourschool.in · +91 98200 11223'}
                onChange={(e) => setFooter(e.target.value)}
              />
              <span style={{ fontSize: 11.5, color: 'var(--sk-ink-3)' }}>
                One per line, up to four. Address and contact details.
              </span>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="sk-btn" onClick={() => save.mutate()} disabled={save.isPending}>
                {save.isPending ? 'Saving…' : 'Save letterhead'}
              </button>
            </div>
          </div>

          {/* Live preview — the same renderer that sends the real mail. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
            <span className="sk-lab">Preview</span>
            <div
              ref={previewBoxRef}
              style={{
                border: '1px solid var(--sk-line)', borderRadius: 10, background: '#f1f0ee',
                overflow: 'hidden', height: 470 * previewScale + 2,
              }}
            >
              {/* Rendered at the real 600px an inbox gives it, then scaled —
                  a preview reflowed to a narrow box would not be the email. */}
              <iframe
                title="Email preview"
                srcDoc={preview}
                sandbox=""
                style={{
                  width: 600, height: 470, border: 0, display: 'block',
                  transform: `scale(${previewScale})`, transformOrigin: 'top left',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                style={{ ...field, flex: 1 }} value={testTo} placeholder="you@example.com"
                onChange={(e) => setTestTo(e.target.value)} aria-label="Send a test to"
              />
              <button
                className="sk-btn ghost"
                disabled={!testTo || sendTest.isPending}
                onClick={() => sendTest.mutate(testTo)}
              >
                {sendTest.isPending ? 'Sending…' : 'Send test'}
              </button>
            </div>
            <span style={{ fontSize: 11.5, color: 'var(--sk-ink-3)' }}>
              Sends a real sample through whatever is in force right now.
            </span>
          </div>
        </div>

        {/* ── Own sender (advanced) ──────────────────────────────────── */}
        <div style={{ borderTop: '1px solid var(--sk-line)', paddingTop: 14 }}>
          <button
            type="button"
            className="sk-btn ghost"
            onClick={() => setShowSender((v) => !v)}
            style={{ fontSize: 13 }}
          >
            {showSender ? 'Hide' : 'Send from our own email address…'}
          </button>

          {showSender && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {!d.sender.canConfigure && (
                <div style={{ background: 'var(--sk-amber-tint)', color: 'var(--sk-amber-ink)', borderRadius: 9, padding: '10px 14px', fontSize: 13 }}>
                  This deployment cannot store mail passwords yet. Email keeps sending from Sckools with your branding.
                </div>
              )}
              {d.sender.status === 'VERIFIED' && (
                <div style={{ background: 'var(--sk-good-tint)', color: 'var(--sk-good)', borderRadius: 9, padding: '10px 14px', fontSize: 13, fontWeight: 600 }}>
                  ✓ Verified — all email sends from {d.sender.fromAddress}
                  {d.sender.verifiedAt ? ` since ${new Date(d.sender.verifiedAt).toLocaleDateString()}` : ''}.
                </div>
              )}
              {d.sender.status === 'FAILING' && (
                <div style={{ background: 'var(--sk-bad-tint)', color: 'var(--sk-bad)', borderRadius: 9, padding: '10px 14px', fontSize: 13 }}>
                  <b>Your sender stopped working, so email fell back to Sckools.</b>
                  <div style={{ marginTop: 4, fontSize: 12 }}>{d.sender.lastError}</div>
                </div>
              )}
              {d.sender.status === 'UNVERIFIED' && d.sender.lastError && (
                <div style={{ background: 'var(--sk-bad-tint)', color: 'var(--sk-bad)', borderRadius: 9, padding: '10px 14px', fontSize: 13 }}>
                  Last test failed: {d.sender.lastError}
                </div>
              )}

              <p className="sk-muted" style={{ fontSize: 12.5, margin: 0 }}>
                Use your school&rsquo;s own mailbox (Gmail, Outlook, or your own domain). You&rsquo;ll need its SMTP
                details and an app password. Nothing switches over until a test email actually arrives.
              </p>

              <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%, 190px),1fr))' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <label className="sk-lab" htmlFor="sm-from">Send as</label>
                  <input id="sm-from" style={field} value={fromAddress} placeholder="office@yourschool.in"
                    onChange={(e) => setFromAddress(e.target.value)} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <label className="sk-lab" htmlFor="sm-host">SMTP server</label>
                  <input id="sm-host" style={field} value={smtpHost} placeholder="smtp.gmail.com"
                    onChange={(e) => setSmtpHost(e.target.value)} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <label className="sk-lab" htmlFor="sm-port">Port</label>
                  <input id="sm-port" style={field} value={smtpPort} inputMode="numeric"
                    onChange={(e) => setSmtpPort(e.target.value)} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <label className="sk-lab" htmlFor="sm-user">Username</label>
                  <input id="sm-user" style={field} value={smtpUser} placeholder="office@yourschool.in"
                    onChange={(e) => setSmtpUser(e.target.value)} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <label className="sk-lab" htmlFor="sm-pass">
                    {d.sender.hasPassword ? 'Password (saved — type to replace)' : 'App password'}
                  </label>
                  <input id="sm-pass" style={field} type="password" value={smtpPass} autoComplete="new-password"
                    placeholder={d.sender.hasPassword ? '••••••••' : ''}
                    onChange={(e) => setSmtpPass(e.target.value)} />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  className="sk-btn ghost"
                  onClick={() => saveSender.mutate()}
                  disabled={saveSender.isPending || !d.sender.canConfigure || !fromAddress || !smtpHost}
                >
                  {saveSender.isPending ? 'Saving…' : 'Save sender'}
                </button>
                <button
                  className="sk-btn"
                  onClick={() => verify.mutate(testTo || fromAddress)}
                  disabled={verify.isPending || !d.sender.smtpHost}
                  title="Sends a real email with these settings"
                >
                  {verify.isPending ? 'Testing…' : 'Send test & verify'}
                </button>
                {(d.sender.mode === 'CUSTOM' || d.sender.smtpHost) && (
                  <button className="sk-btn ghost" onClick={() => disable.mutate()} disabled={disable.isPending}>
                    Remove and use Sckools
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      <style>{`@media (max-width: 820px){ .sk-email-grid{ grid-template-columns: minmax(0,1fr) !important; } }`}</style>
    </div>
  );
}
