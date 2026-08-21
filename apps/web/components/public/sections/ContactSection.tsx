'use client';

import { useState } from 'react';
import type { PublicSiteData } from '@/lib/public-api';
import { safeHttpUrl, safeHttpsUrl } from '../site-utils';
import { submitEnquiry } from '../enquiry-client';

type MapProfile = NonNullable<PublicSiteData['profile']>;

/**
 * Only Google Maps *Embed* URLs can live in an <iframe>. A share/short link
 * (maps.app.goo.gl, a /maps/place URL, goo.gl/maps) sends X-Frame-Options:DENY,
 * so framing it shows "refused to connect".
 */
function isEmbeddableMapUrl(url: string): boolean {
  return /output=embed/i.test(url) || /\/maps\/embed/i.test(url);
}

/** Build a framable embed from the school's address — works with no API key. */
function addressEmbedUrl(profile: MapProfile | null | undefined): string | null {
  const parts = [profile?.addressLine1, profile?.addressLine2, profile?.city, profile?.postalCode].filter(Boolean);
  if (parts.length === 0) return null;
  return `https://maps.google.com/maps?q=${encodeURIComponent(parts.join(', '))}&output=embed`;
}

/**
 * Resolve the map to something that actually renders:
 *  - a real embed URL → iframe it
 *  - otherwise, if we have an address → iframe an address-based embed
 *  - a share link we can't frame → surface it as a plain "open in Maps" link
 */
function resolveMap(profile: MapProfile | null | undefined): { embedSrc?: string; linkHref?: string } {
  const raw = safeHttpsUrl(profile?.mapEmbedUrl);
  if (raw && isEmbeddableMapUrl(raw)) return { embedSrc: raw };
  const fromAddress = addressEmbedUrl(profile);
  if (fromAddress) return { embedSrc: fromAddress };
  if (raw) return { linkHref: raw };
  return {};
}

export default function ContactSection({
  profile,
  socialLinks,
  hasEnquiry,
  courses,
  schoolName,
  onOwnPage,
  variant = 'SPLIT',
  bandClass = '',
}: {
  profile: PublicSiteData['profile'];
  socialLinks: PublicSiteData['socialLinks'];
  hasEnquiry: boolean;
  courses: string[];
  schoolName: string;
  /** True when this section IS /contact — the masthead already said it. */
  onOwnPage?: boolean;
  /** Studio layout for the band: SPLIT (shipped), WIZARD, FLOAT. */
  variant?: string;
  /** Per-section gesture/layout classes from the studio config. */
  bandClass?: string;
}) {
  const cls = bandClass ? ` ${bandClass}` : '';
  // The wizard IS the form — without the enquiry feature it has nothing to
  // ask, so it falls back to the shipped side-by-side band.
  const layout = variant === 'WIZARD' && hasEnquiry ? 'WIZARD' : variant === 'FLOAT' ? 'FLOAT' : 'SPLIT';

  if (layout === 'WIZARD') {
    return (
      <section id="enquire" data-sec="contact" className={`relative max-w-4xl mx-auto px-6 py-24${cls}`}>
        <div className="reveal relative ps-panel overflow-hidden p-8 md:p-12">
          <div className="absolute -top-16 -right-10 h-64 w-64 rounded-full ps-about-glow" />
          <div className="relative">
            {!onOwnPage && (
              <div className="text-center">
                <h2 className="ps-head text-4xl font-bold">
                  <span className="ps-accent-mark">
                    Ready to <span className="ps-grad-text">join us?</span>
                  </span>
                </h2>
                <p className="mt-3 text-slate-600 text-sm">A few quick questions — it takes under a minute.</p>
              </div>
            )}
            <div className="mt-8 max-w-xl mx-auto">
              <EnquiryWizard courses={courses} />
            </div>
            {(profile?.phone || profile?.email) && (
              <div className="mt-10 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-slate-500">
                {profile?.phone && <span>📞 {profile.phone}</span>}
                {profile?.email && <span>✉️ {profile.email}</span>}
              </div>
            )}
          </div>
        </div>
      </section>
    );
  }

  if (layout === 'FLOAT') {
    const map = resolveMap(profile);
    return (
      <section id="enquire" data-sec="contact" className={`relative max-w-6xl mx-auto px-6 py-24${cls}`}>
        <div className="reveal ps-cf-band relative overflow-hidden p-8 md:p-12 grid md:grid-cols-[1fr_1.05fr] gap-10 items-center">
          <div className="relative">
            {!onOwnPage && (
              <>
                <h2 className="ps-head text-4xl font-bold text-white">Ready to join us?</h2>
                <span className="ps-cf-underline mt-3 block" aria-hidden="true" />
                <p className="mt-4 text-white/85">
                  Leave your details and our admissions team reaches out within a working day.
                </p>
              </>
            )}
            {(profile?.phone || profile?.email || profile?.addressLine1) && (
              <div className="mt-6 space-y-2 text-sm text-white/90">
                {profile?.phone && <div>📞 {profile.phone}</div>}
                {profile?.email && <div>✉️ {profile.email}</div>}
                {profile?.addressLine1 && (
                  <div>
                    📍 {profile.addressLine1}
                    {profile.city ? `, ${profile.city}` : ''}
                    {profile.postalCode ? ` ${profile.postalCode}` : ''}
                  </div>
                )}
              </div>
            )}
            {socialLinks.length > 0 && (
              <div className="mt-6 flex flex-wrap gap-3">
                {socialLinks
                  .map((s) => ({ ...s, href: safeHttpUrl(s.url) }))
                  .filter((s) => s.href)
                  .map((s, i) => (
                    <a key={i} href={s.href!} target="_blank" rel="noreferrer"
                      className="ps-cf-chip rounded-lg px-3 py-1.5 text-xs font-medium hover:opacity-80 transition capitalize">
                      {s.platform}
                    </a>
                  ))}
              </div>
            )}
            {map.embedSrc && (
              <div className="mt-6 overflow-hidden rounded-xl border border-white/25">
                <iframe src={map.embedSrc} className="w-full h-36 border-0" loading="lazy" title={`${schoolName} location`} />
              </div>
            )}
            {!map.embedSrc && map.linkHref && (
              <a href={map.linkHref} target="_blank" rel="noreferrer"
                className="ps-cf-chip mt-6 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium hover:opacity-80 transition">
                📍 View on Google Maps
              </a>
            )}
          </div>
          <div className="ps-cf-card">
            {hasEnquiry ? (
              <EnquiryForm courses={courses} />
            ) : (
              <p className="text-sm text-slate-600">Reach out to us using the contact details alongside.</p>
            )}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section id="enquire" data-sec="contact" className={`relative max-w-6xl mx-auto px-6 py-24${cls}`}>
      {/* The page animated all the way down and then stopped dead here: this
          band carried no reveal at all while its neighbours carried one to
          four. */}
      <div className="reveal relative ps-panel overflow-hidden p-8 md:p-12 grid md:grid-cols-2 gap-12 items-center">
        <div className="absolute -top-16 -right-10 h-64 w-64 rounded-full ps-about-glow" />
        <div className="relative">
          {!onOwnPage && (
            <>
              <h2 className="ps-head text-4xl font-bold">
                <span className="ps-accent-mark">
                  Ready to <span className="ps-grad-text">join us?</span>
                </span>
              </h2>
              <p className="mt-4 text-slate-600">
                Leave your details and our admissions team reaches out within a working day.
              </p>
            </>
          )}
          {(profile?.phone || profile?.email || profile?.addressLine1) && (
            <div className="mt-6 space-y-2 text-sm text-slate-700">
              {profile?.phone && <div>📞 {profile.phone}</div>}
              {profile?.email && <div>✉️ {profile.email}</div>}
              {profile?.addressLine1 && (
                <div>
                  📍 {profile.addressLine1}
                  {profile.city ? `, ${profile.city}` : ''}
                  {profile.postalCode ? ` ${profile.postalCode}` : ''}
                </div>
              )}
            </div>
          )}
          {socialLinks.length > 0 && (
            <div className="mt-6 flex flex-wrap gap-3">
              {socialLinks
                .map((s) => ({ ...s, href: safeHttpUrl(s.url) }))
                .filter((s) => s.href)
                .map((s, i) => (
                  <a
                    key={i}
                    href={s.href!}
                    target="_blank"
                    rel="noreferrer"
                    className="ps-chip rounded-lg px-3 py-1.5 text-xs font-medium hover:opacity-80 transition capitalize"
                  >
                    {s.platform}
                  </a>
                ))}
            </div>
          )}
          {(() => {
            const map = resolveMap(profile);
            if (map.embedSrc) {
              return (
                <div className="mt-6 overflow-hidden ps-panel">
                  <iframe
                    src={map.embedSrc}
                    className="w-full h-40 border-0"
                    loading="lazy"
                    title={`${schoolName} location`}
                  />
                </div>
              );
            }
            if (map.linkHref) {
              return (
                <a
                  href={map.linkHref}
                  target="_blank"
                  rel="noreferrer"
                  className="ps-chip mt-6 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium hover:opacity-80 transition"
                >
                  📍 View on Google Maps
                </a>
              );
            }
            return null;
          })()}
        </div>

        {hasEnquiry ? (
          <EnquiryForm courses={courses} />
        ) : (
          <div className="relative ps-chip ps-panel-sm p-6 text-sm">
            Reach out to us using the contact details on the left.
          </div>
        )}
      </div>
    </section>
  );
}

// ── Enquiry form (client, posts to public API with school Host header) ──────────

function EnquiryForm({ courses }: { courses: string[] }) {
  const [status, setStatus] = useState<'idle' | 'sending' | 'ok' | 'rate' | 'error'>('idle');

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const parentName = String(fd.get('parentName') ?? '').trim();
    const phone = String(fd.get('phone') ?? '').trim();
    const email = String(fd.get('email') ?? '').trim();
    const gradeInterest = String(fd.get('gradeInterest') ?? '').trim();
    const message = String(fd.get('message') ?? '').trim();
    if (!parentName || !phone) return;

    setStatus('sending');
    const result = await submitEnquiry({ parentName, phone, email, gradeInterest, message });
    if (result === 'ok') form.reset();
    setStatus(result);
  }

  const inputCls =
    'w-full ps-card rounded-xl px-4 py-3 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[var(--ps1)]/30';

  return (
    <form onSubmit={onSubmit} className="relative space-y-3">
      {status === 'ok' && (
        <div className="bg-emerald-500/15 text-emerald-700 text-sm rounded-xl px-4 py-2.5">
          ✓ Thank you! Your enquiry has been received.
        </div>
      )}
      {status === 'rate' && (
        <div className="bg-amber-500/15 text-amber-700 text-sm rounded-xl px-4 py-2.5">
          You&apos;ve submitted a few times — please try again shortly.
        </div>
      )}
      {status === 'error' && (
        <div className="bg-rose-500/15 text-rose-700 text-sm rounded-xl px-4 py-2.5">
          Something went wrong. Please try again.
        </div>
      )}
      <input required name="parentName" className={inputCls} placeholder="Parent name" />
      <div className="grid grid-cols-2 gap-3">
        <input required name="phone" className={inputCls} placeholder="Phone" />
        {courses.length > 0 ? (
          <select name="gradeInterest" className={inputCls} defaultValue="">
            <option value="">Interested in…</option>
            {courses.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        ) : (
          <input name="email" type="email" className={inputCls} placeholder="Email" />
        )}
      </div>
      {courses.length > 0 && (
        <input name="email" type="email" className={inputCls} placeholder="Email (optional)" />
      )}
      <textarea name="message" rows={3} className={inputCls} placeholder="Message (optional)" />
      <button
        type="submit"
        disabled={status === 'sending'}
        className="btn-glow w-full font-semibold py-3.5 ps-btn hover:scale-[1.01] transition disabled:opacity-60 ps-accentbg"
        style={{ color: 'var(--ink)' }}
      >
        {status === 'sending' ? 'Sending…' : 'Submit enquiry →'}
      </button>
    </form>
  );
}

// ── Conversational enquiry (WIZARD layout): one question per screen, a live
//    progress thread, Enter to advance, and a drawn-check finale. Same data,
//    same endpoint — only the asking changes. ─────────────────────────────────

function EnquiryWizard({ courses }: { courses: string[] }) {
  type StepKey = 'name' | 'phone' | 'grade' | 'final';
  const steps: StepKey[] = ['name', 'phone', ...(courses.length ? (['grade'] as StepKey[]) : []), 'final'];
  const [i, setI] = useState(0);
  const [data, setData] = useState({ parentName: '', phone: '', email: '', gradeInterest: '', message: '' });
  const [status, setStatus] = useState<'idle' | 'sending' | 'ok' | 'rate' | 'error'>('idle');
  const [touched, setTouched] = useState(false);

  const step = steps[i];
  const valid =
    step === 'name' ? data.parentName.trim().length > 0 : step === 'phone' ? data.phone.trim().length >= 7 : true;

  const next = () => {
    if (!valid) { setTouched(true); return; }
    setTouched(false);
    if (i < steps.length - 1) setI(i + 1);
  };
  const back = () => { setTouched(false); if (i > 0) setI(i - 1); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && step !== 'final') { e.preventDefault(); next(); }
  };

  async function submit() {
    if (status === 'sending') return;
    setStatus('sending');
    const result = await submitEnquiry({
      parentName: data.parentName.trim(),
      phone: data.phone.trim(),
      email: data.email.trim(),
      gradeInterest: data.gradeInterest,
      message: data.message.trim(),
    });
    setStatus(result);
  }

  if (status === 'ok') {
    return (
      <div className="ps-wiz-done text-center py-6">
        <svg className="ps-wiz-check mx-auto" viewBox="0 0 64 64" width="76" height="76" aria-hidden="true">
          <circle cx="32" cy="32" r="29" fill="none" stroke="var(--ps2)" strokeWidth="3" />
          <path d="M20 33 L29 42 L45 24" fill="none" stroke="var(--ps1)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <h3 className="ps-head text-2xl font-bold mt-4">Thank you!</h3>
        <p className="text-slate-600 mt-2 text-sm">
          Your enquiry is with our admissions team — we&apos;ll reach out within a working day.
        </p>
      </div>
    );
  }

  const firstName = data.parentName.trim().split(' ')[0];
  const qCls = 'block ps-head text-2xl md:text-3xl font-bold';
  const inCls = 'ps-wiz-input mt-5 w-full text-lg md:text-xl py-2.5';

  return (
    <div className="ps-wiz" onKeyDown={onKey}>
      <div className="flex items-center gap-3 text-xs font-semibold text-slate-500">
        <span className="tabular-nums">{i + 1} / {steps.length}</span>
        <span className="ps-wiz-track flex-1">
          <span className="ps-wiz-fill" style={{ width: `${((i + 1) / steps.length) * 100}%` }} />
        </span>
      </div>
      <div key={step} className="ps-wiz-step mt-8">
        {step === 'name' && (
          <>
            <label htmlFor="ps-wiz-name" className={qCls}>👋 What&apos;s your name?</label>
            <input id="ps-wiz-name" autoFocus className={inCls} placeholder="Type your full name…"
              value={data.parentName} onChange={(e) => setData({ ...data, parentName: e.target.value })} />
          </>
        )}
        {step === 'phone' && (
          <>
            <label htmlFor="ps-wiz-phone" className={qCls}>📞 Best number to reach you{firstName ? `, ${firstName}` : ''}?</label>
            <input id="ps-wiz-phone" autoFocus type="tel" className={inCls} placeholder="Phone number…"
              value={data.phone} onChange={(e) => setData({ ...data, phone: e.target.value })} />
          </>
        )}
        {step === 'grade' && (
          <>
            <span className={qCls}>🎓 Which programme interests you?</span>
            <div className="mt-6 flex flex-wrap gap-2.5">
              {courses.map((name) => (
                <button key={name} type="button" aria-pressed={data.gradeInterest === name}
                  onClick={() => { setData({ ...data, gradeInterest: name }); setTouched(false); setI(i + 1); }}
                  className={`ps-wiz-opt${data.gradeInterest === name ? ' ps-wiz-opt-on' : ''}`}>
                  {name}
                </button>
              ))}
            </div>
          </>
        )}
        {step === 'final' && (
          <>
            <label htmlFor="ps-wiz-msg" className={qCls}>✉️ Anything else we should know?</label>
            <textarea id="ps-wiz-msg" autoFocus rows={3} className={`${inCls} resize-none`}
              placeholder="A question, your child’s age, anything… (optional)"
              value={data.message} onChange={(e) => setData({ ...data, message: e.target.value })} />
            <input type="email" aria-label="Email (optional)" className={`${inCls} mt-2 text-base`} placeholder="Email (optional)"
              value={data.email} onChange={(e) => setData({ ...data, email: e.target.value })} />
          </>
        )}
        {touched && !valid && (
          <p className="mt-2 text-xs font-medium text-rose-500">
            {step === 'name' ? 'We need a name to say hello properly.' : 'A phone number lets our team call you back.'}
          </p>
        )}
        {(status === 'rate' || status === 'error') && step === 'final' && (
          <p className="mt-2 text-xs font-medium text-amber-600">
            {status === 'rate' ? 'You’ve submitted a few times — please try again shortly.' : 'Something went wrong — please try again.'}
          </p>
        )}
      </div>
      <div className="mt-8 flex items-center gap-3">
        {i > 0 && (
          <button type="button" onClick={back} className="ps-chip rounded-xl px-4 py-2.5 text-sm font-semibold hover:opacity-80 transition">
            ← Back
          </button>
        )}
        {step !== 'final' ? (
          <button type="button" onClick={next}
            className="btn-glow ps-btn ps-accentbg font-semibold px-7 py-3 hover:scale-[1.02] transition"
            style={{ color: 'var(--ink)' }}>
            {step === 'grade' && !data.gradeInterest ? 'Skip →' : 'Next →'}
          </button>
        ) : (
          <button type="button" onClick={submit} disabled={status === 'sending'}
            className="btn-glow ps-btn ps-accentbg font-semibold px-7 py-3 hover:scale-[1.02] transition disabled:opacity-60"
            style={{ color: 'var(--ink)' }}>
            {status === 'sending' ? 'Sending…' : 'Submit enquiry →'}
          </button>
        )}
        <span className="hidden md:inline text-[11px] text-slate-400">press Enter ↵</span>
      </div>
    </div>
  );
}
