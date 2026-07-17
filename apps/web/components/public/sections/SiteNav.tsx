'use client';

import type { PublicSiteData } from '@/lib/public-api';
import { heroIsPhotoLayout } from './HeroSection';

export interface NavFlags {
  hasAbout: boolean;
  hasAcademics: boolean;
  hasAdmissions: boolean;
  hasHof: boolean;
  hasGallery: boolean;
  hasEvents: boolean;
  hasContact: boolean;
  hasEnquiry: boolean;
}

/** Effective navbar style — GHOST needs a photo hero on the homepage. */
export function resolveNavStyle(data: PublicSiteData, view: string): string {
  const style = data.profile?.navStyle ?? 'CLASSIC';
  if (style === 'GHOST' && (view !== 'home' || !heroIsPhotoLayout(data))) return 'CLASSIC';
  return style;
}

function Logo({ data, small }: { data: PublicSiteData; small?: boolean }) {
  const logoUrl = data.profile?.logoUrl;
  const schoolName = data.school.name;
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      {logoUrl ? (
        <img src={logoUrl} alt={schoolName} className={small ? 'h-9 w-auto' : 'h-10 w-auto'} />
      ) : (
        <span
          className={`${small ? 'h-9 w-9' : 'h-10 w-10'} rounded-2xl ps-logo-bg grid place-items-center font-bold text-white ps-head`}
        >
          {schoolName.charAt(0)}
        </span>
      )}
      <span className="ps-nav-name ps-head font-bold text-lg truncate">{schoolName}</span>
    </div>
  );
}

function NavLinks({
  data,
  flags,
  base,
  onAcademicsPage,
}: {
  data: PublicSiteData;
  flags: NavFlags;
  base: string;
  onAcademicsPage: boolean;
}) {
  return (
    <>
      <a className="ps-nav-link px-3 py-2 rounded-lg hover:bg-black/5 transition" href={`${base}#home`}>Home</a>
      {flags.hasAbout && (
        <a className="ps-nav-link px-3 py-2 rounded-lg hover:bg-black/5 transition" href={`${base}#about`}>About</a>
      )}
      {flags.hasAcademics && (
        <div className="ps-acad">
          <a className="ps-nav-link px-3 py-2 rounded-lg hover:bg-black/5 transition inline-block" href="/academics">
            Academics <span className="text-[10px] opacity-60">▾</span>
          </a>
          <div className="ps-dropdown">
            {data.courses.map((c, i) => (
              <a
                key={c.id}
                href={onAcademicsPage ? `#course-${c.id}` : `/academics#course-${c.id}`}
                className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 hover:bg-black/[.04] transition"
              >
                <span className="h-9 w-9 rounded-lg ps-chip grid place-items-center text-base flex-none">
                  {['🧸', '📚', '🔬', '🎓', '🎨', '🏆', '🌟', '💡'][i % 8]}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-bold truncate" style={{ color: 'var(--ink)' }}>{c.name}</span>
                  {c.ageRange && <span className="block text-[11px] text-slate-400 truncate">{c.ageRange}</span>}
                </span>
              </a>
            ))}
            <a
              href="/academics"
              className="col-span-2 border-t border-black/5 mt-1 pt-2 px-2.5 pb-0.5 text-xs font-semibold"
              style={{ color: 'var(--ps1)' }}
            >
              View all programmes →
            </a>
          </div>
        </div>
      )}
      {flags.hasAdmissions && (
        <a className="ps-nav-link px-3 py-2 rounded-lg hover:bg-black/5 transition" href="/admissions">Admissions</a>
      )}
      {flags.hasHof && (
        <a className="ps-nav-link px-3 py-2 rounded-lg hover:bg-black/5 transition" href={`${base}#hall-of-fame`}>Hall of Fame</a>
      )}
      {flags.hasGallery && (
        <a className="ps-nav-link px-3 py-2 rounded-lg hover:bg-black/5 transition" href="/gallery">Gallery</a>
      )}
      {flags.hasEvents && (
        <a className="ps-nav-link px-3 py-2 rounded-lg hover:bg-black/5 transition" href="/connect">Connect</a>
      )}
      {(flags.hasContact || flags.hasEnquiry) && (
        <a className="ps-nav-link px-3 py-2 rounded-lg hover:bg-black/5 transition" href="/contact">Contact</a>
      )}
    </>
  );
}

function Cta({ data, enquireHref, ink }: { data: PublicSiteData; enquireHref: string; ink: string }) {
  if (data.profile?.navShowCta === false) return null;
  const label = data.profile?.navCtaLabel?.trim() || 'Enquire';
  return (
    <a
      href={enquireHref}
      className="btn-glow ps-accentbg text-sm font-semibold px-4 py-2 rounded-xl ps-soft hover:scale-[1.03] transition whitespace-nowrap"
      style={{ color: ink }}
    >
      {label} →
    </a>
  );
}

export default function SiteNav({
  data,
  flags,
  base,
  view,
  onAcademicsPage,
  enquireHref,
  ink,
}: {
  data: PublicSiteData;
  flags: NavFlags;
  base: string;
  view: string;
  onAcademicsPage: boolean;
  enquireHref: string;
  ink: string;
}) {
  const style = resolveNavStyle(data, view);
  const profile = data.profile;
  const ghost = style === 'GHOST';
  const pill = style === 'PILL';

  // Admin-picked bar colour. `onDark` flips link/name colours via ps-nav-ondark.
  const navColor = profile?.navColor ?? 'PAPER';
  const color =
    {
      PAPER: { bar: 'ps-navc-paper', onDark: false },
      WHITE: { bar: 'ps-navc-white', onDark: false },
      DARK: { bar: 'ps-navc-dark', onDark: true },
      BRAND: { bar: 'ps-navc-brand', onDark: true },
    }[navColor] ?? { bar: 'ps-navc-paper', onDark: false };
  const onDarkCls = color.onDark ? ' ps-nav-ondark' : '';

  // On a photo homepage the pill overlays the hero (fixed) so the photo fills
  // the screen edge-to-edge behind it — that's what makes it read as floating.
  const pillOverlay = pill && view === 'home' && heroIsPhotoLayout(data);

  const strip = style === 'STRIP' && (profile?.phone || profile?.email) && (
    <div className="ps-nav-strip text-xs flex items-center justify-end gap-5 px-6 py-1.5">
      {profile?.phone && <span>📞 {profile.phone}</span>}
      {profile?.email && <span>✉️ {profile.email}</span>}
    </div>
  );

  // PILL: detached rounded bar. Fixed over photo heroes; sticky elsewhere with
  // a transparent shell so scrolling content passes behind the pill's sides.
  if (pill) {
    return (
      <header
        id="ps-nav"
        className={`${
          pillOverlay ? 'fixed inset-x-0 top-0' : 'sticky top-0'
        } z-50 px-4 pt-3 transition-all duration-300 [&.ps-nav-scrolled_.ps-pill-bar]:shadow-xl`}
      >
        {/* w-fit + nowrap: the pill hugs its content and grows in WIDTH only —
            links never wrap to a second line, the name truncates if tight. */}
        <div
          className={`ps-pill-bar${onDarkCls} ${color.bar} w-fit max-w-full mx-auto px-5 h-14 flex flex-nowrap items-center gap-4 rounded-full backdrop-blur border border-black/5 shadow-lg transition-shadow`}
        >
          <Logo data={data} small />
          <nav className="hidden md:flex items-center gap-1 text-sm text-slate-600">
            <NavLinks data={data} flags={flags} base={base} onAcademicsPage={onAcademicsPage} />
          </nav>
          <Cta data={data} enquireHref={enquireHref} ink={ink} />
        </div>
      </header>
    );
  }

  // CENTER: links split around a centered crest (desktop); classic on mobile.
  if (style === 'CENTER') {
    return (
      <header
        id="ps-nav"
        className={`sticky top-0 z-50 transition-all duration-300 ${color.bar}${onDarkCls} backdrop-blur border-b border-black/5 [&.ps-nav-scrolled]:shadow-sm`}
      >
        <div className="max-w-6xl mx-auto px-6 h-16 hidden md:grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          <nav className="flex items-center justify-end gap-1 text-sm text-slate-600">
            <a className="ps-nav-link px-3 py-2 rounded-lg hover:bg-black/5 transition" href={`${base}#home`}>Home</a>
            {flags.hasAbout && (
              <a className="ps-nav-link px-3 py-2 rounded-lg hover:bg-black/5 transition" href={`${base}#about`}>About</a>
            )}
            {flags.hasAdmissions && (
              <a className="ps-nav-link px-3 py-2 rounded-lg hover:bg-black/5 transition" href="/admissions">Admissions</a>
            )}
          </nav>
          <Logo data={data} />
          <nav className="flex items-center gap-1 text-sm text-slate-600">
            {flags.hasGallery && (
              <a className="ps-nav-link px-3 py-2 rounded-lg hover:bg-black/5 transition" href="/gallery">Gallery</a>
            )}
            {flags.hasEvents && (
              <a className="ps-nav-link px-3 py-2 rounded-lg hover:bg-black/5 transition" href="/connect">Connect</a>
            )}
            {(flags.hasContact || flags.hasEnquiry) && (
              <a className="ps-nav-link px-3 py-2 rounded-lg hover:bg-black/5 transition" href="/contact">Contact</a>
            )}
            <span className="ml-2"><Cta data={data} enquireHref={enquireHref} ink={ink} /></span>
          </nav>
        </div>
        <div className="max-w-6xl mx-auto px-6 h-16 flex md:hidden items-center justify-between">
          <Logo data={data} />
          <Cta data={data} enquireHref={enquireHref} ink={ink} />
        </div>
      </header>
    );
  }

  // CLASSIC / STRIP / GHOST share the classic bar; STRIP adds the ribbon,
  // GHOST starts transparent and turns solid via the scroll class.
  return (
    <header
      id="ps-nav"
      className={
        ghost
          ? `ps-nav-ghost ${color.bar}${onDarkCls} fixed top-0 inset-x-0 z-50 transition-all duration-300 border-b border-transparent [&.ps-nav-scrolled]:shadow-sm`
          : `sticky top-0 z-50 transition-all duration-300 ${color.bar}${onDarkCls} backdrop-blur border-b border-black/5 [&.ps-nav-scrolled]:shadow-sm`
      }
    >
      {strip}
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Logo data={data} />
        <nav className="hidden md:flex items-center gap-1 text-sm text-slate-600">
          <NavLinks data={data} flags={flags} base={base} onAcademicsPage={onAcademicsPage} />
        </nav>
        <Cta data={data} enquireHref={enquireHref} ink={ink} />
      </div>
    </header>
  );
}
