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
}: {
  profile: PublicSiteData['profile'];
  socialLinks: PublicSiteData['socialLinks'];
  hasEnquiry: boolean;
  courses: string[];
  schoolName: string;
}) {
  return (
    <section id="enquire" className="relative max-w-6xl mx-auto px-6 py-24">
      <div className="relative ps-panel overflow-hidden p-8 md:p-12 grid md:grid-cols-2 gap-12 items-center">
        <div className="absolute -top-16 -right-10 h-64 w-64 rounded-full ps-about-glow" />
        <div className="relative">
          <h2 className="ps-head text-4xl font-bold">
            Ready to <span className="ps-grad-text">join us?</span>
          </h2>
          <p className="mt-4 text-slate-600">
            Leave your details and our admissions team reaches out within a working day.
          </p>
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
