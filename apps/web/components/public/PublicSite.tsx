'use client';

import { useEffect } from 'react';
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
  .ps-grad-text { background: linear-gradient(100deg,#3ee6b0,#38bdf8,#7c6cff); -webkit-background-clip: text; background-clip: text; color: transparent; background-size: 200% auto; animation: ps-shine 6s linear infinite; }
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
  .ps-logo-bg { background: linear-gradient(135deg, #3ee6b0, #7c6cff); }
  .ps-cta-btn { background: linear-gradient(90deg, #3ee6b0, #38bdf8); color: #080b16; }
  .ps-progress-bar { background: linear-gradient(90deg, #3ee6b0, #38bdf8); height: 100%; }
  .ps-icon-bg { background: linear-gradient(135deg, #7c6cff, #38bdf8); }
  .ps-about-glow { background: linear-gradient(135deg, rgba(62,230,176,.2), rgba(124,108,255,.2)); filter: blur(2rem); }
`;

export default function PublicSite({ data }: Props) {
  const brandColor = data.profile?.brandColorPrimary ?? '#3ee6b0';
  const schoolName = data.school.name;
  const headline = data.homepage?.headline ?? schoolName;
  const subheadline = data.homepage?.subheadline;
  const heroUrl = data.homepage?.heroUrl;
  const aboutText = data.homepage?.aboutText;
  const hasAbout = !!aboutText;
  const hasGallery =
    data.gallery.length > 0 || data.school.features.includes('GALLERY');
  const hasContact = !!(data.profile?.phone || data.profile?.email);
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      style={{ ['--brand' as any]: brandColor } as React.CSSProperties}
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
        {/* Aurora blobs */}
        <div
          className="ps-aurora ps-a1"
          style={{ width: '520px', height: '520px', background: '#3ee6b0', top: '-120px', left: '-80px' }}
        />
        <div
          className="ps-aurora ps-a2"
          style={{ width: '560px', height: '560px', background: '#7c6cff', bottom: '-160px', right: '-100px' }}
        />
        <div
          className="ps-aurora ps-a3"
          style={{ width: '420px', height: '420px', background: '#38bdf8', top: '30%', left: '40%' }}
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
              <div className="h-10 w-10 rounded-xl ps-icon-bg flex items-center justify-center">🤖</div>
              <div>
                <div className="text-sm font-semibold">AI-assisted</div>
                <div className="text-xs text-slate-400">smart learning labs</div>
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

      {/* TODO: Gallery section — Task 6 */}
      {/* TODO: Staff section — Task 6 */}
      {/* TODO: Enquiry / Contact form — Task 7 */}

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
