'use client';

import { useState } from 'react';
import type { PublicSiteData } from '@/lib/public-api';
import { safeHttpUrl, safeHttpsUrl } from '../site-utils';
import { submitEnquiry } from '../enquiry-client';

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
      <div className="relative ps-card ps-soft rounded-[2rem] overflow-hidden p-8 md:p-12 grid md:grid-cols-2 gap-12 items-center">
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
          {safeHttpsUrl(profile?.mapEmbedUrl) && (
            <div className="mt-6 rounded-2xl overflow-hidden ps-card">
              <iframe
                src={safeHttpsUrl(profile?.mapEmbedUrl)!}
                className="w-full h-40 border-0"
                loading="lazy"
                title={`${schoolName} location`}
              />
            </div>
          )}
        </div>

        {hasEnquiry ? (
          <EnquiryForm courses={courses} />
        ) : (
          <div className="relative ps-chip rounded-2xl p-6 text-sm">
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
        className="btn-glow w-full font-semibold py-3.5 rounded-xl ps-soft hover:scale-[1.01] transition disabled:opacity-60 ps-accentbg"
        style={{ color: 'var(--ink)' }}
      >
        {status === 'sending' ? 'Sending…' : 'Submit enquiry →'}
      </button>
    </form>
  );
}
