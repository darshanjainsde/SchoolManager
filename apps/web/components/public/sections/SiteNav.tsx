'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { PublicSiteData } from '@/lib/public-api';
import { heroIsPhotoLayout } from './HeroSection';
import { navModel, type NavNode } from './nav-model';
import NavGroup from './NavGroup';

// Mobile menu enter animation + reduced-motion handling. Scoped to this file
// (rendered once, only from the branch that's actually active) rather than
// the shared PS_CSS in PublicSite.tsx.
const MOBILE_MENU_CSS = `
  @keyframes ps-mmenu-in { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
  .ps-mmenu-panel { animation: ps-mmenu-in .22s cubic-bezier(.2,.7,.2,1); }
  @keyframes ps-mmenu-scrim-in { from { opacity: 0; } to { opacity: 1; } }
  .ps-mmenu-scrim { animation: ps-mmenu-scrim-in .22s ease; }
  @media (prefers-reduced-motion: reduce) {
    .ps-mmenu-panel, .ps-mmenu-scrim { animation: none; }
  }
  .ps-motion-off .ps-mmenu-panel, .ps-motion-off .ps-mmenu-scrim { animation: none; }
`;

export interface NavFlags {
  hasAbout: boolean;
  hasAcademics: boolean;
  hasAdmissions: boolean;
  hasHof: boolean;
  hasGallery: boolean;
  hasEvents: boolean;
  hasBlog: boolean;
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
        <img src={logoUrl} alt={schoolName} decoding="async" className={small ? 'h-9 w-auto' : 'h-10 w-auto'} />
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

/**
 * Every bar renders THIS — the desktop CLASSIC/PILL/GHOST/STRIP bar, the CENTER
 * bar's split halves and the mobile drawer. The lists used to be written out
 * three times and had already drifted apart: CENTER dropped Hall of Fame, and
 * the drawer flattened Academics to a single link. A page a school publishes
 * must not depend on which nav style it picked.
 */
function NavItems({
  nodes,
  mobile,
  onNavigate,
}: {
  nodes: NavNode[];
  /** Stacked, large-tap-target variant for the mobile drawer. */
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  const linkCls = mobile
    ? 'ps-nav-link block w-full px-3 py-3 rounded-xl hover:bg-black/5 transition text-base font-medium text-left'
    : 'ps-nav-link px-3 py-2 rounded-lg hover:bg-black/5 transition';
  return (
    <>
      {nodes.map((node) =>
        node.kind === 'group' ? (
          <NavGroup key={node.key} node={node} className={linkCls} inline={mobile} onNavigate={onNavigate} />
        ) : node.href.startsWith('/blog') ? (
          <Link key={node.key} className={linkCls} href={node.href}>
            {node.label}
          </Link>
        ) : (
          <a key={node.key} className={linkCls} href={node.href}>
            {node.label}
          </a>
        ),
      )}
    </>
  );
}

function Cta({
  data,
  enquireHref,
  ink,
  fullWidth,
}: {
  data: PublicSiteData;
  enquireHref: string;
  ink: string;
  fullWidth?: boolean;
}) {
  if (data.profile?.navShowCta === false) return null;
  const label = data.profile?.navCtaLabel?.trim() || 'Enquire';
  return (
    <a
      href={enquireHref}
      className={`btn-glow ps-accentbg text-sm font-semibold px-4 py-2 rounded-xl ps-soft hover:scale-[1.03] transition whitespace-nowrap${
        fullWidth ? ' flex items-center justify-center w-full' : ''
      }`}
      style={{ color: ink }}
    >
      {label} →
    </a>
  );
}

/**
 * Portal sign-in. Secondary to the Enquire CTA on purpose: it reuses the plain
 * `ps-nav-link` treatment so it inherits navColor/navTextColor/navStyle and
 * stays legible on PAPER/WHITE/DARK/BRAND bars, while the accent colour stays
 * reserved for the single primary action.
 */
function LoginLink({ data, fullWidth }: { data: PublicSiteData; fullWidth?: boolean }) {
  if (data.profile?.navShowLogin === false) return null;
  const label = data.profile?.navLoginLabel?.trim() || 'Login';
  return (
    <a
      href="/login"
      className={`ps-nav-link text-sm font-semibold px-3 py-2 rounded-lg hover:bg-black/5 transition whitespace-nowrap${
        fullWidth ? ' flex items-center justify-center w-full border border-black/10' : ''
      }`}
    >
      {label}
    </a>
  );
}

/** The nav's action pair — secondary Login then the primary CTA. */
function NavActions({ data, enquireHref, ink }: { data: PublicSiteData; enquireHref: string; ink: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <LoginLink data={data} />
      <Cta data={data} enquireHref={enquireHref} ink={ink} />
    </div>
  );
}

/** Mobile-only hamburger / close toggle. `ps-nav-link` gives it the same ink
 * colour as the rest of the bar across every navColor/ghost/onDark combo. */
function HamburgerButton({
  open,
  onClick,
  buttonRef,
}: {
  open: boolean;
  onClick: () => void;
  buttonRef: React.RefObject<HTMLButtonElement | null>;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      aria-label={open ? 'Close menu' : 'Open menu'}
      aria-expanded={open}
      aria-controls="ps-mobile-menu"
      className="ps-nav-link md:hidden inline-flex h-11 w-11 flex-none items-center justify-center rounded-lg hover:bg-black/5 transition"
    >
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        {open ? (
          <>
            <path d="M6 6l12 12" />
            <path d="M18 6l-12 12" />
          </>
        ) : (
          <>
            <path d="M4 7h16" />
            <path d="M4 12h16" />
            <path d="M4 17h16" />
          </>
        )}
      </svg>
    </button>
  );
}

/**
 * Slide-down mobile panel: same NavLinks (simplified) + Login/CTA, stacked
 * with large tap targets. Positioned `absolute` below the bar (the header is
 * always sticky/fixed, so it's a valid containing block) so opening it never
 * shifts page layout — it overlays instead.
 */
function MobileMenu({
  data,
  nodes,
  enquireHref,
  ink,
  barCls,
  onClose,
  panelRef,
}: {
  data: PublicSiteData;
  nodes: NavNode[];
  enquireHref: string;
  ink: string;
  /** Same bar-colour + onDark classes as the header, applied directly to the
   * panel so it always renders with an opaque, on-theme background — even
   * under GHOST, whose transparency-until-scrolled rule only targets the bar
   * itself, not this panel. */
  barCls: string;
  onClose: () => void;
  panelRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      id="ps-mobile-menu"
      ref={panelRef}
      className={`ps-mmenu-panel md:hidden absolute inset-x-0 top-full z-40 ${barCls} border-t border-black/5 shadow-xl max-h-[calc(100vh-4rem)] overflow-y-auto`}
    >
      <nav
        aria-label="Mobile"
        className="flex flex-col gap-1 px-4 pt-3 pb-1 text-slate-600"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('a')) onClose();
        }}
      >
        <NavItems nodes={nodes} mobile onNavigate={onClose} />
      </nav>
      <div className="flex flex-col gap-2 px-4 pb-5 pt-3 border-t border-black/5 mt-2">
        <LoginLink data={data} fullWidth />
        <Cta data={data} enquireHref={enquireHref} ink={ink} fullWidth />
      </div>
    </div>
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

  // The one model every bar below reads.
  const nodes = navModel({
    flags,
    base,
    courses: data.courses,
    onAcademicsPage,
    config: data.profile?.navConfig ?? null,
  });

  // Mobile menu open/close state, shared across every layout branch below.
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuPanelRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(false);

  // Lock body scroll while the panel is open.
  useEffect(() => {
    if (!mobileOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [mobileOpen]);

  // Escape closes; Tab/Shift+Tab wraps focus within the panel while open.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileOpen(false);
        return;
      }
      if (e.key === 'Tab' && menuPanelRef.current) {
        const focusables = menuPanelRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled])');
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [mobileOpen]);

  // Move focus into the panel on open, and back to the trigger on close (but
  // not on initial mount, when it was never open).
  useEffect(() => {
    if (mobileOpen) {
      const first = menuPanelRef.current?.querySelector<HTMLElement>('a[href], button:not([disabled])');
      first?.focus();
    } else if (wasOpenRef.current) {
      menuButtonRef.current?.focus();
    }
    wasOpenRef.current = mobileOpen;
  }, [mobileOpen]);

  const closeMobileMenu = () => setMobileOpen(false);
  const mobileMenuScrim = mobileOpen && (
    <div
      className="ps-mmenu-scrim fixed inset-0 z-30 bg-black/30 md:hidden"
      aria-hidden="true"
      onClick={closeMobileMenu}
    />
  );

  // Admin-picked bar colour. `onDark` flips link/name colours via ps-nav-ondark.
  const navColor = profile?.navColor ?? 'PAPER';
  const color =
    {
      PAPER: { bar: 'ps-navc-paper', onDark: false },
      WHITE: { bar: 'ps-navc-white', onDark: false },
      DARK: { bar: 'ps-navc-dark', onDark: true },
      BRAND: { bar: 'ps-navc-brand', onDark: true },
    }[navColor] ?? { bar: 'ps-navc-paper', onDark: false };
  // Text colour: AUTO follows the bar colour; LIGHT/DARK are explicit admin
  // overrides that win on every style.
  const navText = profile?.navTextColor ?? 'AUTO';
  const lightText = navText === 'LIGHT' || (navText === 'AUTO' && color.onDark);
  const onDarkCls = lightText ? ' ps-nav-ondark' : '';

  // On a photo homepage the pill overlays the hero (fixed) so the photo fills
  // the screen edge-to-edge behind it — that's what makes it read as floating.
  const pillOverlay = pill && view === 'home' && heroIsPhotoLayout(data);

  // Ghost link colour before scroll. AUTO follows the hero overlay: a paper
  // wash lightens the photo (white links vanish) so it gets dark ink; tint and
  // dark-cinema overlays keep white.
  const ghostDarkText =
    ghost &&
    (navText === 'DARK' || (navText === 'AUTO' && (profile?.heroOverlayStyle ?? 'WASH') === 'WASH'));
  const ghostCls = ghost ? ` ps-nav-ghost${ghostDarkText ? ' ps-nav-ghost-darktext' : ''}` : '';

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
      <>
        <style>{MOBILE_MENU_CSS}</style>
        {mobileMenuScrim}
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
            <nav aria-label="Primary" className="hidden md:flex items-center gap-1 text-sm text-slate-600">
              <NavItems nodes={nodes} />
            </nav>
            <div className="flex items-center gap-1.5">
              <NavActions data={data} enquireHref={enquireHref} ink={ink} />
              <HamburgerButton open={mobileOpen} onClick={() => setMobileOpen((o) => !o)} buttonRef={menuButtonRef} />
            </div>
          </div>
          {mobileOpen && (
            <MobileMenu
              data={data}
              nodes={nodes}
              enquireHref={enquireHref}
              ink={ink}
              barCls={`${color.bar}${onDarkCls} mx-4 mt-2 rounded-2xl`}
              onClose={closeMobileMenu}
              panelRef={menuPanelRef}
            />
          )}
        </header>
      </>
    );
  }

  // CENTER: links split around a centered crest (desktop); classic on mobile.
  if (style === 'CENTER') {
    return (
      <>
        <style>{MOBILE_MENU_CSS}</style>
        {mobileMenuScrim}
        <header
          id="ps-nav"
          className={`sticky top-0 z-50 transition-all duration-300 ${color.bar}${onDarkCls} backdrop-blur border-b border-black/5 [&.ps-nav-scrolled]:shadow-sm`}
        >
          {/* One nav, split around the crest — not two lists that can drift.
              The crest sits inside it because it is the link home, which is why
              there is no Home control to spend a slot on. */}
          <nav
            aria-label="Primary"
            className="max-w-6xl mx-auto px-6 h-16 hidden md:grid grid-cols-[1fr_auto_1fr] items-center gap-4 text-sm text-slate-600"
          >
            <span className="flex items-center justify-end gap-1">
              <NavItems nodes={nodes.slice(0, Math.ceil(nodes.length / 2))} />
            </span>
            <Logo data={data} />
            <span className="flex items-center gap-1">
              <NavItems nodes={nodes.slice(Math.ceil(nodes.length / 2))} />
              <span className="ml-2"><NavActions data={data} enquireHref={enquireHref} ink={ink} /></span>
            </span>
          </nav>
          <div className="max-w-6xl mx-auto px-6 h-16 flex md:hidden items-center justify-between">
            <Logo data={data} />
            <div className="flex items-center gap-1.5">
              <NavActions data={data} enquireHref={enquireHref} ink={ink} />
              <HamburgerButton open={mobileOpen} onClick={() => setMobileOpen((o) => !o)} buttonRef={menuButtonRef} />
            </div>
          </div>
          {mobileOpen && (
            <MobileMenu
              data={data}
              nodes={nodes}
              enquireHref={enquireHref}
              ink={ink}
              barCls={`${color.bar}${onDarkCls}`}
              onClose={closeMobileMenu}
              panelRef={menuPanelRef}
            />
          )}
        </header>
      </>
    );
  }

  // CLASSIC / STRIP / GHOST share the classic bar; STRIP adds the ribbon,
  // GHOST starts transparent and turns solid via the scroll class.
  return (
    <>
      <style>{MOBILE_MENU_CSS}</style>
      {mobileMenuScrim}
      <header
        id="ps-nav"
        className={
          ghost
            ? `${color.bar}${onDarkCls}${ghostCls} fixed top-0 inset-x-0 z-50 transition-all duration-300 border-b border-transparent [&.ps-nav-scrolled]:shadow-sm`
            : `sticky top-0 z-50 transition-all duration-300 ${color.bar}${onDarkCls} backdrop-blur border-b border-black/5 [&.ps-nav-scrolled]:shadow-sm`
        }
      >
        {strip}
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Logo data={data} />
          <nav aria-label="Primary" className="hidden md:flex items-center gap-1 text-sm text-slate-600">
            <NavItems nodes={nodes} />
          </nav>
          <div className="flex items-center gap-1.5">
            <NavActions data={data} enquireHref={enquireHref} ink={ink} />
            <HamburgerButton open={mobileOpen} onClick={() => setMobileOpen((o) => !o)} buttonRef={menuButtonRef} />
          </div>
        </div>
        {mobileOpen && (
          <MobileMenu
            data={data}
            nodes={nodes}
            enquireHref={enquireHref}
            ink={ink}
            barCls={`${color.bar}${onDarkCls}`}
            onClose={closeMobileMenu}
            panelRef={menuPanelRef}
          />
        )}
      </header>
    </>
  );
}
