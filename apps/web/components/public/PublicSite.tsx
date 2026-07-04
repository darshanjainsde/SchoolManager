'use client';

import { useEffect, useState } from 'react';
import type { PublicSiteData } from '@/lib/public-api';

interface Props {
  data: PublicSiteData;
}

const MARQUEE_ITEMS = [
  'Curiosity ✦',
  'Innovation ✦',
  'Character ✦',
  'Creativity ✦',
  'Excellence ✦',
  'Community ✦',
];

const CLASS_EMOJIS = ['🎓', '🧸', '📚', '🔬', '🎨', '🏆', '🌟', '💡', '🎯', '🚀'];

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

// Admin-controlled URLs are rendered into href/src. React only warns on
// `javascript:` — it does not block it — so validate the scheme ourselves.
function safeHttpUrl(u: string | null | undefined): string | null {
  return u && /^https?:\/\//i.test(u) ? u : null;
}
function safeHttpsUrl(u: string | null | undefined): string | null {
  return u && /^https:\/\//i.test(u) ? u : null;
}

function parseStatValue(val: string): { numeric: boolean; num: number; suffix: string } {
  const clean = val.trim();
  const match = clean.match(/^(\d+(?:\.\d+)?)\s*([%+]?)$/);
  if (match) {
    return { numeric: true, num: Number(match[1]), suffix: match[2] ?? '' };
  }
  return { numeric: false, num: 0, suffix: '' };
}

const PS_CSS = `
  .ps-root { font-family: 'Inter', sans-serif; background: #080b16; color: #e7ecf5; overflow-x: hidden; min-height: 100vh; }
  .ps-root h1, .ps-root h2, .ps-root h3 { font-family: 'Space Grotesk', sans-serif; }

  /* aurora blobs */
  .ps-aurora { position: absolute; border-radius: 9999px; filter: blur(90px); opacity: .55; pointer-events: none; }
  @keyframes ps-drift1 { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(60px,-40px) scale(1.15)} }
  @keyframes ps-drift2 { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(-50px,50px) scale(1.1)} }
  @keyframes ps-drift3 { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(40px,40px) scale(1.2)} }
  .ps-a1 { animation: ps-drift1 14s ease-in-out infinite; }
  .ps-a2 { animation: ps-drift2 18s ease-in-out infinite; }
  .ps-a3 { animation: ps-drift3 16s ease-in-out infinite; }

  /* gradient text */
  .ps-grad-text { background: linear-gradient(100deg,var(--ps1),var(--ps2),var(--ps1)); -webkit-background-clip: text; background-clip: text; color: transparent; background-size: 200% auto; animation: ps-shine 6s linear infinite; }
  @keyframes ps-shine { to { background-position: 200% center; } }

  /* grid overlay */
  .ps-grid-mask { background-image: linear-gradient(rgba(255,255,255,.04) 1px,transparent 1px), linear-gradient(90deg,rgba(255,255,255,.04) 1px,transparent 1px); background-size: 44px 44px; mask-image: radial-gradient(ellipse at 50% 40%,#000 40%,transparent 78%); }

  /* float */
  @keyframes ps-floaty { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-14px)} }
  .ps-float { animation: ps-floaty 6s ease-in-out infinite; }
  .ps-d1 { animation-delay: -2s; }
  .ps-d2 { animation-delay: -4s; }

  /* reveal on scroll */
  .reveal { opacity: 0; transform: translateY(28px); transition: opacity .7s cubic-bezier(.2,.7,.2,1), transform .7s cubic-bezier(.2,.7,.2,1); }
  .reveal.in { opacity: 1; transform: none; }

  /* glass */
  .ps-glass { background: rgba(255,255,255,.05); backdrop-filter: blur(14px); border: 1px solid rgba(255,255,255,.09); }

  /* marquee */
  @keyframes ps-scroll-x { to { transform: translateX(-50%); } }
  .ps-marquee { animation: ps-scroll-x 22s linear infinite; }

  /* glow button */
  .btn-glow { position: relative; overflow: hidden; }
  .btn-glow::after { content: ""; position: absolute; inset: 0; background: radial-gradient(120px circle at var(--x,50%) var(--y,50%),rgba(255,255,255,.35),transparent 60%); opacity: 0; transition: opacity .3s; }
  .btn-glow:hover::after { opacity: 1; }

  /* logo bg */
  .ps-logo-bg { background: linear-gradient(135deg, var(--ps1), var(--ps2)); }
  .ps-cta-btn { background: linear-gradient(90deg, var(--ps1), var(--ps2)); color: #080b16; }
  .ps-progress-bar { background: linear-gradient(90deg, var(--ps1), var(--ps2)); height: 100%; }
  .ps-icon-bg { background: linear-gradient(135deg, var(--ps2), var(--ps1)); }
  .ps-about-glow { background: linear-gradient(135deg, color-mix(in srgb, var(--ps1) 22%, transparent), color-mix(in srgb, var(--ps2) 22%, transparent)); filter: blur(2rem); }

  /* tilt card hover */
  .tilt { transition: transform .35s cubic-bezier(.2,.7,.2,1), box-shadow .35s cubic-bezier(.2,.7,.2,1); }
  .tilt:hover { transform: perspective(800px) rotateX(2deg) rotateY(-3deg) scale(1.02); box-shadow: 0 20px 60px rgba(0,0,0,.4); }
`;

export default function PublicSite({ data }: Props) {
  const brandColor = data.profile?.brandColorPrimary ?? '#3ee6b0';
  // Secondary drives the second gradient stop. If a school leaves it near-white
  // (the default), a lightened tint of the primary reads better than pure white.
  const rawSecondary = data.profile?.brandColorSecondary ?? '#38bdf8';
  const brandColor2 = isNearWhite(rawSecondary) ? lighten(brandColor, 0.45) : rawSecondary;
  const schoolName = data.school.name;
  const headline = data.homepage?.headline ?? schoolName;
  const subheadline = data.homepage?.subheadline;
  const heroUrl = data.homepage?.heroUrl;
  const aboutText = data.homepage?.aboutText;
  const hasAbout = !!aboutText;
  // Nav/footer gallery links must track the actual section, which only renders
  // when there are images — a GALLERY-enabled school with no uploads yet should
  // not show a link to an empty (missing) #gallery anchor.
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

  useEffect(() => {
    // Nav shrink on scroll
    const nav = document.getElementById('ps-nav');
    const handleScroll = () => {
      if (!nav) return;
      if (window.scrollY > 40) {
        nav.classList.remove('top-6');
        nav.classList.add('top-2');
      } else {
        nav.classList.remove('top-2');
        nav.classList.add('top-6');
      }
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

  return (
    <div
      className="ps-root"
      style={
        {
          '--brand': brandColor,
          '--ps1': brandColor,
          '--ps2': brandColor2,
        } as React.CSSProperties
      }
    >
      {/* Injected animation CSS */}
      <style dangerouslySetInnerHTML={{ __html: PS_CSS }} />

      {/* Google Fonts */}
      <link
        rel="preconnect"
        href="https://fonts.googleapis.com"
      />
      <link
        href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap"
        rel="stylesheet"
      />

      {/* ── NAV ── */}
      <header
        id="ps-nav"
        className="fixed top-6 inset-x-0 z-50 transition-all duration-300"
      >
        <div className="max-w-6xl mx-auto px-4">
          <div className="ps-glass rounded-2xl px-4 flex items-center justify-between h-14">
            {/* Logo */}
            <div className="flex items-center gap-2.5">
              {logoUrl ? (
                <img src={logoUrl} alt={schoolName} className="h-9 w-auto" />
              ) : (
                <>
                  <div
                    className="h-9 w-9 rounded-xl ps-logo-bg flex items-center justify-center font-bold text-[#080b16] text-sm"
                  >
                    {schoolName.charAt(0)}
                  </div>
                  <div className="font-semibold tracking-tight text-sm">{schoolName}</div>
                </>
              )}
            </div>

            {/* Desktop links */}
            <nav className="hidden md:flex items-center gap-1 text-sm text-slate-300">
              <a className="px-3 py-2 rounded-lg hover:text-white hover:bg-white/5 transition" href="#home">
                Home
              </a>
              {hasAbout && (
                <a className="px-3 py-2 rounded-lg hover:text-white hover:bg-white/5 transition" href="#about">
                  About
                </a>
              )}
              {data.menu.length > 0 && (
                <div className="relative group">
                  <button className="px-3 py-2 rounded-lg hover:text-white hover:bg-white/5 transition">
                    Academics ▾
                  </button>
                  <div className="absolute hidden group-hover:block top-full left-0 pt-2 w-56 z-10">
                    <div className="ps-glass rounded-xl p-2">
                      <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-slate-500">
                        Programmes
                      </div>
                      {data.menu.map((item) => (
                        <a
                          key={item.gradeId}
                          className="block px-3 py-2 rounded-lg hover:bg-white/5 transition text-slate-300"
                          href="#academics"
                        >
                          {item.label}
                        </a>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {hasGallery && (
                <a className="px-3 py-2 rounded-lg hover:text-white hover:bg-white/5 transition" href="#gallery">
                  Gallery
                </a>
              )}
              {hasEvents && (
                <a className="px-3 py-2 rounded-lg hover:text-white hover:bg-white/5 transition" href="#events">
                  Connect
                </a>
              )}
              {hasContact && (
                <a className="px-3 py-2 rounded-lg hover:text-white hover:bg-white/5 transition" href="#enquire">
                  Contact
                </a>
              )}
            </nav>

            {/* CTA */}
            <a
              href="#enquire"
              className="btn-glow bg-white text-[#080b16] text-sm font-semibold px-4 py-2 rounded-xl hover:scale-[1.03] transition"
            >
              Enquire →
            </a>
          </div>
        </div>
      </header>

      {/* ── HERO ── */}
      <section
        id="home"
        className="relative min-h-screen flex items-center overflow-hidden"
        style={
          heroUrl
            ? {
                backgroundImage: `url(${heroUrl})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }
            : {}
        }
      >
        {/* Aurora blobs — tinted by the school's brand colours */}
        <div
          className="ps-aurora ps-a1"
          style={{ width: '520px', height: '520px', background: brandColor, top: '-120px', left: '-80px' }}
        />
        <div
          className="ps-aurora ps-a2"
          style={{ width: '560px', height: '560px', background: brandColor2, bottom: '-160px', right: '-100px' }}
        />
        <div
          className="ps-aurora ps-a3"
          style={{ width: '420px', height: '420px', background: brandColor, top: '30%', left: '40%' }}
        />
        {heroUrl && <div className="absolute inset-0 bg-[#080b16]/70" />}
        <div className="absolute inset-0 ps-grid-mask" />

        <div className="relative max-w-6xl mx-auto px-6 pt-28 pb-16 grid lg:grid-cols-2 gap-12 items-center w-full">
          <div>
            <div className="inline-flex items-center gap-2 ps-glass rounded-full px-3 py-1.5 text-xs text-slate-300 mb-6">
              <span
                className="h-2 w-2 rounded-full animate-pulse"
                style={{ background: brandColor }}
              />
              Admissions open · 2026–27
            </div>

            <h1 className="text-5xl md:text-7xl font-semibold leading-[1.05] tracking-tight">
              <span className="ps-grad-text">{headline}</span>
            </h1>

            {subheadline && (
              <p className="mt-6 text-lg text-slate-400 max-w-md">{subheadline}</p>
            )}

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a
                href="#enquire"
                className="btn-glow ps-cta-btn font-semibold px-6 py-3.5 rounded-xl hover:scale-[1.03] transition"
              >
                Book a campus visit
              </a>
              {hasAbout && (
                <a
                  href="#about"
                  className="ps-glass px-6 py-3.5 rounded-xl font-semibold hover:bg-white/10 transition"
                >
                  Explore ↓
                </a>
              )}
            </div>
          </div>

          {/* Floating visual cards */}
          <div className="relative h-[440px] hidden lg:block">
            <div className="ps-float absolute top-0 right-4 w-72 rounded-3xl overflow-hidden ps-glass p-2">
              <div className="rounded-2xl h-56 w-full bg-white/5 flex items-center justify-center text-slate-600 text-sm">
                {schoolName}
              </div>
            </div>
            <div className="ps-float ps-d1 absolute bottom-6 left-0 ps-glass rounded-2xl p-4 w-52">
              <div className="text-xs text-slate-400">Academic excellence</div>
              <div className="text-3xl font-semibold ps-grad-text">98%</div>
              <div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div className="ps-progress-bar" style={{ width: '98%', height: '100%' }} />
              </div>
            </div>
            <div className="ps-float ps-d2 absolute bottom-40 right-0 ps-glass rounded-2xl p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl ps-icon-bg flex items-center justify-center">🎓</div>
              <div>
                <div className="text-sm font-semibold">Caring teachers</div>
                <div className="text-xs text-slate-400">every child known by name</div>
              </div>
            </div>
          </div>
        </div>

        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-slate-500 text-xs animate-bounce">
          scroll ↓
        </div>
      </section>

      {/* ── MARQUEE ── */}
      <div className="border-y border-white/10 py-5 overflow-hidden">
        <div className="ps-marquee flex gap-12 whitespace-nowrap text-2xl text-slate-600 w-max">
          {[...MARQUEE_ITEMS, ...MARQUEE_ITEMS].map((item, i) => (
            <span key={i}>{item}</span>
          ))}
        </div>
      </div>

      {/* ── STATS ── */}
      {data.stats.length > 0 && (
        <section className="max-w-6xl mx-auto px-6 py-20 grid grid-cols-2 md:grid-cols-4 gap-6">
          {data.stats.map((stat, i) => {
            const parsed = parseStatValue(stat.value);
            return (
              <div
                key={i}
                className="reveal ps-glass rounded-2xl p-6 text-center"
                style={{ transitionDelay: `${i * 0.1}s` }}
              >
                {parsed.numeric ? (
                  <div
                    className="text-4xl font-semibold ps-grad-text count"
                    data-to={String(parsed.num)}
                    data-suffix={parsed.suffix}
                  >
                    0
                  </div>
                ) : (
                  <div className="text-4xl font-semibold ps-grad-text">{stat.value}</div>
                )}
                <div className="text-sm text-slate-400 mt-1">{stat.label}</div>
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
            <div className="relative rounded-3xl overflow-hidden h-80 ps-glass">
              {principalPhotoUrl ? (
                <img
                  src={principalPhotoUrl}
                  alt={principalName ?? 'Principal'}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-6xl">
                  🏫
                </div>
              )}
            </div>
            {principalName && (
              <div className="ps-glass absolute -bottom-6 -right-4 rounded-2xl p-4 w-56">
                <div className="flex items-center gap-3">
                  {principalPhotoUrl && (
                    <img
                      src={principalPhotoUrl}
                      alt={principalName}
                      className="h-11 w-11 rounded-full object-cover flex-shrink-0"
                    />
                  )}
                  <div>
                    <div className="text-sm font-semibold">{principalName}</div>
                    <div className="text-xs text-slate-400">Principal</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="reveal">
            <div
              className="text-sm font-semibold uppercase tracking-widest"
              style={{ color: brandColor }}
            >
              About
            </div>
            <h2 className="text-4xl font-semibold mt-3 tracking-tight">
              A community built on{' '}
              <span className="ps-grad-text">care &amp; curiosity</span>
            </h2>
            <p className="mt-5 text-slate-400 leading-relaxed">{aboutText}</p>
            {principalMessage && (
              <blockquote
                className="mt-5 text-slate-400 italic border-l-2 pl-4 text-sm"
                style={{ borderColor: brandColor }}
              >
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
            <div
              className="text-sm font-semibold uppercase tracking-widest"
              style={{ color: brandColor }}
            >
              Academics
            </div>
            <h2 className="text-4xl font-semibold mt-3 tracking-tight">
              Programmes for every stage
            </h2>
            <p className="mt-3 text-slate-400">
              Explore our class-wise academic programmes.
            </p>
          </div>

          <div className="mt-12 grid md:grid-cols-3 gap-5">
            {data.menu.map((item, i) => (
              <div
                key={item.gradeId}
                className="reveal ps-glass rounded-3xl p-6 flex flex-col justify-end hover:bg-white/10 transition cursor-pointer"
                style={{ transitionDelay: `${i * 0.05}s`, minHeight: '160px' }}
              >
                <div className="text-3xl mb-2">{CLASS_EMOJIS[i % CLASS_EMOJIS.length]}</div>
                <h3 className="text-xl font-semibold">{item.label}</h3>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── GALLERY ── */}
      {data.gallery.length > 0 && (
        <section id="gallery" className="max-w-6xl mx-auto px-6 py-20">
          <div className="reveal flex items-end justify-between flex-wrap gap-4">
            <div>
              <div
                className="text-sm font-semibold uppercase tracking-widest"
                style={{ color: brandColor }}
              >
                Gallery
              </div>
              <h2 className="text-4xl font-semibold mt-3 tracking-tight">
                Life at {schoolName}
              </h2>
            </div>
          </div>
          <div className="mt-10 grid grid-cols-2 md:grid-cols-4 gap-4">
            {data.gallery.map((img, i) => (
              <div
                key={i}
                className="reveal group relative rounded-2xl overflow-hidden ps-glass"
                style={{ transitionDelay: `${i * 0.05}s` }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.url}
                  alt={img.caption ?? `${schoolName} gallery ${i + 1}`}
                  className="h-48 w-full object-cover transition duration-500 group-hover:scale-105"
                />
                {img.caption && (
                  <div className="absolute inset-0 bg-gradient-to-t from-[#080b16]/80 to-transparent opacity-0 group-hover:opacity-100 transition" />
                )}
                {img.caption && (
                  <div className="absolute bottom-3 left-3 text-sm font-medium opacity-0 group-hover:opacity-100 transition">
                    {img.caption}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── CONNECT / EVENTS ── */}
      {hasEvents && (
        <section id="events" className="max-w-6xl mx-auto px-6 py-20">
          <div className="reveal flex items-end justify-between flex-wrap gap-4">
            <div>
              <div
                className="text-sm font-semibold uppercase tracking-widest"
                style={{ color: brandColor }}
              >
                Connect · Events
              </div>
              <h2 className="text-4xl font-semibold mt-3 tracking-tight">Across our network</h2>
              <p className="mt-2 text-slate-400 max-w-xl">
                Events from every school in the network — one shared calendar for the whole community.
              </p>
            </div>
          </div>
          <div className="mt-10 grid md:grid-cols-3 gap-5">
            {data.events.map((e, i) => {
              const coverSrc = safeHttpUrl(e.coverUrl);
              const dateStr = new Date(e.startAt).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
              });
              const timeStr = new Date(e.startAt).toLocaleTimeString(undefined, {
                hour: 'numeric',
                minute: '2-digit',
              });
              const metaLine = [dateStr, timeStr, e.venue ? `· ${e.venue}` : null]
                .filter(Boolean)
                .join(' ');
              return (
                <div
                  key={e.id}
                  className="reveal tilt ps-glass rounded-3xl overflow-hidden"
                  style={{ transitionDelay: `${i * 0.07}s` }}
                >
                  {/* Cover area */}
                  {coverSrc ? (
                    <div
                      className="h-40 bg-cover bg-center"
                      style={{ backgroundImage: `url('${coverSrc}')` }}
                    />
                  ) : (
                    <div className="h-40 ps-logo-bg opacity-70" />
                  )}
                  {/* Card body */}
                  <div className="p-5">
                    {e.isHost ? (
                      <span
                        className="text-[11px] font-semibold px-2 py-0.5 rounded"
                        style={{ background: `${brandColor}26`, color: brandColor }}
                      >
                        Our School
                      </span>
                    ) : (
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-[#7c6cff]/20 text-[#a89dff]">
                        Network · {e.originSchoolName ?? 'Network'}
                      </span>
                    )}
                    <h3 className="font-semibold text-lg mt-3 leading-snug">{e.title}</h3>
                    <div className="text-sm text-slate-400 mt-1">{metaLine}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── EDUCATORS / STAFF ── */}
      {data.staff.length > 0 && (
        <section id="staff" className="max-w-6xl mx-auto px-6 py-20">
          <div className="reveal text-center max-w-2xl mx-auto">
            <div
              className="text-sm font-semibold uppercase tracking-widest"
              style={{ color: brandColor }}
            >
              Our people
            </div>
            <h2 className="text-4xl font-semibold mt-3 tracking-tight">
              Meet our educators
            </h2>
          </div>
          <div className="mt-12 grid grid-cols-2 md:grid-cols-4 gap-6">
            {data.staff.map((person, i) => (
              <div
                key={i}
                className="reveal ps-glass rounded-3xl p-6 text-center hover:bg-white/10 transition"
                style={{ transitionDelay: `${i * 0.05}s` }}
              >
                <div className="mx-auto h-20 w-20 rounded-full overflow-hidden ps-logo-bg flex items-center justify-center text-2xl font-semibold text-[#080b16]">
                  {person.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={person.photoUrl}
                      alt={person.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    person.name.charAt(0)
                  )}
                </div>
                <div className="mt-4 font-semibold">{person.name}</div>
                <div className="text-sm text-slate-400 mt-0.5">{person.role}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── CONTACT + ENQUIRY ── */}
      {(hasContact || hasEnquiry) && (
        <section id="enquire" className="relative max-w-6xl mx-auto px-6 py-24">
          <div className="relative ps-glass rounded-[2rem] overflow-hidden p-8 md:p-12 grid md:grid-cols-2 gap-12 items-center">
            <div
              className="ps-aurora"
              style={{
                width: '340px',
                height: '340px',
                background: brandColor2,
                top: '-80px',
                right: '-40px',
                opacity: 0.4,
              }}
            />
            <div className="relative">
              <h2 className="text-4xl font-semibold tracking-tight">
                Ready to <span className="ps-grad-text">join us?</span>
              </h2>
              <p className="mt-4 text-slate-400">
                Leave your details and our admissions team reaches out within a working
                day.
              </p>
              {(data.profile?.phone ||
                data.profile?.email ||
                data.profile?.addressLine1) && (
                <div className="mt-6 space-y-2 text-sm text-slate-300">
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
                        className="ps-glass rounded-lg px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10 transition capitalize"
                      >
                        {s.platform}
                      </a>
                    ))}
                </div>
              )}
              {safeHttpsUrl(data.profile?.mapEmbedUrl) && (
                <div className="mt-6 rounded-2xl overflow-hidden ps-glass">
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
              <EnquiryForm brandColor={brandColor} menu={data.menu} />
            ) : (
              <div className="relative ps-glass rounded-2xl p-6 text-sm text-slate-400">
                Reach out to us using the contact details on the left.
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── FOOTER ── */}
      <footer className="border-t border-white/10 mt-16">
        <div className="max-w-6xl mx-auto px-6 py-14 grid md:grid-cols-3 gap-8">
          <div>
            <div className="flex items-center gap-2.5">
              {logoUrl ? (
                <img src={logoUrl} alt={schoolName} className="h-9 w-auto" />
              ) : (
                <>
                  <span className="h-9 w-9 rounded-xl ps-logo-bg flex items-center justify-center font-bold text-[#080b16] text-sm">
                    {schoolName.charAt(0)}
                  </span>
                  <span className="font-semibold">{schoolName}</span>
                </>
              )}
            </div>
            <p className="text-sm text-slate-400 mt-3">
              Nurturing confident, compassionate lifelong learners.
            </p>
          </div>
          <div>
            <div className="font-semibold mb-3">Explore</div>
            <ul className="space-y-2 text-sm text-slate-400">
              {hasAbout && (
                <li>
                  <a href="#about" className="hover:text-white transition">About</a>
                </li>
              )}
              {data.menu.length > 0 && (
                <li>
                  <a href="#academics" className="hover:text-white transition">Academics</a>
                </li>
              )}
              {hasGallery && (
                <li>
                  <a href="#gallery" className="hover:text-white transition">Gallery</a>
                </li>
              )}
              {hasEvents && (
                <li>
                  <a href="#events" className="hover:text-white transition">Connect</a>
                </li>
              )}
              <li>
                <a href="#enquire" className="hover:text-white transition">Enquire</a>
              </li>
            </ul>
          </div>
          <div>
            <div className="font-semibold mb-3">Contact</div>
            <ul className="space-y-2 text-sm text-slate-400">
              {data.profile?.phone && <li>📞 {data.profile.phone}</li>}
              {data.profile?.email && <li>✉️ {data.profile.email}</li>}
              {data.profile?.city && (
                <li>
                  📍 {data.profile.city}
                  {data.profile.region ? `, ${data.profile.region}` : ''}
                </li>
              )}
              {!data.profile?.phone && !data.profile?.email && !data.profile?.city && (
                <li className="text-slate-600">—</li>
              )}
            </ul>
          </div>
        </div>
        <div className="border-t border-white/10 text-center text-xs text-slate-500 py-4">
          © {new Date().getFullYear()} {schoolName} · Powered by SkoolOS
        </div>
      </footer>
    </div>
  );
}

// ── Enquiry form (client, posts to public API with school Host header) ──────────

function EnquiryForm({
  brandColor,
  menu,
}: {
  brandColor: string;
  menu: { label: string; gradeId: string }[];
}) {
  const [status, setStatus] = useState<'idle' | 'sending' | 'ok' | 'rate' | 'error'>(
    'idle'
  );

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
    'w-full ps-glass rounded-xl px-4 py-3 text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-white/20';

  return (
    <form onSubmit={onSubmit} className="relative space-y-3">
      {status === 'ok' && (
        <div className="bg-emerald-400/15 text-emerald-300 text-sm rounded-xl px-4 py-2.5">
          ✓ Thank you! Your enquiry has been received.
        </div>
      )}
      {status === 'rate' && (
        <div className="bg-amber-400/15 text-amber-300 text-sm rounded-xl px-4 py-2.5">
          You&apos;ve submitted a few times — please try again shortly.
        </div>
      )}
      {status === 'error' && (
        <div className="bg-rose-500/15 text-rose-300 text-sm rounded-xl px-4 py-2.5">
          Something went wrong. Please try again.
        </div>
      )}
      <input required name="parentName" className={inputCls} placeholder="Parent name" />
      <div className="grid grid-cols-2 gap-3">
        <input required name="phone" className={inputCls} placeholder="Phone" />
        {menu.length > 0 ? (
          <select
            name="gradeInterest"
            className={`${inputCls} bg-transparent`}
            defaultValue=""
          >
            <option value="" className="bg-[#0f1424]">
              Interested in…
            </option>
            {menu.map((m) => (
              <option key={m.gradeId} value={m.label} className="bg-[#0f1424]">
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
      <textarea
        name="message"
        rows={3}
        className={inputCls}
        placeholder="Message (optional)"
      />
      <button
        type="submit"
        disabled={status === 'sending'}
        className="btn-glow w-full font-semibold py-3.5 rounded-xl hover:scale-[1.01] transition disabled:opacity-60"
        style={{ background: 'linear-gradient(90deg, var(--ps1), var(--ps2))', color: '#080b16' }}
      >
        {status === 'sending' ? 'Sending…' : 'Submit enquiry →'}
      </button>
    </form>
  );
}
