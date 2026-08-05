'use client';
import './marketing.css';
import Link from 'next/link';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { MarketingConfigData } from '@/lib/public-api';
import CallbackModal from './CallbackModal';
import FlipFeatureCards from './FlipFeatureCards';
import ProShowcase from './ProShowcase';
import { SckoolsLogo } from '@/components/brand/sckools-logo';

/* Sample trust counters — update as the network grows (also cited in JSON-LD? no: display only). */
const TRUST = [
  { end: 14, label: 'schools live' },
  { end: 9200, label: 'students reached' },
  { end: 37, label: 'inter-school events' },
  { end: 120, label: 'updates / year' },
];

const MARQUEE = [
  ['🎓', 'Courses', 'with flip-cards'],
  ['📋', 'Admissions', 'process & fees'],
  ['🏆', 'Hall of Fame', 'podiums'],
  ['🖼️', 'Gallery', ''],
  ['📥', 'Enquiry inbox', ''],
  ['🎪', 'Events network', ''],
  ['🧑‍🏫', 'Staff profiles', ''],
  ['🔐', 'Own domain + SSL', ''],
  ['📊', 'Management suite', ''],
  ['⚡', 'Monthly updates, free', ''],
] as const;

const DECK = [
  { cls: 'dk1', em: '🏆', title: 'Hall of Fame', hook: 'your champions, on a podium' },
  { cls: 'dk2', em: '🎪', title: 'Events', hook: 'the whole network watching' },
  { cls: 'dk3', em: '🎓', title: 'Courses', hook: 'cards that flip & convert' },
  { cls: 'dk4', em: '📋', title: 'Admissions', hook: 'from enquiry to welcome' },
  { cls: 'dk5', em: '🖼️', title: 'Gallery', hook: 'every moment, lightning fast' },
  { cls: 'dk6', em: '📥', title: 'Enquiry Inbox', hook: 'no lead ever lost' },
];

const TIERS = [
  {
    cls: 'basic', tk: 'Basic', h: 'Be found.',
    why: 'Your school looks world-class online and every interested parent becomes a tracked enquiry.',
    btn: 'btn-ghost', inherit: null,
    groups: [
      { g: 'Your website', items: ['Complete school site — home, courses, gallery, admissions & hall of fame', 'Flip-card course explorer parents love', 'Photo & video gallery, lightning fast', 'Mobile-perfect, SEO-ready pages'] },
      { g: 'Admissions engine', items: ['Enquiry inbox — every lead captured, tracked & statused', 'Admissions process & fee structure pages'] },
      { g: 'Included forever', items: ['Your own domain, SSL & hosting', 'Monthly platform updates — free'] },
    ],
  },
  {
    cls: 'std', tk: 'Standard', h: 'Be engaging.',
    why: 'Your community stays connected — and your events reach every school on the network.',
    btn: 'btn-hot', inherit: 'Everything in Basic, plus',
    groups: [
      { g: 'Network reach', items: ['Your events published to the shared network feed — seen by every Sckools school', 'Students join inter-school events across the network'] },
      { g: 'Community', items: ['About, contact & social presence pages', 'Announcements to parents & students'] },
      { g: 'Care', items: ['Priority support — real humans, fast'] },
    ],
  },
  {
    cls: 'pro', tk: 'Pro', h: 'Be the stage.',
    why: 'Host network events, get sponsor matchmaking, and run the school itself on our management suite.',
    btn: 'btn-ink', inherit: 'Everything in Standard, plus',
    groups: [
      { g: 'The stage', items: ['Host paid inter-school events — entry passes, bigger crowds', 'Sponsor matchmaking — we pitch brands to back your events'] },
      { g: 'Management suite', items: ['Students, classes, teachers & staff records', 'Timetables, attendance & teacher availability', 'Assignments & announcements', 'Teacher & student portals'] },
      { g: 'Partnership', items: ['Custom features built for your school', 'Dedicated onboarding — we set everything up'] },
    ],
  },
];

/** Attaches every motion system: intro curtain sequencing, scroll progress,
 *  nav condense, reveals (.rv + data-a verbs + VS columns), counters, URL
 *  typing, the notification-chip loop, and the fine-pointer hero tilt.
 *  All animation work is transform/opacity only; listeners are passive and
 *  rAF-throttled; everything degrades on reduced-motion. */
function useMarketingMotion(root: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timers: number[] = [];
    const cleanups: Array<() => void> = [];

    // Intro curtain: plays once per tab session; repeat visits (and
    // reduced-motion) skip straight to the composed page. The curtain also
    // self-lifts via CSS, so this only schedules the hero choreography.
    const intro = el.querySelector<HTMLElement>('.sk-intro');
    let seen = false;
    try {
      seen = sessionStorage.getItem('sk-intro') === '1';
      sessionStorage.setItem('sk-intro', '1');
    } catch {
      /* private browsing — treat as first visit */
    }
    const typeUrl = () => {
      const tu = el.querySelector<HTMLElement>('.url .tu');
      if (!tu) return;
      const full = tu.textContent ?? '';
      tu.textContent = '';
      let i = 0;
      const iv = window.setInterval(() => {
        i += 1;
        tu.textContent = full.slice(0, i);
        if (i >= full.length) window.clearInterval(iv);
      }, 55);
      timers.push(iv);
    };
    // Counters start observing only once the curtain lifts, so the count-up
    // isn't wasted behind it on first visit.
    let startCounters = () => {};
    if (reduced || seen) {
      intro?.classList.add('gone');
      el.classList.add('go', 'built');
      timers.push(window.setTimeout(() => startCounters(), 0));
    } else {
      timers.push(
        window.setTimeout(() => {
          el.classList.add('go');
          startCounters();
        }, 2250),
      );
      timers.push(
        window.setTimeout(() => {
          el.classList.add('built');
          typeUrl();
        }, 3050),
      );
    }

    // Notification chips take turns "arriving" (glow + ping dot).
    if (!reduced) {
      const chips = Array.from(el.querySelectorAll<HTMLElement>('.chip'));
      if (chips.length) {
        let idx = -1;
        const iv = window.setInterval(() => {
          if (!el.classList.contains('go')) return;
          if (idx >= 0) chips[idx].classList.remove('live');
          idx = (idx + 1) % chips.length;
          chips[idx].classList.add('live');
        }, 2600);
        timers.push(iv);
      }
    }

    // Scroll: progress bar (scaleX — no layout) + condensed nav.
    const prog = el.querySelector<HTMLElement>('.sprog');
    const nav = el.querySelector<HTMLElement>('.mnav');
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const max = document.documentElement.scrollHeight - window.innerHeight;
        if (prog) prog.style.transform = `scaleX(${max > 0 ? Math.min(window.scrollY / max, 1) : 0})`;
        nav?.classList.toggle('scrolled', window.scrollY > 8);
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    cleanups.push(() => window.removeEventListener('scroll', onScroll));

    // Hero mockup tilt — mouse-driven, fine pointers only (never on touch).
    if (!reduced && window.matchMedia('(pointer: fine)').matches) {
      const stage = el.querySelector<HTMLElement>('.stage');
      const browser = el.querySelector<HTMLElement>('.browser');
      if (stage && browser) {
        let raf = 0;
        const onMove = (ev: MouseEvent) => {
          const r = stage.getBoundingClientRect();
          const x = (ev.clientX - r.left) / r.width - 0.5;
          const y = (ev.clientY - r.top) / r.height - 0.5;
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(() => {
            browser.style.transform = `rotate(1.2deg) rotateX(${(-y * 6).toFixed(2)}deg) rotateY(${(x * 8).toFixed(2)}deg)`;
          });
        };
        const onLeave = () => {
          cancelAnimationFrame(raf);
          browser.style.transform = '';
        };
        stage.addEventListener('mousemove', onMove);
        stage.addEventListener('mouseleave', onLeave);
        cleanups.push(() => {
          stage.removeEventListener('mousemove', onMove);
          stage.removeEventListener('mouseleave', onLeave);
          cancelAnimationFrame(raf);
        });
      }
    }

    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        }),
      { threshold: 0.12 },
    );
    el.querySelectorAll('.rv, [data-a], .vs .col').forEach((n) => io.observe(n));

    const cio = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          cio.unobserve(e.target);
          const node = e.target as HTMLElement;
          const end = Number(node.dataset.count ?? 0);
          if (reduced) {
            node.textContent = end.toLocaleString() + (end >= 1000 ? '+' : '');
            return;
          }
          const t0 = performance.now();
          const step = (t: number) => {
            const p = Math.min((t - t0) / 1400, 1);
            const v = Math.round(end * (1 - Math.pow(1 - p, 3)));
            node.textContent = v.toLocaleString() + (end >= 1000 ? '+' : '');
            if (p < 1) requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        }),
      { threshold: 0.5 },
    );
    startCounters = () => el.querySelectorAll('[data-count]').forEach((n) => cio.observe(n));

    return () => {
      io.disconnect();
      cio.disconnect();
      timers.forEach((t) => {
        window.clearTimeout(t);
        window.clearInterval(t);
      });
      cleanups.forEach((fn) => fn());
    };
  }, [root]);
}

/** Marketing top-nav links — shared by the desktop row and the mobile menu so
 * the two can never drift out of sync. Route paths render as <Link> (client
 * nav), in-page hashes as <a>. */
const MNAV_LINKS: { href: string; label: string }[] = [
  { href: '#feats', label: 'Features' },
  { href: '#events', label: 'Events Network' },
  { href: '/pricing', label: 'Pricing' },
  { href: '#switch', label: 'Why switch' },
  { href: '/jobs', label: 'Jobs' },
  { href: '/blog', label: 'Blog' },
];

function MnavLink({ href, label, className }: { href: string; label: string; className: string }) {
  return href.startsWith('/') ? (
    <Link className={className} href={href}>{label}</Link>
  ) : (
    <a className={className} href={href}>{label}</a>
  );
}

export default function MarketingSite({ config }: { config: MarketingConfigData }) {
  const root = useRef<HTMLDivElement>(null);
  const [modalInterest, setModalInterest] = useState<string | null | false>(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const burgerRef = useRef<HTMLButtonElement>(null);
  const wasMenuOpen = useRef(false);
  useMarketingMotion(root);
  const openModal = (interest: string | null = null) => setModalInterest(interest);

  // Mobile nav menu: lock body scroll, close on Escape, and move focus into the
  // panel on open / back to the trigger on close. Mirrors the school SiteNav.
  // NOTE: no open/close class goes on `.mnav` itself — the scroll handler toggles
  // `.scrolled` on it imperatively, and a React-controlled className would wipe
  // that on every render.
  useEffect(() => {
    if (menuOpen) {
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') setMenuOpen(false);
      };
      document.addEventListener('keydown', onKey);
      root.current?.querySelector<HTMLElement>('.mnav-menu a, .mnav-menu button')?.focus();
      wasMenuOpen.current = true;
      return () => {
        document.body.style.overflow = prevOverflow;
        document.removeEventListener('keydown', onKey);
      };
    }
    if (wasMenuOpen.current) {
      burgerRef.current?.focus();
      wasMenuOpen.current = false;
    }
  }, [menuOpen]);

  return (
    <div className="mkt" ref={root}>
      {/* Intro curtain — rendered in the SSR HTML so it doubles as a load
          cover; lifts via CSS on its own, instantly on repeat visits. */}
      <div className="sk-intro" aria-hidden>
        <div style={{ textAlign: 'center' }}>
          <svg width="76" height="70" viewBox="0 0 48 44" fill="none" aria-hidden>
            <path className="iis" d="M34 14 C34 8.5 25 7.5 19.3 10 C12 13 13.7 19 23.5 21.4 C33.5 24 35.2 29.7 29.3 33.4 C23.6 37 14.6 35.6 13.6 29.4" stroke="#4F46E5" strokeWidth="5" strokeLinecap="round" />
            <path className="iit" d="M41 9 L41 19" stroke="#F59E0B" strokeWidth="2.4" strokeLinecap="round" />
            <circle className="iib" cx="41" cy="22" r="3" fill="#F59E0B" />
          </svg>
          <div className="iw">Sckools</div>
        </div>
      </div>
      <div className="sprog" aria-hidden />

      <nav className="mnav" aria-label="Main">
        <div className="mnav-in">
          <span className="logo"><SckoolsLogo size={32} /></span>
          {MNAV_LINKS.map((l) => (
            <MnavLink key={l.href} href={l.href} label={l.label} className="lnk" />
          ))}
          <button className="btn btn-hot btn-sm mnav-cta" onClick={() => openModal()}>Request a callback</button>
          <button
            ref={burgerRef}
            type="button"
            className="mnav-burger"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="mnav-mobile"
            onClick={() => setMenuOpen((o) => !o)}
          >
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
              {menuOpen ? (
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
        </div>
        {menuOpen && (
          <div
            id="mnav-mobile"
            className="mnav-menu"
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('a, button')) setMenuOpen(false);
            }}
          >
            {MNAV_LINKS.map((l) => (
              <MnavLink key={l.href} href={l.href} label={l.label} className="mnav-menu-lnk" />
            ))}
            <button className="btn btn-hot mnav-menu-cta" onClick={() => openModal()}>Request a callback</button>
          </div>
        )}
      </nav>
      {menuOpen && <div className="mnav-scrim" aria-hidden onClick={() => setMenuOpen(false)} />}

      <header className="hero">
        <div className="dots" aria-hidden />
        <div className="aura a1" aria-hidden /><div className="aura a2" aria-hidden /><div className="aura a3" aria-hidden />
        <div className="wrap hero-in">
          <div>
            <div className="hrv"><span className="eyebrow">✦ Next-gen school digital infrastructure</span></div>
            <h1 className="h-xl">
              <span className="ln"><i style={{ '--d': '.05s' } as CSSProperties}>Your school,</i></span>
              <span className="ln">
                <i style={{ '--d': '.18s' } as CSSProperties}>
                  on a{' '}
                  <span className="hl">
                    bigger stage
                    <svg viewBox="0 0 300 24" preserveAspectRatio="none" aria-hidden>
                      <path d="M4 16 C 60 22, 120 6, 170 12 S 270 20, 296 10" />
                    </svg>
                  </span>
                </i>
              </span>
            </h1>
            <p className="lede hrv" style={{ '--d': '.36s' } as CSSProperties}>
              A stunning website, an admissions engine, effortless management — and a live network of schools where your students compete, connect and get discovered.
            </p>
            <div className="hero-ctas hrv" style={{ '--d': '.48s' } as CSSProperties}>
              <button className="btn btn-hot" onClick={() => openModal()}>Request a callback</button>
              <a className="btn btn-ghost" href="/pricing">Explore plans →</a>
            </div>
            <div className="trust hrv" style={{ '--d': '.6s' } as CSSProperties}>
              {TRUST.map((t) => (
                <div className="t" key={t.label}>
                  <b data-count={t.end}>0</b>
                  <span>{t.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="stage hrv r" style={{ '--d': '.3s' } as CSSProperties}>
            <div className="browser">
              <div className="bbar">
                <i style={{ background: '#FF8A80' }} /><i style={{ background: '#FFD54F' }} /><i style={{ background: '#81E6C0' }} />
                <span className="url">🔒 <span className="tu">beacon.sckools.com</span><i className="caret" /></span>
              </div>
              <div className="bhero">
                <div className="tag bld">ADMISSIONS OPEN 2026–27</div>
                <h4 className="bld" style={{ '--d': '.1s' } as CSSProperties}>Beacon Public School</h4>
                <p className="bld" style={{ '--d': '.2s' } as CSSProperties}>Where curiosity meets excellence — Nursery to Grade 12</p>
                <span className="mini bld" style={{ '--d': '.3s' } as CSSProperties}>Enquire now</span>
              </div>
              <div className="brow">
                <div className="bcell bld" style={{ '--d': '.4s' } as CSSProperties}><b>Courses</b>flip-card explorer</div>
                <div className="bcell bld" style={{ '--d': '.5s' } as CSSProperties}><b>Hall of Fame</b>class toppers</div>
                <div className="bcell bld" style={{ '--d': '.6s' } as CSSProperties}><b>Events</b>network feed</div>
              </div>
            </div>
            <div className="chip ch1"><span className="ci" style={{ background: 'var(--teal-soft)' }}>📥</span><div><b>New enquiry</b><span>Sunita, for Grade 3 · just now</span></div><i className="ping" /></div>
            <div className="chip ch2"><span className="ci" style={{ background: 'var(--gold-soft)' }}>🏆</span><div><b>Science Fair — LIVE</b><span>6 schools · 400+ students</span></div><i className="ping" /></div>
            <div className="chip ch3"><span className="ci" style={{ background: 'var(--violet-soft)' }}>🤝</span><div><b>Sponsor matched</b><span>Annual sports meet, funded</span></div><i className="ping" /></div>
          </div>
        </div>
      </header>

      <div className="marq" aria-hidden>
        <div className="track">
          {[...MARQUEE, ...MARQUEE].map(([em, b, rest], i) => (
            <span className="mchip" key={i}>{em} <b>{b}</b>{rest ? ` ${rest}` : ''}</span>
          ))}
        </div>
        <div className="track rev">
          {[...MARQUEE, ...MARQUEE].reverse().map(([em, b, rest], i) => (
            <span className="mchip" key={i}>{em} <b>{b}</b>{rest ? ` ${rest}` : ''}</span>
          ))}
        </div>
      </div>

      <section id="feats" aria-label="Features">
        <div className="wrap">
          <div className="rv"><span className="eyebrow">Everything a modern school needs</span></div>
          <h2 className="h-lg rv" style={{ transitionDelay: '.06s' }}>One platform. Zero developers needed.</h2>
          <p className="lede rv" style={{ marginTop: 14, transitionDelay: '.12s' }}>
            Sckools is a school website builder, admissions engine and school management platform in one.
            Edit everything yourself from a simple admin — we handle design, hosting, your domain and security.
          </p>
          <p className="hint rv">↻ Click any card — flip it over and drop your number, we call you back.</p>
          <FlipFeatureCards />
        </div>
      </section>

      <section className="show-sec" aria-label="Pages included">
        <div className="wrap">
          <div className="rv"><span className="eyebrow gold">See it, don&rsquo;t imagine it</span></div>
          <h2 className="h-lg" data-a="blur" style={{ '--d': '.06s' } as CSSProperties}>Every page your school needs,<br />ready on day one.</h2>
          <div className="deck rv">
            {DECK.map((d, i) => (
              <div className="dkw" style={{ '--i': i } as CSSProperties} key={d.title}>
                <div className={`dk ${d.cls}`} onClick={() => openModal(d.title)}>
                  <span className="em">{d.em}</span>
                  <b>{d.title}</b>
                  <span>{d.hook}</span>
                  <i className="w1" /><i className="w2" />
                </div>
              </div>
            ))}
          </div>
          <p className="deck-cap rv">
            …and this is just the surface. <b onClick={() => openModal()}>Request a callback</b> — we&rsquo;ll walk you through your school, live.
          </p>
        </div>
      </section>

      <ProShowcase onCallback={() => openModal('Pro')} />

      <section className="events-sec" id="events" aria-label="Events network">
        <div className="beam" aria-hidden />
        <div className="wrap">
          {/* Heading and orbit share a row so the whole section fits one screen. */}
          <div className="ev-top">
            <div>
              <div className="rv"><span className="eyebrow">🎪 The Sckools Events Network</span></div>
              <h2 className="h-lg rv" style={{ transitionDelay: '.06s' }}>Inter-school events.<br />One shared stage.</h2>
              <p className="lede rv" style={{ marginTop: 14, transitionDelay: '.12s' }}>
                Alone, a school event reaches your students. On the network, it reaches every school on Sckools — bigger crowds, real competition, and sponsors we bring to you.
              </p>
            </div>

            <div className="ev-viz rv" aria-hidden>
              <div className="ev-stage">
                <div className="orbit o1" /><div className="orbit o2" />
                <div className="core">YOUR<br />EVENT</div>
              </div>
              {/* Desktop: pills revolve around the core. Mobile: they become a chip row below. */}
              <div className="sat-ring">
                <div className="sat" style={{ '--a': '-35deg' } as CSSProperties}>🏫 6 schools joined</div>
                <div className="sat" style={{ '--a': '55deg' } as CSSProperties}>👥 <b>2,400</b> students</div>
                <div className="sat" style={{ '--a': '145deg' } as CSSProperties}>🤝 sponsors matched</div>
                <div className="sat" style={{ '--a': '235deg' } as CSSProperties}>💰 monetized</div>
              </div>
            </div>
          </div>

          <div className="grid ev-pts">
            <div className="ev-pt rv">
              <h4>Your students, a bigger arena</h4>
              <p>Debates, sports, science fairs, olympiads — students compete across schools, win bigger, and stay in sync with today&rsquo;s standards.</p>
            </div>
            <div className="ev-pt rv" style={{ transitionDelay: '.08s' }}>
              <h4>Monetize every event</h4>
              <p>Host paid inter-school events with entry passes and audience. Bigger crowd, bigger stage — the network fills your seats.</p>
            </div>
            <div className="ev-pt rv" style={{ transitionDelay: '.16s' }}>
              <h4>We find sponsors for you</h4>
              <p>Tell us the event — Sckools contacts brands and partners on your behalf to sponsor it. You focus on students; we bring the backing.</p>
            </div>
          </div>
        </div>
      </section>

      <section id="tiers" aria-label="Plans">
        <div className="wrap">
          <div className="rv"><span className="eyebrow violet">Grow tier by tier</span></div>
          <h2 className="h-lg rv" style={{ transitionDelay: '.06s' }}>Every tier is a growth story.</h2>
          <div className="grid ladder" style={{ marginTop: 50 }}>
            {TIERS.map((t, i) => (
              <div className="rv" style={{ transitionDelay: `${i * 0.1}s` }} key={t.tk}>
                <div className={`tier ${t.cls}`}>
                  <span className="tk">{t.tk}</span>
                  <h3>{t.h}</h3>
                  <p className="why">{t.why}</p>
                  {t.inherit && <span className="inherit">↑ {t.inherit}</span>}
                  <div className="tfeats">
                    {t.groups.map((gr) => (
                      <div key={gr.g}>
                        <div className="grp">{gr.g}</div>
                        <ul>{gr.items.map((it) => <li key={it}>{it}</li>)}</ul>
                      </div>
                    ))}
                  </div>
                  <button className={`btn ${t.btn} btn-sm`} onClick={() => openModal(t.tk)}>Request a callback</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="switch" style={{ background: 'var(--paper2)', borderTop: '1px solid var(--line)' }} aria-label="Why switch">
        <div className="wrap">
          <div className="rv"><span className="eyebrow coral">Already have a website?</span></div>
          <h2 className="h-lg" data-a="left" style={{ '--d': '.06s' } as CSSProperties}>A website is a brochure.<br />Sckools is infrastructure.</h2>
          <div className="grid vs" style={{ marginTop: 42 }}>
            <div className="col old">
              <h3>😴 Your current agency site</h3>
              <ul>
                <li style={{ '--i': 0 } as CSSProperties}>Built once, stale in a year — every change costs money &amp; calls</li>
                <li style={{ '--i': 1 } as CSSProperties}>Enquiries land in an email nobody checks</li>
                <li style={{ '--i': 2 } as CSSProperties}>No events, no network, no reach beyond your gate</li>
                <li style={{ '--i': 3 } as CSSProperties}>Separate (expensive) software for management</li>
              </ul>
            </div>
            <div className="col new">
              <h3>🚀 Your school on Sckools</h3>
              <ul>
                <li style={{ '--i': 0 } as CSSProperties}>Frequent updates ship automatically — your site improves every month</li>
                <li style={{ '--i': 1 } as CSSProperties}>Every enquiry tracked, statused and followed up</li>
                <li style={{ '--i': 2 } as CSSProperties}>Students compete &amp; connect across the whole network</li>
                <li style={{ '--i': 3 } as CSSProperties}>Website + admissions + management in one subscription</li>
              </ul>
            </div>
          </div>
          <div className="mission rv">
            <span className="m-badge">🌍 Our only mission</span>
            <h3>We are <b>totally dedicated</b> to building the digital infrastructure of schools — worldwide.</h3>
            <p>
              Not an agency juggling twenty industries. Schools aren&rsquo;t one of the things we do — they&rsquo;re the <em>only</em> thing we do.
              Already have a website? Switching is effortless:
            </p>
            <div className="m-chips">
              <span className="m-chip" style={{ '--i': 0 } as CSSProperties}>🔁 We migrate your current site — free</span>
              <span className="m-chip" style={{ '--i': 1 } as CSSProperties}>🌐 Keep your domain &amp; branding</span>
              <span className="m-chip" style={{ '--i': 2 } as CSSProperties}>⏱️ Zero downtime, zero effort from you</span>
              <span className="m-chip" style={{ '--i': 3 } as CSSProperties}>📈 New features every month — no invoices</span>
            </div>
          </div>
          <div className="promise rv">
            <span style={{ fontSize: 32 }}>🛠️</span>
            <div>
              <div className="big">Onboarding promise: 2 months of custom feature support.</div>
              <p>Give us feedback, request the feature your school always wanted — we build it into your platform, included.</p>
            </div>
            <button className="btn btn-hot btn-sm" style={{ marginLeft: 'auto' }} onClick={() => openModal()}>Talk to us</button>
          </div>
        </div>
      </section>

      <section className="cta-band" aria-label="Get started">
        <div className="wrap">
          <div className="cta-card">
            <div className="blob b1" aria-hidden /><div className="blob b2" aria-hidden />
            <h2 className="h-lg" data-a="zoom">Ready to put your school<br />on a bigger stage?</h2>
            <p className="lede rv" style={{ transitionDelay: '.08s' }}>Request a callback — we&rsquo;ll show you your school on Sckools, live, in one call.</p>
            <div className="rv" style={{ transitionDelay: '.16s' }}>
              <button className="btn btn-hot" onClick={() => openModal()}>Request a callback</button>
            </div>
          </div>
        </div>
      </section>

      <footer className="foot">
        <div className="wrap">
          <div>
            <span className="logo"><SckoolsLogo size={24} /></span>
            <p style={{ marginTop: 8 }}>The next-gen revolution in school digital infrastructure.</p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div>
              📧 <a href={`mailto:${config.contactEmail}`}>{config.contactEmail}</a>
              {config.contactPhone ? <> · 📞 <a href={`tel:${config.contactPhone.replace(/\s/g, '')}`}>{config.contactPhone}</a></> : null}
            </div>
            <div style={{ marginTop: 6 }}>
              <a href="/pricing">Pricing</a> · <a href="#events">Events Network</a> · <Link href="/jobs">Jobs</Link> · <a href="/owner">Owner login</a>
            </div>
          </div>
        </div>
      </footer>

      {modalInterest !== false && <CallbackModal interest={modalInterest} onClose={() => setModalInterest(false)} />}
    </div>
  );
}
