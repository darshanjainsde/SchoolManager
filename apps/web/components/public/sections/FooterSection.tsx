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
 *
 * With a NULL config this must render byte-for-byte what PublicSite carried
 * inline (COLUMNS on paper, slate text, working hover, no social row) — the
 * extraction repaints nobody. `.ps-foot-muted` carries the slate default and
 * lets the dark/brand colour classes recolour it (higher specificity), so the
 * one class does both jobs without an inline literal that only works on paper.
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
  /** Passed in rather than read from the clock in this component's render. */
  year: number;
}) {
  const cfg = normalizeFooterConfig(data.profile?.footerConfig);
  const cls = footerClasses(cfg);
  const schoolName = data.school.name;
  const logoUrl = data.profile?.logoUrl;
  const tagline = cfg.tagline ?? 'Nurturing confident, compassionate lifelong learners.';
  const muted = 'ps-foot-muted text-slate-500';
  const linkCls = 'ps-foot-link hover:text-slate-900 transition';

  const social = cfg.social && data.socialLinks.length > 0 ? (
    <div className="ps-foot-social" aria-label="Social links">
      {data.socialLinks.map((s, i) => (
        <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" aria-label={s.platform.toLowerCase()}>
          {SOCIAL_GLYPH[s.platform] ?? '•'}
        </a>
      ))}
    </div>
  ) : null;

  const brand = (withSocial: boolean) => (
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
      <p className={`text-sm mt-3 ${muted}`}>{tagline}</p>
      {withSocial ? social : null}
    </div>
  );

  const explore = (
    <div>
      <div className="ps-head font-bold mb-3">Explore</div>
      <ul className={`space-y-2 text-sm ${muted} ${cfg.twoCols ? 'sm:columns-2 sm:gap-x-8 [&>li]:break-inside-avoid' : ''}`}>
        {flags.hasAbout && <li><a href={`${base}#about`} className={linkCls}>About</a></li>}
        {flags.hasAcademics && <li><a href="/academics" className={linkCls}>Academics</a></li>}
        {flags.hasAdmissions && <li><a href="/admissions" className={linkCls}>Admissions</a></li>}
        {flags.hasHof && <li><a href={`${base}#hall-of-fame`} className={linkCls}>Hall of Fame</a></li>}
        {flags.hasGallery && <li><a href="/gallery" className={linkCls}>Gallery</a></li>}
        {flags.hasEvents && <li><a href="/connect" className={linkCls}>Connect</a></li>}
        {flags.hasBlog && <li><Link href="/blog" className={linkCls}>Blog</Link></li>}
        {(data.pages ?? []).map((p) => (
          <li key={p.slug}><a href={`/p/${p.slug}`} className={linkCls}>{p.title}</a></li>
        ))}
        <li><a href="/contact" className={linkCls}>Enquire</a></li>
      </ul>
    </div>
  );

  const contact = cfg.contact ? (
    <div>
      <div className="ps-head font-bold mb-3">Contact</div>
      <ul className={`space-y-2 text-sm ${muted}`}>
        {data.profile?.phone && <li>📞 {data.profile.phone}</li>}
        {data.profile?.email && <li>✉️ {data.profile.email}</li>}
        {data.profile?.city && (
          <li>📍 {data.profile.city}{data.profile.region ? `, ${data.profile.region}` : ''}</li>
        )}
        {!data.profile?.phone && !data.profile?.email && !data.profile?.city && (
          <li className="text-slate-400">—</li>
        )}
      </ul>
    </div>
  ) : null;

  const copyright = (
    <div className="border-t border-black/10 text-center text-xs ps-foot-muted text-slate-400 py-4">
      © {year} {schoolName} · Powered by Sckools
    </div>
  );

  if (cfg.layout === 'SIMPLE') {
    // Brand keeps its own social row; a second one here would duplicate it.
    return (
      <footer data-sec="footer" className={`border-t border-black/10 mt-8 ${cls}`}>
        <div className="max-w-6xl mx-auto px-6 py-8">{brand(true)}</div>
        {copyright}
      </footer>
    );
  }

  if (cfg.layout === 'CENTER') {
    return (
      <footer data-sec="footer" className={`border-t border-black/10 mt-8 ${cls}`}>
        <div className="max-w-6xl mx-auto px-6 py-14 ps-foot-cols">
          {brand(true)}
          {explore}
          {contact}
        </div>
        {copyright}
      </footer>
    );
  }

  // COLUMNS — the shipped footer, reproduced exactly when the config is null.
  return (
    <footer data-sec="footer" className={`border-t border-black/10 mt-8 ${cls}`}>
      <div className="max-w-6xl mx-auto px-6 py-14 grid md:grid-cols-3 gap-8">
        {brand(true)}
        {explore}
        {contact}
      </div>
      {copyright}
    </footer>
  );
}
