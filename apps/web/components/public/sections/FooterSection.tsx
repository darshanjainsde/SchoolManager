import Link from 'next/link';
import type { PublicSiteData } from '@/lib/public-api';
import { optimised } from '@/lib/img';
import { footerClasses, normalizeFestiveTheme, normalizeFooterConfig } from '../site-variants';
import { FestiveFooterEdge } from './FestiveLayer';
import { Ico, telHref } from './ContactIcon';
import type { NavFlags } from './SiteNav';

/**
 * The site footer.
 *
 * Seven layouts over one set of blocks. The blocks — brand, Explore, Visit us,
 * Admissions, sign-off — are built once and arranged differently; a layout
 * never gets its own copy of a link list, because that is how two of them
 * drift apart and one school ends up with a footer missing its Blog link.
 *
 * COLUMNS on paper is the default and carries no layout class, so a school
 * that has never opened the setting keeps the arrangement it had. What DID
 * change for everybody, deliberately, are the defects the arrangement was
 * hiding (reported 2026-09-27 against Raffles):
 *
 *  - Contact lines were emoji (📞 ✉️ 📍), which render in whatever emoji font
 *    the device ships — a different footer on every phone, and the only
 *    cartoon on an otherwise serious page. They are drawn SVG now.
 *  - Nothing was tappable. A phone number a parent cannot press is a phone
 *    number they have to type. tel:, mailto:, wa.me and a Maps search now.
 *  - Nine links stacked 340px tall beside an empty column. The Explore list
 *    splits itself past six links; no setting to remember.
 *  - The sign-off was one flat centred line. It is three parts now, with the
 *    way back to the top of a long homepage.
 */

/** The real marks, not letters. `f`, `ig` and `▶` read as typing mistakes. */
function SocialIcon({ platform }: { platform: string }) {
  const p = platform.toUpperCase();
  const box = { width: 15, height: 15, viewBox: '0 0 24 24', 'aria-hidden': true } as const;
  if (p === 'FACEBOOK') {
    return (
      <svg {...box} fill="currentColor">
        <path d="M13.5 21.9V14h2.6l.5-3h-3.1V9c0-.9.3-1.5 1.6-1.5h1.6V4.8c-.3 0-1.3-.1-2.4-.1-2.4 0-4 1.4-4 4.1v2.2H7.6v3h2.7v7.9Z" />
      </svg>
    );
  }
  if (p === 'INSTAGRAM') {
    return (
      <svg {...box} fill="none" stroke="currentColor" strokeWidth="1.9">
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.2" cy="6.8" r="1.1" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (p === 'YOUTUBE') {
    return (
      <svg {...box} fill="currentColor">
        <path d="M23 12s0-3.3-.4-4.9a2.6 2.6 0 0 0-1.8-1.8C19.1 5 12 5 12 5s-7.1 0-8.8.4A2.6 2.6 0 0 0 1.4 7.2C1 8.7 1 12 1 12s0 3.3.4 4.8a2.6 2.6 0 0 0 1.8 1.8C4.9 19 12 19 12 19s7.1 0 8.8-.4a2.6 2.6 0 0 0 1.8-1.8C23 15.3 23 12 23 12ZM9.8 15.2V8.8l6 3.2Z" />
      </svg>
    );
  }
  if (p === 'LINKEDIN') {
    return (
      <svg {...box} fill="currentColor">
        <path d="M4.9 3.5a2.4 2.4 0 1 0 0 4.9 2.4 2.4 0 0 0 0-4.9ZM2.8 21h4.2V9.4H2.8Zm7 0H14v-6.3c0-1.7.9-2.5 2-2.5s1.9.9 1.9 2.5V21h4.2v-7.1c0-3.6-1.9-5.2-4.4-5.2A3.9 3.9 0 0 0 14 10.7V9.4H9.8c.1 1.2 0 11.6 0 11.6Z" />
      </svg>
    );
  }
  if (p === 'X' || p === 'TWITTER') {
    return (
      <svg {...box} fill="currentColor">
        <path d="M17.7 3h3.2l-7 8 8.2 10h-6.4l-5-6.1L4.9 21H1.7l7.5-8.5L1.3 3h6.6l4.5 5.6Zm-1.1 16.1h1.8L7.5 4.8H5.6Z" />
      </svg>
    );
  }
  return (
    <svg {...box} fill="currentColor">
      <circle cx="12" cy="12" r="4" />
    </svg>
  );
}

/** Digits only — wa.me refuses anything else, silently. */
function waHref(phone: string): string {
  return `https://wa.me/${phone.replace(/\D/g, '')}`;
}

/** A Maps SEARCH, never an embed: no key, no cookie, no iframe weight. */
function mapsHref(parts: (string | null | undefined)[]): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(parts.filter(Boolean).join(', '))}`;
}

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
  const fest = normalizeFestiveTheme(data.profile?.festiveTheme);
  const cls = footerClasses(cfg, fest);
  const schoolName = data.school.name;
  const p = data.profile;
  const logoUrl = p?.logoUrl;
  const tagline = cfg.tagline ?? 'Nurturing confident, compassionate lifelong learners.';
  const muted = 'ps-foot-muted text-slate-500';
  const linkCls = 'ps-foot-link hover:text-slate-900 transition';

  const social =
    cfg.social && data.socialLinks.length > 0 ? (
      <div className="ps-foot-social" aria-label="Social links">
        {data.socialLinks.map((s, i) => (
          <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" aria-label={s.platform.toLowerCase()}>
            <SocialIcon platform={s.platform} />
          </a>
        ))}
      </div>
    ) : null;

  const crest = logoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={optimised(logoUrl, 384)} alt={schoolName} className="h-9 w-auto" loading="lazy" decoding="async" />
  ) : (
    <>
      <span className="h-9 w-9 rounded-xl ps-logo-bg grid place-items-center font-bold text-white text-sm ps-head">
        {schoolName.charAt(0)}
      </span>
      <span className="ps-head font-bold">{schoolName}</span>
    </>
  );

  const brand = (withSocial: boolean) => (
    <div>
      <div className={`flex items-center gap-2.5 ${cfg.layout === 'CENTER' ? 'justify-center' : ''}`}>{crest}</div>
      <p className={`text-sm mt-3 ${muted}`}>{tagline}</p>
      {p?.affiliationNo && <p className={`text-xs mt-2 ${muted}`}>Affiliation no. {p.affiliationNo}</p>}
      {withSocial ? social : null}
    </div>
  );

  // Built as DATA so the count can decide the column split and every layout
  // gets the same list.
  const exploreLinks: { href: string; label: string; internal?: boolean }[] = [
    ...(flags.hasAbout ? [{ href: `${base}#about`, label: 'About' }] : []),
    ...(flags.hasAcademics ? [{ href: '/academics', label: 'Academics' }] : []),
    ...(flags.hasAdmissions ? [{ href: '/admissions', label: 'Admissions' }] : []),
    ...(flags.hasHof ? [{ href: `${base}#hall-of-fame`, label: 'Hall of Fame' }] : []),
    ...(flags.hasGallery ? [{ href: '/gallery', label: 'Gallery' }] : []),
    ...(flags.hasEvents ? [{ href: '/connect', label: 'Connect' }] : []),
    ...(flags.hasBlog ? [{ href: '/blog', label: 'Blog', internal: true }] : []),
    ...(data.pages ?? []).map((pg) => ({ href: `/p/${pg.slug}`, label: pg.title })),
    { href: '/contact', label: 'Enquire' },
  ];
  // Six is where one column starts to look like a wall beside an empty
  // neighbour. `twoCols` stays honoured for schools that set it by hand.
  const splitLinks = cfg.twoCols || exploreLinks.length > 6;

  const linkEl = (l: { href: string; label: string; internal?: boolean }) =>
    l.internal ? (
      <Link href={l.href} className={linkCls}>
        {l.label}
      </Link>
    ) : (
      <a href={l.href} className={linkCls}>
        {l.label}
      </a>
    );

  const explore = (
    <div>
      <div className="ps-head font-bold mb-3">Explore</div>
      <ul className={`space-y-2 text-sm ${muted} ${splitLinks ? 'sm:columns-2 sm:gap-x-8 [&>li]:break-inside-avoid' : ''}`}>
        {exploreLinks.map((l) => (
          <li key={l.href}>{linkEl(l)}</li>
        ))}
      </ul>
    </div>
  );

  const addressLine = [p?.addressLine1, p?.addressLine2].filter(Boolean).join(', ');
  const cityLine = [p?.city, p?.region].filter(Boolean).join(', ');
  const placeLine = [addressLine, cityLine, p?.postalCode].filter(Boolean).join(' · ');
  const hasPlace = !!placeLine;

  /** Every line does something on a phone. */
  const contact = cfg.contact ? (
    <div>
      <div className="ps-head font-bold mb-3">Visit us</div>
      <ul className={`space-y-2 text-sm ${muted}`}>
        {p?.phone && (
          <li className="ps-foot-line">
            <Ico name="phone" />
            <a href={telHref(p.phone)} className={linkCls}>
              {p.phone}
            </a>
          </li>
        )}
        {cfg.whatsapp && p?.phone && (
          <li className="ps-foot-line">
            <Ico name="wa" />
            <a href={waHref(p.phone)} target="_blank" rel="noopener noreferrer" className={linkCls}>
              WhatsApp the office
            </a>
          </li>
        )}
        {p?.email && (
          <li className="ps-foot-line">
            <Ico name="mail" />
            <a href={`mailto:${p.email}`} className={linkCls}>
              {p.email}
            </a>
          </li>
        )}
        {hasPlace && (
          <li className="ps-foot-line">
            <Ico name="pin" />
            <a href={mapsHref([schoolName, addressLine, cityLine, p?.postalCode])} target="_blank" rel="noopener noreferrer" className={linkCls}>
              {placeLine}
            </a>
          </li>
        )}
        {cfg.hours && (
          <li className="ps-foot-line">
            <Ico name="clock" />
            <span>{cfg.hours}</span>
          </li>
        )}
        {!p?.phone && !p?.email && !hasPlace && !cfg.hours && <li className="text-slate-400">—</li>}
      </ul>
    </div>
  ) : null;

  /** The one thing a school footer should sell. */
  const admissions = flags.hasAdmissions ? (
    <div>
      <div className="ps-head font-bold mb-3">Admissions</div>
      {cfg.admissionsNote && <p className={`text-sm ${muted}`}>{cfg.admissionsNote}</p>}
      <a href="/contact" className="ps-foot-cta mt-3">
        Enquire now
      </a>
    </div>
  ) : null;

  const band =
    cfg.admissionsBand && flags.hasAdmissions ? (
      <div className="ps-foot-band">
        <div>
          <div className="ps-head ps-foot-band-t">Admissions are open</div>
          {cfg.admissionsNote && <div className="ps-foot-band-s">{cfg.admissionsNote}</div>}
        </div>
        <a href="/contact" className="ps-foot-cta">
          Book a visit
        </a>
      </div>
    ) : null;

  const copyright = (
    <div className="ps-foot-sign border-t border-black/10 text-xs ps-foot-muted text-slate-400 py-4">
      <span>© {year} {schoolName}</span>
      <span>
        {/* Launch-gate #8 (DPDP): the platform's policy must be one click away
            from every page a parent sees, school sites included. */}
        <a href="https://sckools.com/privacy" className="underline-offset-2 hover:underline">Privacy</a>
        {' · '}
        <a href="https://sckools.com/terms" className="underline-offset-2 hover:underline">Terms</a>
        {cfg.backToTop && (
          <>
            {' · '}
            <a href="#top" className="underline-offset-2 hover:underline">Back to top ↑</a>
          </>
        )}
      </span>
      <span>Powered by Sckools</span>
    </div>
  );

  const shell = (children: React.ReactNode) => (
    <footer data-sec="footer" data-foot={cfg.layout} className={`border-t border-black/10 mt-8 ${cls}`}>
      <FestiveFooterEdge fest={fest} />
      {band}
      {children}
      {copyright}
    </footer>
  );

  if (cfg.layout === 'SIMPLE') {
    // Brand keeps its own social row; a second one here would duplicate it.
    return shell(<div className="max-w-6xl mx-auto px-6 py-8">{brand(true)}</div>);
  }

  if (cfg.layout === 'CENTER') {
    return shell(
      <div className="max-w-6xl mx-auto px-6 py-14 ps-foot-cols">
        {brand(true)}
        {explore}
        {contact}
      </div>,
    );
  }

  if (cfg.layout === 'TOWER') {
    return shell(
      <div className="max-w-6xl mx-auto px-6 py-14 ps-foot-tower-in">
        <div className="ps-head ps-foot-bigname">{schoolName}</div>
        <div className="ps-foot-inline">
          {exploreLinks.map((l) => (
            <span key={l.href}>{linkEl(l)}</span>
          ))}
        </div>
        <div className="ps-foot-chips">
          {p?.phone && <a href={telHref(p.phone)} className="ps-foot-chip"><Ico name="phone" />{p.phone}</a>}
          {p?.email && <a href={`mailto:${p.email}`} className="ps-foot-chip"><Ico name="mail" />{p.email}</a>}
          {hasPlace && (
            <a href={mapsHref([schoolName, addressLine, cityLine])} target="_blank" rel="noopener noreferrer" className="ps-foot-chip">
              <Ico name="pin" />
              {cityLine || addressLine}
            </a>
          )}
          {cfg.hours && <span className="ps-foot-chip"><Ico name="clock" />{cfg.hours}</span>}
        </div>
        {social}
      </div>,
    );
  }

  if (cfg.layout === 'LEDGER') {
    return shell(
      <div className="max-w-6xl mx-auto px-6 py-8 ps-foot-ledger-in">
        <div className="ps-foot-ledger-row">
          <div className="flex items-center gap-2.5">{crest}</div>
          <div className="ps-foot-inline">
            {exploreLinks.map((l) => (
              <span key={l.href}>{linkEl(l)}</span>
            ))}
          </div>
        </div>
        <div className="ps-foot-ledger-row ps-foot-ledger-meta">
          {p?.phone && <a href={telHref(p.phone)} className={`ps-foot-line ${linkCls}`}><Ico name="phone" />{p.phone}</a>}
          {p?.email && <a href={`mailto:${p.email}`} className={`ps-foot-line ${linkCls}`}><Ico name="mail" />{p.email}</a>}
          {hasPlace && (
            <a href={mapsHref([schoolName, addressLine, cityLine])} target="_blank" rel="noopener noreferrer" className={`ps-foot-line ${linkCls}`}>
              <Ico name="pin" />
              {cityLine || addressLine}
            </a>
          )}
          {cfg.hours && <span className="ps-foot-line"><Ico name="clock" />{cfg.hours}</span>}
          {social}
        </div>
      </div>,
    );
  }

  if (cfg.layout === 'POSTCARD') {
    return shell(
      <div className="max-w-6xl mx-auto px-6 py-14 ps-foot-postcard">
        <a
          href={mapsHref([schoolName, addressLine, cityLine, p?.postalCode])}
          target="_blank"
          rel="noopener noreferrer"
          className="ps-foot-place"
        >
          <span className="ps-head ps-foot-place-n">{schoolName}</span>
          {hasPlace && <span className="ps-foot-place-a">{placeLine}</span>}
          <span className="ps-foot-place-go">Open in Maps →</span>
        </a>
        <div className="ps-foot-postcard-cols">
          {explore}
          {contact}
        </div>
      </div>,
    );
  }

  if (cfg.layout === 'NOTICE') {
    return shell(
      <div className="max-w-6xl mx-auto px-6 py-14 ps-foot-notice-in">
        {brand(true)}
        {explore}
        {contact}
        {admissions}
      </div>,
    );
  }

  // COLUMNS — the shipped arrangement, with the blocks above.
  return shell(
    <div className="max-w-6xl mx-auto px-6 py-14 grid md:grid-cols-3 gap-8">
      {brand(true)}
      {explore}
      {contact}
    </div>,
  );
}
