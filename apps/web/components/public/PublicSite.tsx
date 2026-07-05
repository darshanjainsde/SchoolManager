'use client';

import { useEffect, useState } from 'react';
import type { PublicSiteData } from '@/lib/public-api';

interface Props {
  data: PublicSiteData;
}

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

// Admin-controlled URLs are rendered into href/src. React only warns on
// `javascript:` — it does not block it — so validate the scheme ourselves.
function safeHttpUrl(u: string | null | undefined): string | null {
  return u && /^https?:\/\//i.test(u) ? u : null;
}
function safeHttpsUrl(u: string | null | undefined): string | null {
  return u && /^https:\/\//i.test(u) ? u : null;
}

// Format an event's start in the SCHOOL's timezone with a fixed locale, so the
// server (often UTC) and the client produce identical strings — otherwise
// `toLocale*` with the runtime locale/zone causes a hydration mismatch.
function formatEventDate(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone,
    }).format(new Date(iso));
  } catch {
    // Bad/unknown timezone → fall back to UTC (still deterministic).
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'UTC',
    }).format(new Date(iso));
  }
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

  @media (prefers-reduced-motion: reduce) {
    .ps-root { --motion: 0 !important; }
    .reveal { opacity: 1; transform: none; }
    .ps-underline path { stroke-dashoffset: 0; }
  }
`;

export default function PublicSite({ data }: Props) {
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
  // Nav/footer gallery links must track the actual section, which only renders
  // when there are images.
  const hasGallery = data.gallery.length > 0;
  const hasContact = !!(
    data.profile?.phone ||
    data.profile?.email ||
    data.profile?.addressLine1
  );
  const hasEnquiry = data.school.features.includes('ENQUIRY');
  const hasEvents = data.events.length > 0;
  const logoUrl = data.profile?.logoUrl;
  const principalName = data.homepage?.principalName;
  const principalMessage = data.homepage?.principalMessage;
  const principalPhotoUrl = data.homepage?.principalPhotoUrl;

  // PHOTO hero needs an image; fall back to the illustrated hero if none.
  const heroStyle = heroStyleRaw === 'PHOTO' && !heroUrl ? 'ILLUSTRATION' : heroStyleRaw;
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

  const heroTextLight = heroStyle === 'PHOTO';

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
            <a className="px-3 py-2 rounded-lg hover:bg-black/5 transition" href="#home">Home</a>
            {hasAbout && (
              <a className="px-3 py-2 rounded-lg hover:bg-black/5 transition" href="#about">About</a>
            )}
            {data.menu.length > 0 && (
              <a className="px-3 py-2 rounded-lg hover:bg-black/5 transition" href="#academics">Academics</a>
            )}
            {hasGallery && (
              <a className="px-3 py-2 rounded-lg hover:bg-black/5 transition" href="#gallery">Gallery</a>
            )}
            {hasEvents && (
              <a className="px-3 py-2 rounded-lg hover:bg-black/5 transition" href="#events">Connect</a>
            )}
            {hasContact && (
              <a className="px-3 py-2 rounded-lg hover:bg-black/5 transition" href="#enquire">Contact</a>
            )}
          </nav>

          <a
            href="#enquire"
            className="btn-glow ps-accentbg text-sm font-semibold px-4 py-2 rounded-xl ps-soft hover:scale-[1.03] transition"
            style={{ color: ink }}
          >
            Enquire →
          </a>
        </div>
      </header>

      {/* ── HERO ── */}
      <section
        id="home"
        className={`relative overflow-hidden ${heroStyle === 'PHOTO' ? 'text-white' : ''}`}
      >
        {/* Photo background variant */}
        {heroStyle === 'PHOTO' && heroUrl && (
          <div className="absolute inset-0">
            <div
              className="absolute inset-0 bg-cover bg-center"
              style={{ backgroundImage: `url('${heroUrl}')` }}
            />
            <div className="absolute inset-0 bg-gradient-to-b from-[#14261d]/70 to-[#14261d]/45" />
          </div>
        )}

        <div
          className={`relative max-w-6xl mx-auto px-6 ${
            minimal ? 'py-24 text-center max-w-3xl' : 'pt-14 pb-20'
          } grid ${minimal || heroStyle === 'PHOTO' ? 'grid-cols-1' : 'lg:grid-cols-2'} gap-12 items-center w-full`}
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
                href="#enquire"
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
              {principalPhotoUrl ? (
                <img src={principalPhotoUrl} alt={principalName ?? 'Principal'} className="w-full h-full object-cover" />
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

      {/* ── ACADEMICS ── */}
      {data.menu.length > 0 && (
        <section id="academics" className="max-w-6xl mx-auto px-6 py-20">
          <div className="reveal text-center max-w-2xl mx-auto">
            <div className="text-sm font-semibold uppercase tracking-widest" style={{ color: brandColor }}>
              Academics
            </div>
            <h2 className="ps-head text-4xl font-bold mt-3">Programmes for every stage</h2>
            <p className="mt-3 text-slate-600">Explore our class-wise academic programmes.</p>
          </div>

          <div className="mt-12 grid md:grid-cols-3 gap-5">
            {data.menu.map((item, i) => (
              <div
                key={item.gradeId}
                className="reveal ps-lift ps-card ps-soft rounded-3xl p-6 flex flex-col justify-end cursor-pointer"
                style={{ transitionDelay: `${i * 0.05}s`, minHeight: '150px' }}
              >
                <div className="text-4xl mb-2">{CLASS_EMOJIS[i % CLASS_EMOJIS.length]}</div>
                <h3 className="ps-head text-xl font-bold">{item.label}</h3>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── GALLERY ── */}
      {data.gallery.length > 0 && (
        <section id="gallery" className="max-w-6xl mx-auto px-6 py-20">
          <div className="reveal">
            <div className="text-sm font-semibold uppercase tracking-widest" style={{ color: brandColor }}>
              Gallery
            </div>
            <h2 className="ps-head text-4xl font-bold mt-3">Life at {schoolName}</h2>
          </div>
          <div className="mt-10 grid grid-cols-2 md:grid-cols-4 gap-4">
            {data.gallery.map((img, i) => (
              <div
                key={i}
                className="reveal group relative rounded-2xl overflow-hidden ps-card ps-soft"
                style={{ transitionDelay: `${i * 0.05}s` }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.url}
                  alt={img.caption ?? `${schoolName} gallery ${i + 1}`}
                  className="h-48 w-full object-cover transition duration-500 group-hover:scale-105"
                />
                {img.caption && (
                  <>
                    <div className="absolute inset-0 bg-gradient-to-t from-[#14261d]/75 to-transparent opacity-0 group-hover:opacity-100 transition" />
                    <div className="absolute bottom-3 left-3 text-sm font-medium text-white opacity-0 group-hover:opacity-100 transition">
                      {img.caption}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── CONNECT / EVENTS ── */}
      {hasEvents && (
        <section id="events" className="ps-brandgrad text-white">
          <div className="max-w-6xl mx-auto px-6 py-20">
            <div className="reveal">
              <div className="text-sm font-semibold uppercase tracking-widest text-white/80">Connect · Events</div>
              <h2 className="ps-head text-4xl font-bold mt-3 text-white">What&rsquo;s on across our network</h2>
              <p className="mt-2 text-white/80 max-w-xl">
                Events from every school in the network — one shared calendar for the whole community.
              </p>
            </div>
            <div className="mt-10 grid md:grid-cols-3 gap-5">
              {data.events.map((e, i) => {
                const coverSrc = safeHttpUrl(e.coverUrl);
                const metaLine = [formatEventDate(e.startAt, data.school.timezone), e.venue ? `· ${e.venue}` : null]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <div
                    key={e.id}
                    className="reveal ps-lift bg-white/10 backdrop-blur rounded-3xl overflow-hidden border border-white/15"
                    style={{ transitionDelay: `${i * 0.07}s` }}
                  >
                    {coverSrc ? (
                      <div className="h-40 bg-cover bg-center" style={{ backgroundImage: `url('${coverSrc}')` }} />
                    ) : (
                      <div className="h-40 bg-white/10 grid place-items-center text-5xl">📅</div>
                    )}
                    <div className="p-5">
                      {e.isHost ? (
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded ps-accentbg" style={{ color: ink }}>
                          Our School
                        </span>
                      ) : (
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-white/25 text-white">
                          Network · {e.originSchoolName ?? 'Network'}
                        </span>
                      )}
                      <h3 className="ps-head font-bold text-lg mt-3 leading-snug text-white">{e.title}</h3>
                      <div className="text-sm text-white/80 mt-1">{metaLine}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

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
      {(hasContact || hasEnquiry) && (
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
              {(data.profile?.phone || data.profile?.email || data.profile?.addressLine1) && (
                <div className="mt-6 space-y-2 text-sm text-slate-700">
                  {data.profile?.phone && <div>📞 {data.profile.phone}</div>}
                  {data.profile?.email && <div>✉️ {data.profile.email}</div>}
                  {data.profile?.addressLine1 && (
                    <div>
                      📍 {data.profile.addressLine1}
                      {data.profile.city ? `, ${data.profile.city}` : ''}
                      {data.profile.postalCode ? ` ${data.profile.postalCode}` : ''}
                    </div>
                  )}
                </div>
              )}
              {data.socialLinks.length > 0 && (
                <div className="mt-6 flex flex-wrap gap-3">
                  {data.socialLinks
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
              {safeHttpsUrl(data.profile?.mapEmbedUrl) && (
                <div className="mt-6 rounded-2xl overflow-hidden ps-card">
                  <iframe
                    src={safeHttpsUrl(data.profile?.mapEmbedUrl)!}
                    className="w-full h-40 border-0"
                    loading="lazy"
                    title={`${schoolName} location`}
                  />
                </div>
              )}
            </div>

            {hasEnquiry ? (
              <EnquiryForm ink={ink} menu={data.menu} />
            ) : (
              <div className="relative ps-chip rounded-2xl p-6 text-sm">
                Reach out to us using the contact details on the left.
              </div>
            )}
          </div>
        </section>
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
              {hasAbout && <li><a href="#about" className="hover:text-slate-900 transition">About</a></li>}
              {data.menu.length > 0 && <li><a href="#academics" className="hover:text-slate-900 transition">Academics</a></li>}
              {hasGallery && <li><a href="#gallery" className="hover:text-slate-900 transition">Gallery</a></li>}
              {hasEvents && <li><a href="#events" className="hover:text-slate-900 transition">Connect</a></li>}
              <li><a href="#enquire" className="hover:text-slate-900 transition">Enquire</a></li>
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
          © {new Date().getFullYear()} {schoolName} · Powered by SkoolOS
        </div>
      </footer>
    </div>
  );
}

// ── Enquiry form (client, posts to public API with school Host header) ──────────

function EnquiryForm({
  ink,
  menu,
}: {
  ink: string;
  menu: { label: string; gradeId: string }[];
}) {
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
    const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    try {
      const res = await fetch(`${base}/public/enquiry`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Browser is already on <slug>.localhost; forward it so the API
          // resolves the correct tenant (it strips the port).
          'X-Forwarded-Host': window.location.host,
        },
        body: JSON.stringify({
          parentName,
          phone,
          ...(email ? { email } : {}),
          ...(gradeInterest ? { gradeInterest } : {}),
          ...(message ? { message } : {}),
        }),
      });
      if (res.status === 429) {
        setStatus('rate');
        return;
      }
      if (!res.ok) {
        setStatus('error');
        return;
      }
      form.reset();
      setStatus('ok');
    } catch {
      setStatus('error');
    }
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
        {menu.length > 0 ? (
          <select name="gradeInterest" className={inputCls} defaultValue="">
            <option value="">Interested in…</option>
            {menu.map((m) => (
              <option key={m.gradeId} value={m.label}>
                {m.label}
              </option>
            ))}
          </select>
        ) : (
          <input name="email" type="email" className={inputCls} placeholder="Email" />
        )}
      </div>
      {menu.length > 0 && (
        <input name="email" type="email" className={inputCls} placeholder="Email (optional)" />
      )}
      <textarea name="message" rows={3} className={inputCls} placeholder="Message (optional)" />
      <button
        type="submit"
        disabled={status === 'sending'}
        className="btn-glow w-full font-semibold py-3.5 rounded-xl ps-soft hover:scale-[1.01] transition disabled:opacity-60 ps-accentbg"
        style={{ color: ink }}
      >
        {status === 'sending' ? 'Sending…' : 'Submit enquiry →'}
      </button>
    </form>
  );
}
