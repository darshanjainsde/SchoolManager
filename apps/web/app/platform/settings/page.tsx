'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Globe, Info, Mail, Phone, Save, Tag, Hash } from 'lucide-react';
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
  loginOtpEnabled: boolean;
  heroStats: HeroStat[];
  discountEnabled: boolean;
  discountPercent: number;
  discountLabel: string;
  /** ISO instant, or null for an open-ended offer. */
  discountEndsAt: string | null;
}

interface HeroStat {
  n: number;
  label: string;
}

/** What sckools.com shows when the owner has not set the four figures. */
const HERO_DEFAULTS: HeroStat[] = [
  { n: 13, label: 'modules, one login' },
  { n: 54, label: 'features, listed' },
  { n: 1, label: 'price, per student a year' },
  { n: 4, label: 'apps + the TV' },
];

/** `datetime-local` wants local wall time without a zone; the API wants an instant. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
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
        loginOtpEnabled: body.loginOtpEnabled,
        heroStats: (body.heroStats ?? []).map((s) => ({ n: Number(s.n), label: s.label })),
        discountEnabled: !!body.discountEnabled,
        discountPercent: Number(body.discountPercent) || 50,
        discountLabel: body.discountLabel ?? '',
        discountEndsAt: body.discountEndsAt ?? null,
      }),
    onSuccess: () => {
      toast.success('Saved — live on sckools.com within a minute');
      void qc.invalidateQueries({ queryKey: ['owner-marketing-config'] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const dirty = !!form && !!config.data && JSON.stringify(form) !== JSON.stringify(config.data);
  const emailValid = !form || /\S+@\S+\.\S+/.test(form.contactEmail);
  const stats = form ? (form.heroStats?.length ? form.heroStats : HERO_DEFAULTS) : HERO_DEFAULTS;
  const statsValid = stats.every((s) => Number.isInteger(Number(s.n)) && Number(s.n) >= 0 && s.label.trim().length > 0 && s.label.length <= 40);
  const pct = form ? Number(form.discountPercent) : 50;
  const pctValid = Number.isInteger(pct) && pct >= 1 && pct <= 90;
  const endsAtPast = !!form?.discountEndsAt && new Date(form.discountEndsAt).getTime() <= Date.now();
  const off = (inr: number) => Math.round(inr * (1 - pct / 100));

  function setStat(i: number, patch: Partial<HeroStat>) {
    setForm((f) => {
      if (!f) return f;
      const cur = f.heroStats?.length ? f.heroStats : HERO_DEFAULTS;
      const next = cur.map((s, k) => (k === i ? { ...s, ...patch } : s));
      return { ...f, heroStats: next };
    });
  }

  function set<K extends keyof MarketingConfigRow>(key: K, value: MarketingConfigRow[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
  }

  return (
    <div>
      <header className="sk-pagehead">
        <h1>Settings</h1>
        <p>Pricing, the home-page figures, a time-boxed discount and contact details shown on the public sckools.com site.</p>
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
                Prices are <b>per student, per year</b> — a school pays the plan price multiplied by its student
                count, billed once a year. Schools in India are billed the ₹ INR figure, everyone else the $ USD
                figure. The Basic ₹ figure is also the headline on sckools.com: “Upgrade your school from ₹X per
                student, a year”. Changes reach the site within a minute.
              </p>
              <div className="sk-own-fldgrid">
                {TIERS.map((t) => (
                  <div key={t.name} className="sk-card" style={{ boxShadow: 'none' }}>
                    <div className="sk-card-b" style={{ gap: 10 }}>
                      <div>
                        <div style={{ fontWeight: 730, fontSize: 14 }}>{t.name} — per student, per year</div>
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

          {/* Hero figures */}
          <div className="sk-card">
            <div className="sk-card-h">
              <h3>Home page figures</h3>
            </div>
            <div className="sk-card-b">
              <p className="sk-muted">
                The four tiles under the buttons on the sckools.com home page: a number and a short label each.
                Keep labels under 40 characters so all four stay on one row. Leave them as they are to show the
                site&rsquo;s defaults.
              </p>
              <div className="sk-own-fldgrid">
                {stats.map((s, i) => (
                  <div key={i} className="sk-card" style={{ boxShadow: 'none' }}>
                    <div className="sk-card-b" style={{ gap: 8 }}>
                      <div className="sk-own-fld">
                        <label htmlFor={`stat-n-${i}`}>
                          <Hash className="inline h-3 w-3" /> Number
                        </label>
                        <input
                          id={`stat-n-${i}`}
                          className="sk-input"
                          type="number"
                          min={0}
                          step={1}
                          inputMode="numeric"
                          value={String(s.n)}
                          onChange={(e) => setStat(i, { n: Number(e.target.value) })}
                          style={{ fontWeight: 620, fontVariantNumeric: 'tabular-nums' }}
                        />
                      </div>
                      <div className="sk-own-fld">
                        <label htmlFor={`stat-l-${i}`}>Label</label>
                        <input
                          id={`stat-l-${i}`}
                          className="sk-input"
                          maxLength={40}
                          value={s.label}
                          onChange={(e) => setStat(i, { label: e.target.value })}
                          aria-invalid={!s.label.trim()}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {!statsValid && <span className="err">Every tile needs a whole number and a label of up to 40 characters.</span>}
            </div>
          </div>

          {/* Discount */}
          <div className="sk-card">
            <div className="sk-card-h">
              <h3>Discount</h3>
            </div>
            <div className="sk-card-b">
              <p className="sk-muted">
                While this is on, sckools.com shows every plan&rsquo;s list price struck through next to the reduced
                price, with the label and a countdown to the end date. When the date passes the full price comes
                back by itself. Leave the date empty for an offer with no end.
              </p>
              <label className="sk-own-fld" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }} htmlFor="discountEnabled">
                <input
                  id="discountEnabled"
                  type="checkbox"
                  checked={!!form.discountEnabled}
                  onChange={(e) => set('discountEnabled', e.target.checked)}
                  style={{ width: 18, height: 18 }}
                />
                <span>Run the discount on sckools.com</span>
              </label>
              <div className="sk-own-fldgrid" style={{ marginTop: 10 }}>
                <div className="sk-own-fld">
                  <label htmlFor="discountPercent">
                    <Tag className="inline h-3 w-3" /> Percent off
                  </label>
                  <input
                    id="discountPercent"
                    className="sk-input"
                    type="number"
                    min={1}
                    max={90}
                    step={1}
                    inputMode="numeric"
                    value={String(form.discountPercent ?? 50)}
                    onChange={(e) => set('discountPercent', Number(e.target.value))}
                    aria-invalid={!pctValid}
                    style={{ fontWeight: 620, fontVariantNumeric: 'tabular-nums' }}
                  />
                  {!pctValid && <span className="err">Between 1 and 90.</span>}
                </div>
                <div className="sk-own-fld">
                  <label htmlFor="discountLabel">Label on the site</label>
                  <input
                    id="discountLabel"
                    className="sk-input"
                    maxLength={40}
                    value={form.discountLabel ?? ''}
                    onChange={(e) => set('discountLabel', e.target.value)}
                    placeholder="Launch offer"
                  />
                </div>
                <div className="sk-own-fld">
                  <label htmlFor="discountEndsAt">Ends at (your local time)</label>
                  <input
                    id="discountEndsAt"
                    className="sk-input"
                    type="datetime-local"
                    value={toLocalInput(form.discountEndsAt)}
                    onChange={(e) => set('discountEndsAt', fromLocalInput(e.target.value))}
                  />
                  {endsAtPast && form.discountEnabled && (
                    <span className="err">That time has passed, so the site is already showing full prices.</span>
                  )}
                </div>
              </div>
              <p className="sk-muted" style={{ marginTop: 10, fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}>
                With {pctValid ? pct : 50}% off, the site shows Basic ₹{off(Number(form.priceBasicInr))} instead of ₹
                {Number(form.priceBasicInr)}, Standard ₹{off(Number(form.priceStdInr))} instead of ₹{Number(form.priceStdInr)},
                Pro ₹{off(Number(form.priceProInr))} instead of ₹{Number(form.priceProInr)}. The quote builder uses the
                reduced figure while the offer runs.
              </p>
            </div>
          </div>

          {/* Save bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 11, flexWrap: 'wrap' }}>
            <button
              className="sk-btn"
              data-variant="primary"
              onClick={() => form && save.mutate(form)}
              disabled={!dirty || !emailValid || !statsValid || !pctValid || save.isPending}
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
              <h3>Sign-in</h3>
            </div>
            <div className="sk-card-b">
              <p className="sk-muted">
                Whether the login page offers <b>&ldquo;sign in with a code&rdquo;</b> beside the
                password door. It is off because the code cannot be delivered yet: Meta refuses
                every authentication-category template on our WhatsApp account, so the code is
                never sent and the door cannot open. Leave it off until that is resolved — a door
                that does nothing is the one people try first.
              </p>
              <label className="sk-own-fld" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }} htmlFor="loginOtpEnabled">
                <input
                  id="loginOtpEnabled"
                  type="checkbox"
                  checked={!!form.loginOtpEnabled}
                  onChange={(e) => set('loginOtpEnabled', e.target.checked)}
                  style={{ width: 18, height: 18 }}
                />
                <span>Offer sign-in by code on the login page</span>
              </label>
              <p className="sk-muted" style={{ marginTop: 8, fontSize: 12 }}>
                Takes up to a minute to appear on the login page. Turning it off also refuses the
                request at the server, so nothing can ask for a code by going round the page.
              </p>
            </div>
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
          / student / yr
        </span>
      </div>
    </div>
  );
}
