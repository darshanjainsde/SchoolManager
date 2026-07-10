'use client';

import { useEffect, useState } from 'react';
import type { PublicSiteData } from '@/lib/public-api';
import CoursesFeatured from './sections/CoursesFeatured';
import AcademicsSection from './sections/AcademicsSection';
import AdmissionsSection, { admissionsHasContent } from './sections/AdmissionsSection';
import HallOfFame, { hofCourses } from './sections/HallOfFame';
import GallerySection from './sections/GallerySection';
import EventsSection from './sections/EventsSection';
import ContactSection from './sections/ContactSection';

export type SiteView = 'home' | 'academics' | 'admissions' | 'gallery' | 'events' | 'contact';

interface Props {
  data: PublicSiteData;
  /** 'home' = full landing page; anything else = a dedicated section page with the same chrome. */
  view?: SiteView;
}

// Header copy for each dedicated section page.
const SUBPAGES: Record<string, { eyebrow: string; title: string; blurb: string }> = {
  academics: {
    eyebrow: 'Academics',
    title: 'Programmes at {school}',
    blurb: 'Everything we offer, from the earliest years up — tap a programme in the menu above to jump straight to it.',
  },
  admissions: {
    eyebrow: 'Admissions',
    title: 'Joining {school}',
    blurb: 'How admissions work, step by step — and the full fee structure.',
  },
  gallery: {
    eyebrow: 'Gallery',
    title: 'Life at {school}',
    blurb: 'Moments from classrooms, playgrounds and celebrations across the campus.',
  },
  events: {
    eyebrow: 'Connect · Events',
    title: 'Events & community',
    blurb: 'Everything happening at our school and across the network — one shared calendar.',
  },
  contact: {
    eyebrow: 'Contact',
    title: 'Get in touch',
    blurb: 'Reach the front office directly or leave your details — admissions responds within a working day.',
  },
};

const CLASS_EMOJIS = ['🎓', '🧸', '📚', '🔬', '🎨', '🏆', '🌟', '💡', '🎯', '🚀'];

const FONT_MAP: Record<string, string> = {
  INTER: "'Inter', sans-serif",
  FRAUNCES: "'Fraunces', serif",
  POPPINS: "'Poppins', sans-serif",
  NUNITO: "'Nunito', sans-serif",
};
const MOTION_MAP: Record<string, number> = { FULL: 1, SUBTLE: 0.5, NONE: 0 };

// ── Brand-colour helpers ────────────────────────────────────────────────────
function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function isNearWhite(hex: string): boolean {
  const rgb = hexToRgb(hex);
  if (!rgb) return false;
  return rgb.every((c) => c >= 235);
}
/** Blend a hex colour toward white by `amt` (0..1). */
function lighten(hex: string, amt: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const [r, g, b] = rgb.map((c) => Math.round(c + (255 - c) * amt));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}
/** Blend one hex toward another by `amt` (0..1). */
function mix(hex: string, target: string, amt: number): string {
  const a = hexToRgb(hex);
  const b = hexToRgb(target);
  if (!a || !b) return hex;
  const [r, g, bl] = a.map((v, i) => Math.round(v + (b[i] - v) * amt));
  return `#${((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1)}`;
}

function parseStatValue(val: string): { numeric: boolean; num: number; suffix: string } {
  const clean = val.trim();
  const match = clean.match(/^(\d+(?:\.\d+)?)\s*([%+]?)$/);
  if (match) {
    return { numeric: true, num: Number(match[1]), suffix: match[2] ?? '' };
  }
  return { numeric: false, num: 0, suffix: '' };
}

// Static, theme-variable-driven CSS. Colours/font/motion come from CSS vars set
// per-render on the root, so the same stylesheet themes each school.
const PS_CSS = `
  .ps-root { font-family: 'Inter', sans-serif; background: var(--paper); color: #43514a; overflow-x: hidden; min-height: 100vh; }
  .ps-head { font-family: var(--font-head); color: var(--ink); letter-spacing: -.01em; }
  /* This stylesheet loads after Tailwind, so .ps-head's ink color silently beat
     Tailwind's .text-white on dark sections (invisible headings/names on the
     Hall of Fame & Events). Re-assert white when both classes are present. */
  .ps-head.text-white { color: #fff; }

  .ps-soft { box-shadow: 0 22px 48px -24px rgba(28,45,36,.38); }
  .ps-card { background: #fff; border: 1px solid rgba(28,45,36,.07); }
  .ps-chip { background: color-mix(in srgb, var(--ps1) 12%, #fff); color: var(--ps1); }
  .ps-brandbg { background: var(--ps1); }
  .ps-accentbg { background: var(--ps2); }
  .ps-brandgrad { background: linear-gradient(120deg, var(--ps1), color-mix(in srgb, var(--ps1) 55%, var(--ps2))); }
  .ps-logo-bg { background: linear-gradient(135deg, var(--ps1), var(--ps2)); }
  .ps-cta-btn { background: var(--ps1); color: #fff; }
  .ps-icon-bg { background: linear-gradient(135deg, var(--ps2), var(--ps1)); }
  .ps-progress-bar { background: linear-gradient(90deg, var(--ps1), var(--ps2)); height: 100%; }

  /* gradient/underline accents */
  .ps-grad-text { background: linear-gradient(100deg,var(--ps1),color-mix(in srgb, var(--ps1) 40%, var(--ps2))); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .ps-about-glow { background: linear-gradient(135deg, color-mix(in srgb, var(--ps1) 20%, transparent), color-mix(in srgb, var(--ps2) 20%, transparent)); filter: blur(2rem); }

  /* ── School-themed motion, all scaled by --motion (0..1) ── */
  @keyframes ps-floaty { 0%,100%{transform:translateY(0)} 50%{transform:translateY(calc(-12px * var(--motion)))} }
  .ps-float { animation: ps-floaty calc(7s / (var(--motion) + .06)) ease-in-out infinite; }
  .ps-d1 { animation-delay: -2.5s; }
  .ps-d2 { animation-delay: -4.5s; }
  @keyframes ps-sway { 0%,100%{transform:rotate(calc(-3deg * var(--motion)))} 50%{transform:rotate(calc(3deg * var(--motion)))} }
  .ps-sway { animation: ps-sway calc(5s / (var(--motion) + .06)) ease-in-out infinite; transform-origin: top center; }
  @keyframes ps-twinkle { 0%,100%{opacity: calc(1 - .65 * var(--motion))} 50%{opacity:1} }
  .ps-twinkle { animation: ps-twinkle calc(3.2s / (var(--motion) + .06)) ease-in-out infinite; }
  @keyframes ps-shine { to { background-position: 200% center; } }

  /* reveal on scroll */
  .reveal { opacity: 0; transform: translateY(calc(26px * var(--motion) + 4px)); transition: opacity .7s cubic-bezier(.2,.7,.2,1), transform .7s cubic-bezier(.2,.7,.2,1); }
  .reveal.in { opacity: 1; transform: none; }

  /* hand-drawn underline draws itself once */
  @keyframes ps-draw { to { stroke-dashoffset: 0; } }
  .ps-underline path { stroke-dasharray: 300; stroke-dashoffset: 300; animation: ps-draw 1.5s ease .35s forwards; }

  /* gentle lift on hover */
  .ps-lift { transition: transform .35s cubic-bezier(.2,.7,.2,1), box-shadow .35s; }
  .ps-lift:hover { transform: translateY(-6px); box-shadow: 0 30px 60px -28px rgba(28,45,36,.45); }

  /* glow button */
  .btn-glow { position: relative; overflow: hidden; }
  .btn-glow::after { content: ""; position: absolute; inset: 0; background: radial-gradient(120px circle at var(--x,50%) var(--y,50%),rgba(255,255,255,.28),transparent 60%); opacity: 0; transition: opacity .3s; }
  .btn-glow:hover::after { opacity: 1; }

  /* ── Academics nav dropdown ── */
  .ps-acad { position: relative; }
  .ps-dropdown { position: absolute; top: calc(100% + 8px); left: 50%; transform: translateX(-50%) translateY(6px);
    width: 420px; max-width: 90vw; background: #fff; border: 1px solid rgba(28,45,36,.08); border-radius: 20px;
    box-shadow: 0 26px 56px -22px rgba(28,45,36,.4); padding: 12px; opacity: 0; visibility: hidden;
    transition: opacity .22s, transform .22s, visibility .22s; z-index: 60;
    display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
  .ps-acad:hover .ps-dropdown, .ps-acad:focus-within .ps-dropdown { opacity: 1; visibility: visible; transform: translateX(-50%) translateY(0); }

  /* ── Course flip cards ── */
  .ps-flip { perspective: 1200px; height: 340px; cursor: pointer; outline-offset: 4px; }
  .ps-flip-inner { position: relative; width: 100%; height: 100%; transform-style: preserve-3d;
    transition: transform .65s cubic-bezier(.2,.7,.2,1); }
  .ps-flipped .ps-flip-inner { transform: rotateY(180deg); }
  .ps-face { position: absolute; inset: 0; backface-visibility: hidden; -webkit-backface-visibility: hidden;
    border-radius: 1.5rem; overflow: hidden; display: flex; flex-direction: column; }
  .ps-face-back { transform: rotateY(180deg);
    background: linear-gradient(150deg, var(--ps1), color-mix(in srgb, var(--ps1) 45%, #14261d)); }

  /* ── Hall of fame podium rise ── */
  @keyframes ps-rise { to { opacity: 1; transform: none; } }
  .ps-champ { opacity: 0; transform: translateY(26px); animation: ps-rise .7s cubic-bezier(.2,.7,.2,1) forwards; }
  .ps-champ-2 { animation-delay: .18s; }
  .ps-champ-3 { animation-delay: .34s; }

  @media (prefers-reduced-motion: reduce) {
    .ps-root { --motion: 0 !important; }
    .reveal { opacity: 1; transform: none; }
    .ps-underline path { stroke-dashoffset: 0; }
    .ps-flip-inner { transition: none; }
    .ps-dropdown { transition: none; }
    .ps-champ { animation: none; opacity: 1; transform: none; }
  }
`;

export default function PublicSite({ data, view = 'home' }: Props) {
  const onAcademicsPage = view === 'academics';
  // Section anchors live on the homepage; from other pages they need the "/" prefix.
  const base = view !== 'home' ? '/' : '';
  const brandColor = data.profile?.brandColorPrimary ?? '#2f6b4f';
  // Secondary drives the second gradient stop. If a school leaves it near-white
  // (the default), a lightened tint of the primary reads better than pure white.
  const rawSecondary = data.profile?.brandColorSecondary ?? '#e8b04b';
  const brandColor2 = isNearWhite(rawSecondary) ? lighten(brandColor, 0.4) : rawSecondary;
  const ink = mix(brandColor, '#14261d', 0.55); // deep heading tone derived from primary

  // Theme controls
  const fontHead = FONT_MAP[data.profile?.headingFont ?? 'INTER'] ?? FONT_MAP.INTER;
  const motion = MOTION_MAP[data.profile?.animationLevel ?? 'FULL'] ?? 1;
  const heroStyleRaw = data.profile?.heroStyle ?? 'ILLUSTRATION';

  const schoolName = data.school.name;
  const headline = data.homepage?.headline ?? schoolName;
  const subheadline = data.homepage?.subheadline;
  const heroUrl = data.homepage?.heroUrl;
  const aboutText = data.homepage?.aboutText;
  const hasAbout = !!aboutText;
  // Feature-backed sections are gated on the school's plan entitlements (not on
  // whether content exists yet), so the navbar stays consistent from day one —
  // an enabled-but-empty section renders with an empty state instead of vanishing.
  const hasGallery = data.school.features.includes('GALLERY');
  const hasContact = !!(
    data.profile?.phone ||
    data.profile?.email ||
    data.profile?.addressLine1
  );
  const hasEnquiry = data.school.features.includes('ENQUIRY');
  const hasEvents = data.school.features.includes('EVENTS');
  const hasAcademics = data.courses.length > 0;
  const hasAdmissions = admissionsHasContent(data.admissions, data.courses);
  const hasHof = hofCourses(data.courses).length > 0;
  // Admin-controlled homepage visibility; full details always live on the
  // dedicated pages (/admissions, /gallery, /connect, /contact).
  const show = {
    admissions: data.homepage?.showAdmissions ?? true,
    gallery: data.homepage?.showGallery ?? true,
    events: data.homepage?.showEvents ?? true,
    contact: data.homepage?.showContact ?? true,
  };
  // Enquire CTAs anchor to the homepage section when it's shown, else go to /contact.
  const enquireHref = show.contact && (hasContact || hasEnquiry) ? `${base}#enquire` : '/contact';
  const logoUrl = data.profile?.logoUrl;
  const principalName = data.homepage?.principalName;
  const principalMessage = data.homepage?.principalMessage;
  const principalPhotoUrl = data.homepage?.principalPhotoUrl;
  const aboutImageUrl = data.homepage?.aboutImageUrl;

  // PHOTO = the school's photo (building etc.) as a full-viewport backdrop
  // BEHIND the regular animated hero — layout, animations and dark text stay
  // exactly as the illustrated hero; a paper-tinted wash keeps it readable.
  // Needs an image; without one it's just the illustrated hero.
  const photoBackdrop = heroStyleRaw === 'PHOTO' && !!heroUrl;
  const heroStyle = heroStyleRaw === 'PHOTO' ? 'ILLUSTRATION' : heroStyleRaw;
  const minimal = heroStyle === 'MINIMAL';

  useEffect(() => {
    // Nav elevate on scroll
    const nav = document.getElementById('ps-nav');
    const handleScroll = () => {
      if (!nav) return;
      nav.classList.toggle('ps-nav-scrolled', window.scrollY > 30);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });

    // Reveal on scroll
    const revealObs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            (e.target as HTMLElement).classList.add('in');
            revealObs.unobserve(e.target);
          }
        });
      },
      { threshold: 0.15 }
    );
    document.querySelectorAll('.reveal').forEach((el) => revealObs.observe(el));

    // Count-up
    const countObs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            const el = e.target as HTMLElement;
            const to = Number(el.dataset.to);
            if (isNaN(to)) return;
            const suffix = el.dataset.suffix ?? '';
            let n = 0;
            const step = Math.max(1, Math.round(to / 60));
            const timer = setInterval(() => {
              n += step;
              if (n >= to) {
                n = to;
                clearInterval(timer);
              }
              el.textContent = (to >= 1000 ? n.toLocaleString() : String(n)) + suffix;
            }, 18);
            countObs.unobserve(el);
          }
        });
      },
      { threshold: 0.6 }
    );
    document.querySelectorAll('.count').forEach((el) => countObs.observe(el));

    // Magnetic glow buttons
    const handleMouseMove = (e: MouseEvent) => {
      const b = e.currentTarget as HTMLElement;
      const r = b.getBoundingClientRect();
      b.style.setProperty('--x', `${e.clientX - r.left}px`);
      b.style.setProperty('--y', `${e.clientY - r.top}px`);
    };
    const btns = document.querySelectorAll<HTMLElement>('.btn-glow');
    btns.forEach((b) => b.addEventListener('mousemove', handleMouseMove));

    return () => {
      window.removeEventListener('scroll', handleScroll);
      revealObs.disconnect();
      countObs.disconnect();
      btns.forEach((b) => b.removeEventListener('mousemove', handleMouseMove));
    };
  }, []);

  // Hero text stays dark even on the photo backdrop — the paper wash keeps it
  // readable, so the ink/underline/chip styling is identical across themes.
  const heroTextLight = false;

  return (
    <div
      className="ps-root"
      style={
        {
          '--ps1': brandColor,
          '--ps2': brandColor2,
          '--ink': ink,
          '--font-head': fontHead,
          '--motion': minimal ? 0.25 : motion,
          '--paper': '#f7f5ef',
        } as React.CSSProperties
      }
    >
      {/* Injected theme CSS */}
      <style dangerouslySetInnerHTML={{ __html: PS_CSS }} />

      {/* Google Fonts — all four heading families */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link
        href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400..700&family=Poppins:wght@400;500;600;700&family=Nunito:wght@400;600;700;800&family=Inter:wght@400;500;600;700&display=swap"
        rel="stylesheet"
      />

      {/* ── NAV ── */}
      <header
        id="ps-nav"
        className="sticky top-0 z-50 transition-all duration-300 bg-[var(--paper)]/85 backdrop-blur border-b border-black/5 [&.ps-nav-scrolled]:shadow-sm"
      >
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {logoUrl ? (
              <img src={logoUrl} alt={schoolName} className="h-10 w-auto" />
            ) : (
              <span className="h-10 w-10 rounded-2xl ps-logo-bg grid place-items-center font-bold text-white ps-head">
                {schoolName.charAt(0)}
              </span>
            )}
            <span className="ps-head font-bold text-lg">{schoolName}</span>
          </div>

          <nav className="hidden md:flex items-center gap-1 text-sm text-slate-600">
            <a className="px-3 py-2 rounded-lg hover:bg-black/5 transition" href={`${base}#home`}>Home</a>
            {hasAbout && (
              <a className="px-3 py-2 rounded-lg hover:bg-black/5 transition" href={`${base}#about`}>About</a>
            )}
            {hasAcademics && (
              <div className="ps-acad">
                <a className="px-3 py-2 rounded-lg hover:bg-black/5 transition inline-block" href="/academics">
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
            {hasAdmissions && (
              <a className="px-3 py-2 rounded-lg hover:bg-black/5 transition" href="/admissions">Admissions</a>
            )}
            {hasHof && (
              <a className="px-3 py-2 rounded-lg hover:bg-black/5 transition" href={`${base}#hall-of-fame`}>Hall of Fame</a>
            )}
            {hasGallery && (
              <a className="px-3 py-2 rounded-lg hover:bg-black/5 transition" href="/gallery">Gallery</a>
            )}
            {hasEvents && (
              <a className="px-3 py-2 rounded-lg hover:bg-black/5 transition" href="/connect">Connect</a>
            )}
            {(hasContact || hasEnquiry) && (
              <a className="px-3 py-2 rounded-lg hover:bg-black/5 transition" href="/contact">Contact</a>
            )}
          </nav>

          <a
            href={enquireHref}
            className="btn-glow ps-accentbg text-sm font-semibold px-4 py-2 rounded-xl ps-soft hover:scale-[1.03] transition"
            style={{ color: ink }}
          >
            Enquire →
          </a>
        </div>
      </header>

      {view !== 'home' ? (
        <>
          {/* ── SUBPAGE BODY (academics / admissions / gallery / events / contact) ── */}
          <section className="max-w-6xl mx-auto px-6 pt-12">
            <a href="/" className="text-sm text-slate-500 hover:text-slate-800 transition">← Back to home</a>
            {SUBPAGES[view] && (
              <div className="reveal mt-6 max-w-2xl">
                <div className="text-sm font-semibold uppercase tracking-widest" style={{ color: 'var(--ps1)' }}>
                  {SUBPAGES[view].eyebrow}
                </div>
                <h1 className="ps-head text-5xl font-bold mt-3">
                  {SUBPAGES[view].title.replace('{school}', schoolName)}
                </h1>
                <p className="mt-4 text-slate-600">{SUBPAGES[view].blurb}</p>
              </div>
            )}
          </section>
          {view === 'academics' && <AcademicsSection courses={data.courses} />}
          {view === 'admissions' && <AdmissionsSection admissions={data.admissions} courses={data.courses} />}
          {view === 'gallery' && <GallerySection gallery={data.gallery} schoolName={schoolName} />}
          {view === 'events' && <EventsSection events={data.events} timezone={data.school.timezone} />}
          {view === 'contact' && (
            <ContactSection
              profile={data.profile}
              socialLinks={data.socialLinks}
              hasEnquiry={hasEnquiry}
              courses={data.courses.map((c) => c.name)}
              schoolName={schoolName}
            />
          )}
          {view !== 'contact' && (
            <section className="max-w-6xl mx-auto px-6 py-16 text-center">
              <h2 className="ps-head text-3xl font-bold">Want to know more?</h2>
              <p className="mt-2 text-slate-600">Our admissions team is happy to help with any question.</p>
              <a
                href="/contact"
                className="btn-glow ps-cta-btn inline-block mt-6 font-semibold px-6 py-3.5 rounded-xl ps-soft hover:scale-[1.03] transition"
              >
                Enquire now →
              </a>
            </section>
          )}
        </>
      ) : (
        <>
      {/* ── HERO ── */}
      <section
        id="home"
        className={`relative overflow-hidden ${photoBackdrop ? 'min-h-[calc(100vh-4rem)] flex items-center' : ''}`}
      >
        {/* School photo backdrop behind the regular hero (PHOTO theme) */}
        {photoBackdrop && (
          <div className="absolute inset-0" aria-hidden="true">
            <div
              className="absolute inset-0 bg-cover bg-center"
              style={{ backgroundImage: `url('${heroUrl}')` }}
            />
            {/* Paper wash: strong over the text column, light on the right so
                the photo reads clearly behind the floating cards. */}
            <div
              className="absolute inset-0"
              style={{
                background:
                  'linear-gradient(90deg, rgba(247,245,239,.9) 0%, rgba(247,245,239,.72) 42%, rgba(247,245,239,.3) 100%)',
              }}
            />
            {/* Fade into the page background so the next section blends in. */}
            <div
              className="absolute inset-x-0 bottom-0 h-24"
              style={{ background: 'linear-gradient(180deg, transparent, var(--paper))' }}
            />
          </div>
        )}

        <div
          className={`relative max-w-6xl mx-auto px-6 ${
            minimal ? 'py-24 text-center max-w-3xl' : 'pt-14 pb-20'
          } grid ${minimal ? 'grid-cols-1' : 'lg:grid-cols-2'} gap-12 items-center w-full`}
        >
          <div className={minimal ? 'mx-auto' : ''}>
            <div
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold mb-6 ${
                heroTextLight ? 'bg-white/15 text-white' : 'ps-chip'
              }`}
            >
              <span className="h-2 w-2 rounded-full ps-twinkle" style={{ background: brandColor2 }} />
              Admissions open · 2026–27
            </div>

            <h1 className={`ps-head text-5xl md:text-6xl font-bold leading-[1.06] ${heroTextLight ? 'text-white' : ''}`}>
              {headline}
              {!heroTextLight && (
                <svg className="ps-underline block mt-1 w-56 max-w-full" height="14" viewBox="0 0 260 14" fill="none">
                  <path d="M2 10 C 70 2, 190 2, 258 9" stroke="var(--ps2)" strokeWidth="5" strokeLinecap="round" />
                </svg>
              )}
            </h1>

            {subheadline && (
              <p className={`mt-6 text-lg max-w-md ${heroTextLight ? 'text-white/85' : 'text-slate-600'} ${minimal ? 'mx-auto' : ''}`}>
                {subheadline}
              </p>
            )}

            <div className={`mt-8 flex flex-wrap items-center gap-3 ${minimal ? 'justify-center' : ''}`}>
              <a
                href={enquireHref}
                className="btn-glow ps-cta-btn font-semibold px-6 py-3.5 rounded-xl ps-soft hover:scale-[1.03] transition"
              >
                Book a campus visit
              </a>
              {hasAbout && (
                <a
                  href="#about"
                  className={`px-6 py-3.5 rounded-xl font-semibold border transition ${
                    heroTextLight ? 'border-white/30 hover:bg-white/10 text-white' : 'ps-card hover:bg-black/[.03]'
                  }`}
                >
                  Explore ↓
                </a>
              )}
            </div>
          </div>

          {/* Illustrated animated cluster (only in the illustrated hero) */}
          {heroStyle === 'ILLUSTRATION' && (
            <div className="relative h-[400px] hidden lg:block">
              <div className="ps-float absolute top-2 right-4 w-64 rounded-3xl ps-card ps-soft p-2">
                {heroUrl ? (
                  <div className="rounded-2xl h-44 bg-cover bg-center" style={{ backgroundImage: `url('${heroUrl}')` }} />
                ) : (
                  <div className="rounded-2xl h-44 ps-brandgrad grid place-items-center text-white text-6xl">🏫</div>
                )}
                <div className="p-3 text-sm">
                  <b className="ps-head">Open Day</b>
                  <div className="text-slate-500 text-xs">Book a visit this term</div>
                </div>
              </div>
              <div className="ps-sway absolute bottom-4 left-2 text-6xl">🎓</div>
              <div className="ps-float ps-d1 absolute bottom-24 right-0 ps-card ps-soft rounded-2xl p-4 flex items-center gap-3">
                <span className="h-11 w-11 rounded-xl ps-accentbg grid place-items-center text-2xl">📚</span>
                <div>
                  <b className="ps-head text-sm">Reading club</b>
                  <div className="text-xs text-slate-500">every Friday</div>
                </div>
              </div>
              <div className="ps-float ps-d2 absolute top-6 left-8 ps-card ps-soft rounded-2xl p-4 w-44">
                <div className="text-xs text-slate-500">Every child</div>
                <div className="ps-head text-lg font-bold">known by name</div>
              </div>
              <div className="ps-twinkle absolute top-16 left-40 text-3xl">✏️</div>
              <div className="ps-twinkle absolute top-44 left-28 text-2xl" style={{ animationDelay: '-1s' }}>⭐</div>
            </div>
          )}
        </div>
      </section>

      {/* ── STATS ── */}
      {data.stats.length > 0 && (
        <section className="max-w-6xl mx-auto px-6 py-16 grid grid-cols-2 md:grid-cols-4 gap-6">
          {data.stats.map((stat, i) => {
            const parsed = parseStatValue(stat.value);
            return (
              <div
                key={i}
                className="reveal ps-card ps-soft rounded-2xl p-6 text-center"
                style={{ transitionDelay: `${i * 0.08}s` }}
              >
                {parsed.numeric ? (
                  <div
                    className="ps-head text-4xl font-bold ps-grad-text count"
                    data-to={String(parsed.num)}
                    data-suffix={parsed.suffix}
                  >
                    0
                  </div>
                ) : (
                  <div className="ps-head text-4xl font-bold ps-grad-text">{stat.value}</div>
                )}
                <div className="text-sm text-slate-500 mt-1">{stat.label}</div>
              </div>
            );
          })}
        </section>
      )}

      {/* ── ABOUT ── */}
      {hasAbout && (
        <section id="about" className="max-w-6xl mx-auto px-6 py-20 grid md:grid-cols-2 gap-14 items-center">
          <div className="reveal relative">
            <div className="absolute -inset-4 ps-about-glow rounded-3xl" />
            <div className="relative rounded-3xl overflow-hidden h-80 ps-card ps-soft">
              {aboutImageUrl || principalPhotoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={(aboutImageUrl ?? principalPhotoUrl)!}
                  alt={aboutImageUrl ? `About ${schoolName}` : principalName ?? 'Principal'}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full ps-brandgrad grid place-items-center text-6xl text-white">🏫</div>
              )}
            </div>
            {principalName && (
              <div className="ps-card ps-soft absolute -bottom-6 -right-4 rounded-2xl p-4 w-56">
                <div className="flex items-center gap-3">
                  {principalPhotoUrl && (
                    <img src={principalPhotoUrl} alt={principalName} className="h-11 w-11 rounded-full object-cover flex-shrink-0" />
                  )}
                  <div>
                    <div className="ps-head text-sm font-bold">{principalName}</div>
                    <div className="text-xs text-slate-500">Principal</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="reveal">
            <div className="text-sm font-semibold uppercase tracking-widest" style={{ color: brandColor }}>
              About
            </div>
            <h2 className="ps-head text-4xl font-bold mt-3">
              A community built on <span className="ps-grad-text">care &amp; curiosity</span>
            </h2>
            <p className="mt-5 text-slate-600 leading-relaxed">{aboutText}</p>
            {principalMessage && (
              <blockquote className="mt-5 text-slate-600 italic border-l-2 pl-4 text-sm" style={{ borderColor: brandColor }}>
                &ldquo;{principalMessage}&rdquo;
              </blockquote>
            )}
          </div>
        </section>
      )}

      {/* ── FEATURED COURSES (homepage flip cards) ── */}
      <CoursesFeatured courses={data.courses} />
      {/* Full catalogue lives on its own page now */}
      {hasAcademics && (
        <div className="max-w-6xl mx-auto px-6 -mt-8 pb-14">
          <a href="/academics" className="text-sm font-semibold hover:opacity-80 transition" style={{ color: 'var(--ps1)' }}>
            View all programmes →
          </a>
        </div>
      )}

      {/* ── ADMISSIONS (process + fee structure) ── */}
      {hasAdmissions && show.admissions && <AdmissionsSection admissions={data.admissions} courses={data.courses} />}

      {/* ── GALLERY ── */}
      {hasGallery && show.gallery && <GallerySection gallery={data.gallery} schoolName={schoolName} />}

      {/* ── HALL OF FAME (class-wise toppers) ── */}
      {hasHof && <HallOfFame courses={data.courses} />}

      {/* ── CONNECT / EVENTS ── */}
      {hasEvents && show.events && <EventsSection events={data.events} timezone={data.school.timezone} />}

      {/* ── EDUCATORS / STAFF ── */}
      {data.staff.length > 0 && (
        <section id="staff" className="max-w-6xl mx-auto px-6 py-20">
          <div className="reveal text-center max-w-2xl mx-auto">
            <div className="text-sm font-semibold uppercase tracking-widest" style={{ color: brandColor }}>
              Our people
            </div>
            <h2 className="ps-head text-4xl font-bold mt-3">Meet our educators</h2>
          </div>
          <div className="mt-12 grid grid-cols-2 md:grid-cols-4 gap-6">
            {data.staff.map((person, i) => (
              <div
                key={i}
                className="reveal ps-lift ps-card ps-soft rounded-3xl p-6 text-center"
                style={{ transitionDelay: `${i * 0.05}s` }}
              >
                <div className="mx-auto h-20 w-20 rounded-full overflow-hidden ps-logo-bg grid place-items-center text-2xl font-semibold text-white">
                  {person.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={person.photoUrl} alt={person.name} className="h-full w-full object-cover" />
                  ) : (
                    person.name.charAt(0)
                  )}
                </div>
                <div className="ps-head mt-4 font-bold">{person.name}</div>
                <div className="text-sm text-slate-500 mt-0.5">{person.role}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── CONTACT + ENQUIRY ── */}
      {(hasContact || hasEnquiry) && show.contact && (
        <ContactSection
          profile={data.profile}
          socialLinks={data.socialLinks}
          hasEnquiry={hasEnquiry}
          courses={data.courses.map((c) => c.name)}
          schoolName={schoolName}
        />
      )}
        </>
      )}

      {/* ── FOOTER ── */}
      <footer className="border-t border-black/10 mt-8">
        <div className="max-w-6xl mx-auto px-6 py-14 grid md:grid-cols-3 gap-8">
          <div>
            <div className="flex items-center gap-2.5">
              {logoUrl ? (
                <img src={logoUrl} alt={schoolName} className="h-9 w-auto" />
              ) : (
                <>
                  <span className="h-9 w-9 rounded-xl ps-logo-bg grid place-items-center font-bold text-white text-sm ps-head">
                    {schoolName.charAt(0)}
                  </span>
                  <span className="ps-head font-bold">{schoolName}</span>
                </>
              )}
            </div>
            <p className="text-sm text-slate-500 mt-3">Nurturing confident, compassionate lifelong learners.</p>
          </div>
          <div>
            <div className="ps-head font-bold mb-3">Explore</div>
            <ul className="space-y-2 text-sm text-slate-500">
              {hasAbout && <li><a href={`${base}#about`} className="hover:text-slate-900 transition">About</a></li>}
              {hasAcademics && <li><a href="/academics" className="hover:text-slate-900 transition">Academics</a></li>}
              {hasAdmissions && <li><a href="/admissions" className="hover:text-slate-900 transition">Admissions</a></li>}
              {hasHof && <li><a href={`${base}#hall-of-fame`} className="hover:text-slate-900 transition">Hall of Fame</a></li>}
              {hasGallery && <li><a href="/gallery" className="hover:text-slate-900 transition">Gallery</a></li>}
              {hasEvents && <li><a href="/connect" className="hover:text-slate-900 transition">Connect</a></li>}
              <li><a href="/contact" className="hover:text-slate-900 transition">Enquire</a></li>
            </ul>
          </div>
          <div>
            <div className="ps-head font-bold mb-3">Contact</div>
            <ul className="space-y-2 text-sm text-slate-500">
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
        </div>
        <div className="border-t border-black/10 text-center text-xs text-slate-400 py-4">
          © {new Date().getFullYear()} {schoolName} · Powered by Sckools
        </div>
      </footer>
    </div>
  );
}
