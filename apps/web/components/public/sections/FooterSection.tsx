'use client';

import Link from 'next/link';
import type { PublicSiteData } from '@/lib/public-api';
import { footerClasses, normalizeFooterConfig } from '../site-variants';
import type { NavFlags } from './SiteNav';

const SOCIAL_GLYPH: Record<string, string> = {
  FACEBOOK: 'f',
  INSTAGRAM: 'ig',
  YOUTUBE: '▶',
  X: 'x',
  LINKEDIN: 'in',
};

/**
 * The site footer, extracted from PublicSite so it can answer to footerConfig.
 * With a null config this renders EXACTLY the footer PublicSite carried inline
 * (three columns on paper, no social icons) — the extraction repaints nobody.
 */
export default function FooterSection({
  data,
  flags,
  base,
  year,
}: {
  data: PublicSiteData;
  flags: NavFlags;
  base: string;
  /** Passed in, not read from the clock: render-time Date is a hydration trap. */
  year: number;
}) {
  const cfg = normalizeFooterConfig(data.profile?.footerConfig);
  const cls = footerClasses(cfg);
  const schoolName = data.school.name;
  const logoUrl = data.profile?.logoUrl;
  const tagline = cfg.tagline ?? 'Nurturing confident, compassionate lifelong learners.';

  const social = cfg.social && data.socialLinks.length > 0 && (
    <div className="ps-foot-social" aria-label="Social links">
      {data.socialLinks.map((s, i) => (
        <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" aria-label={s.platform.toLowerCase()}>
          {SOCIAL_GLYPH[s.platform] ?? '•'}
        </a>
      ))}
    </div>
  );

  const brand = (
    <div>
      <div className={`flex items-center gap-2.5 ${cfg.layout === 'CENTER' ? 'justify-center' : ''}`}>
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt={schoolName} className="h-9 w-auto" loading="lazy" decoding="async" />
        ) : (
          <>
            <span className="h-9 w-9 rounded-xl ps-logo-bg grid place-items-center font-bold text-white text-sm ps-head">
              {schoolName.charAt(0)}
            </span>
            <span className="ps-head font-bold">{schoolName}</span>
          </>
        )}
      </div>
      <p className="text-sm opacity-80 mt-3">{tagline}</p>
      {social}
    </div>
  );

  const explore = (
    <div>
      <div className="ps-head font-bold mb-3">Explore</div>
      <ul className={`space-y-2 text-sm opacity-80 ${cfg.layout === 'CENTER' ? 'space-y-1' : ''}`}>
        {flags.hasAbout && <li><a href={`${base}#about`} className="hover:opacity-100 transition">About</a></li>}
        {flags.hasAcademics && <li><a href="/academics" className="hover:opacity-100 transition">Academics</a></li>}
        {flags.hasAdmissions && <li><a href="/admissions" className="hover:opacity-100 transition">Admissions</a></li>}
        {flags.hasHof && <li><a href={`${base}#hall-of-fame`} className="hover:opacity-100 transition">Hall of Fame</a></li>}
        {flags.hasGallery && <li><a href="/gallery" className="hover:opacity-100 transition">Gallery</a></li>}
        {flags.hasEvents && <li><a href="/connect" className="hover:opacity-100 transition">Connect</a></li>}
        {flags.hasBlog && <li><Link href="/blog" className="hover:opacity-100 transition">Blog</Link></li>}
        {(data.pages ?? []).map((p) => (
          <li key={p.slug}><a href={`/p/${p.slug}`} className="hover:opacity-100 transition">{p.title}</a></li>
        ))}
        <li><a href="/contact" className="hover:opacity-100 transition">Enquire</a></li>
      </ul>
    </div>
  );

  const contact = cfg.contact && (
    <div>
      <div className="ps-head font-bold mb-3">Contact</div>
      <ul className="space-y-2 text-sm opacity-80">
        {data.profile?.phone && <li>📞 {data.profile.phone}</li>}
        {data.profile?.email && <li>✉️ {data.profile.email}</li>}
        {data.profile?.city && (
          <li>📍 {data.profile.city}{data.profile.region ? `, ${data.profile.region}` : ''}</li>
        )}
        {!data.profile?.phone && !data.profile?.email && !data.profile?.city && (
          <li className="opacity-50">—</li>
        )}
      </ul>
    </div>
  );

  const copyright = (
    <div className="border-t border-black/10 text-center text-xs opacity-60 py-4">
      © {year} {schoolName} · Powered by Sckools
    </div>
  );

  if (cfg.layout === 'SIMPLE') {
    return (
      <footer className={`border-t border-black/10 mt-8 ${cls}`}>
        <div className="max-w-6xl mx-auto px-6 py-8 flex flex-wrap items-center justify-between gap-4">
          {brand}
          {social}
        </div>
        {copyright}
      </footer>
    );
  }

  if (cfg.layout === 'CENTER') {
    return (
      <footer className={`border-t border-black/10 mt-8 ${cls}`}>
        <div className="max-w-6xl mx-auto px-6 py-14 ps-foot-cols">
          {brand}
          {explore}
          {contact}
        </div>
        {copyright}
      </footer>
    );
  }

  // COLUMNS — the shipped footer.
  return (
    <footer className={`border-t border-black/10 mt-8 ${cls}`}>
      <div className="max-w-6xl mx-auto px-6 py-14 grid md:grid-cols-3 gap-8">
        {brand}
        {explore}
        {contact}
      </div>
      {copyright}
    </footer>
  );
}
