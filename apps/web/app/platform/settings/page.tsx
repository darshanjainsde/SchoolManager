'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Globe, Info, Mail, Phone, Save } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { OWNER_HOST, PLATFORM_HOST, platformHref } from '@/lib/hosts';
import { useAuthStore } from '@/lib/auth-store';
import '../../sk-theme.css';

interface MarketingConfigRow {
  priceBasicUsd: number;
  priceBasicInr: number;
  priceStdUsd: number;
  priceStdInr: number;
  priceProUsd: number;
  priceProInr: number;
  contactEmail: string;
  contactPhone: string;
}

/** INR first: it is the figure most schools are actually billed. */
const TIERS = [
  { name: 'Basic', usd: 'priceBasicUsd', inr: 'priceBasicInr', blurb: 'Public site, gallery, enquiries, social' },
  { name: 'Standard', usd: 'priceStdUsd', inr: 'priceStdInr', blurb: 'Adds about/contact, events and the blog' },
  { name: 'Pro', usd: 'priceProUsd', inr: 'priceProInr', blurb: 'Adds the full school management suite' },
] as const;

/**
 * Everything the public sckools.com site reads from the database: the three
 * plan prices in both currencies, and the contact details shown to visitors.
 * Previously buried at the bottom of the dashboard; it lives on its own page
 * now because it is settings, not a metric.
 */
export default function PlatformSettingsPage() {
  // Session state, not the token itself — the refresh token is an HttpOnly
  // cookie the client cannot read.
  const signedIn = useAuthStore((s) => s.status) === 'authed';
  const api = useApi({ audience: 'platform', hostHeader: OWNER_HOST });
  const qc = useQueryClient();

  const config = useQuery({
    queryKey: ['owner-marketing-config'],
    queryFn: () => api.get<MarketingConfigRow>('/owner/marketing-config'),
    enabled: signedIn,
  });

  const [form, setForm] = useState<MarketingConfigRow | null>(null);

  // Seed the form once the row arrives, and re-seed after a save.
  useEffect(() => {
    if (config.data) setForm(config.data);
  }, [config.data]);

  const save = useMutation({
    mutationFn: (body: MarketingConfigRow) =>
      api.put('/owner/marketing-config', {
        priceBasicUsd: Number(body.priceBasicUsd),
        priceBasicInr: Number(body.priceBasicInr),
        priceStdUsd: Number(body.priceStdUsd),
        priceStdInr: Number(body.priceStdInr),
        priceProUsd: Number(body.priceProUsd),
        priceProInr: Number(body.priceProInr),
        contactEmail: body.contactEmail,
        contactPhone: body.contactPhone,
      }),
    onSuccess: () => {
      toast.success('Saved — live on sckools.com within a minute');
      void qc.invalidateQueries({ queryKey: ['owner-marketing-config'] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const dirty = !!form && !!config.data && JSON.stringify(form) !== JSON.stringify(config.data);
  const emailValid = !form || /\S+@\S+\.\S+/.test(form.contactEmail);

  function set<K extends keyof MarketingConfigRow>(key: K, value: MarketingConfigRow[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
  }

  return (
    <div>
      <header className="sk-pagehead">
        <h1>Settings</h1>
        <p>Pricing and contact details shown on the public sckools.com site.</p>
      </header>

      {/* `isLoading` alone leaves a blank page: a query that is disabled, or
          between retries after a failure, is neither loading nor errored, and
          `form` is still null — which is exactly what shipped, and what a 503
          from the API looked like on screen. Key the fallback off having no
          form instead, so there is always something to read. */}
      {!form && !config.error && <p className="sk-state">Loading settings…</p>}
      {config.error && (
        <div className="sk-own-note" data-tone="warn">
          <AlertTriangle aria-hidden="true" />
          <span>
            Could not load settings — {(config.error as Error).message}.{' '}
            <button
              type="button"
              onClick={() => void config.refetch()}
              style={{ border: 0, background: 'transparent', padding: 0, cursor: 'pointer',
                       color: 'var(--sk-brand-2)', fontWeight: 640 }}
            >
              Try again
            </button>
          </span>
        </div>
      )}

      {form && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 860 }}>
          <p className="sk-own-note">
            <Info aria-hidden="true" />
            <span>
              These values are read live by{' '}
              <a
                href={platformHref()}
                target="_blank"
                rel="noreferrer"
                style={{ color: 'var(--sk-brand-2)', fontWeight: 640 }}
              >
                {PLATFORM_HOST}
              </a>{' '}
              — the pricing table and every contact link. Changes appear within a minute; no deploy needed.
            </span>
          </p>

          {/* Plan pricing */}
          <div className="sk-card">
            <div className="sk-card-h">
              <h3>Plan pricing</h3>
            </div>
            <div className="sk-card-b">
              <p className="sk-muted">
                Prices are <b>per year</b>. Schools in India are billed the ₹ INR figure, everyone else the $ USD
                figure — other countries see the USD price converted live on sckools.com/pricing.
              </p>
              <div className="sk-own-fldgrid">
                {TIERS.map((t) => (
                  <div key={t.name} className="sk-card" style={{ boxShadow: 'none' }}>
                    <div className="sk-card-b" style={{ gap: 10 }}>
                      <div>
                        <div style={{ fontWeight: 730, fontSize: 14 }}>{t.name} — per year</div>
                        <div className="sk-muted" style={{ fontSize: 11.5 }}>
                          {t.blurb}
                        </div>
                      </div>
                      <MoneyField
                        id={t.inr}
                        label="India (₹ INR)"
                        symbol="₹"
                        value={String(form[t.inr])}
                        onChange={(v) => set(t.inr, v as never)}
                      />
                      <MoneyField
                        id={t.usd}
                        label="Rest of world ($ USD)"
                        symbol="$"
                        value={String(form[t.usd])}
                        onChange={(v) => set(t.usd, v as never)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Public contact */}
          <div className="sk-card">
            <div className="sk-card-h">
              <h3>Public contact</h3>
            </div>
            <div className="sk-card-b">
              <p className="sk-muted">
                Where enquiries go. New-lead notification emails are sent to this address too.
              </p>
              <div className="sk-own-fldgrid">
                <div className="sk-own-fld">
                  <label htmlFor="contactEmail">
                    <Mail className="inline h-3 w-3" /> Contact email
                  </label>
                  <input
                    id="contactEmail"
                    className="sk-input"
                    type="email"
                    value={form.contactEmail}
                    onChange={(e) => set('contactEmail', e.target.value)}
                    aria-invalid={!emailValid}
                  />
                  {!emailValid && <span className="err">Enter a valid email address.</span>}
                </div>
                <div className="sk-own-fld">
                  <label htmlFor="contactPhone">
                    <Phone className="inline h-3 w-3" /> Contact phone
                  </label>
                  <input
                    id="contactPhone"
                    className="sk-input"
                    value={form.contactPhone}
                    onChange={(e) => set('contactPhone', e.target.value)}
                    placeholder="+91 …"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Save bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 11, flexWrap: 'wrap' }}>
            <button
              className="sk-btn"
              data-variant="primary"
              onClick={() => form && save.mutate(form)}
              disabled={!dirty || !emailValid || save.isPending}
            >
              <Save className="h-4 w-4" /> {save.isPending ? 'Saving…' : 'Save changes'}
            </button>
            {dirty && !save.isPending && <span className="sk-muted">You have unsaved changes.</span>}
            {config.data && (
              <button className="sk-btn" onClick={() => setForm(config.data)} disabled={!dirty || save.isPending}>
                Discard
              </button>
            )}
          </div>

          {/* Owner access */}
          <div className="sk-card">
            <div className="sk-card-h">
              <h3>Owner access</h3>
            </div>
            <div className="sk-card-b">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <Globe className="h-4 w-4" style={{ color: 'var(--sk-ink-3)' }} aria-hidden="true" />
                <span className="sk-muted">Console host</span>
                <code style={{ fontFamily: 'monospace', fontWeight: 640 }}>{OWNER_HOST}</code>
              </div>
              <p className="sk-muted" style={{ fontSize: 12.5 }}>
                The one-password gate lives at <code>/owner</code>; email + TOTP sign-in is the fallback at{' '}
                <code>/platform/login</code>. Rotate the gate password through the API&rsquo;s{' '}
                <code>OWNER_GATE_PASSWORD</code> environment variable.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Number field with the currency symbol pinned inside, so ₹ vs $ is unmistakable. */
function MoneyField({
  id,
  label,
  symbol,
  value,
  onChange,
}: {
  id: string;
  label: string;
  symbol: string;
  value: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="sk-own-fld">
      <label htmlFor={id}>{label}</label>
      <div style={{ position: 'relative' }}>
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 11,
            top: '50%',
            transform: 'translateY(-50%)',
            fontSize: 13,
            fontWeight: 700,
            color: 'var(--sk-ink-3)',
            pointerEvents: 'none',
          }}
        >
          {symbol}
        </span>
        <input
          id={id}
          className="sk-input"
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ paddingLeft: 26, paddingRight: 46, fontWeight: 620, fontVariantNumeric: 'tabular-nums' }}
        />
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            right: 11,
            top: '50%',
            transform: 'translateY(-50%)',
            fontSize: 10.5,
            fontWeight: 650,
            color: 'var(--sk-ink-3)',
            pointerEvents: 'none',
          }}
        >
          / year
        </span>
      </div>
    </div>
  );
}
