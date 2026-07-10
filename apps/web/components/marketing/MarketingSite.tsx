'use client';
import './marketing.css';
import { useEffect, useRef, useState } from 'react';
import type { MarketingConfigData } from '@/lib/public-api';
import CallbackModal from './CallbackModal';
import FlipFeatureCards from './FlipFeatureCards';

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
    items: ['Full public website + gallery', 'Courses, admissions & hall of fame', 'Enquiry inbox with status tracking', 'Your own domain & hosting'],
    btn: 'btn-ghost',
  },
  {
    cls: 'std', tk: 'Standard', h: 'Be engaging.',
    why: 'Everything in Basic, plus your community stays connected — events, about & contact pages, social reach.',
    items: ['Everything in Basic', 'Events published to the network feed', 'About, contact & social presence', 'Priority support'],
    btn: 'btn-hot',
  },
  {
    cls: 'pro', tk: 'Pro', h: 'Be the stage.',
    why: 'Host network events, get sponsor matchmaking, and run the school itself on our management suite.',
    items: ['Everything in Standard', 'Host inter-school events + sponsors', 'Full management suite (students, fees, staff)', 'Custom feature support'],
    btn: 'btn-ink',
  },
];

/** Attaches the IntersectionObserver reveal + counter animations. */
function useMarketingMotion(root: React.RefObject<HTMLDivElement>) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
    el.querySelectorAll('.rv').forEach((n) => io.observe(n));

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
    el.querySelectorAll('[data-count]').forEach((n) => cio.observe(n));

    return () => {
      io.disconnect();
      cio.disconnect();
    };
  }, [root]);
}

export default function MarketingSite({ config }: { config: MarketingConfigData }) {
  const root = useRef<HTMLDivElement>(null);
  const [modalInterest, setModalInterest] = useState<string | null | false>(false);
  useMarketingMotion(root);
  const openModal = (interest: string | null = null) => setModalInterest(interest);

  return (
    <div className="mkt" ref={root}>
      <nav className="mnav" aria-label="Main">
        <div className="mnav-in">
          <span className="logo"><span className="s">S</span>Sckools</span>
          <a className="lnk" href="#feats">Features</a>
          <a className="lnk" href="#events">Events Network</a>
          <a className="lnk" href="/pricing">Pricing</a>
          <a className="lnk" href="#switch">Why switch</a>
          <button className="btn btn-hot btn-sm" onClick={() => openModal()}>Request a callback</button>
        </div>
      </nav>

      <header className="hero">
        <div className="dots" aria-hidden />
        <div className="wrap hero-in">
          <div>
            <div className="rv"><span className="eyebrow">✦ Next-gen school digital infrastructure</span></div>
            <div className="rv" style={{ transitionDelay: '.08s' }}>
              <h1 className="h-xl">
                Your school,<br />on a{' '}
                <span className="hl">
                  bigger stage
                  <svg viewBox="0 0 300 24" preserveAspectRatio="none" aria-hidden>
                    <path d="M4 16 C 60 22, 120 6, 170 12 S 270 20, 296 10" />
                  </svg>
                </span>
              </h1>
            </div>
            <p className="lede rv" style={{ transitionDelay: '.16s' }}>
              A stunning website, an admissions engine, effortless management — and a live network of schools where your students compete, connect and get discovered.
            </p>
            <div className="hero-ctas rv" style={{ transitionDelay: '.24s' }}>
              <button className="btn btn-hot" onClick={() => openModal()}>Request a callback</button>
              <a className="btn btn-ghost" href="/pricing">Explore plans →</a>
            </div>
            <div className="trust rv" style={{ transitionDelay: '.32s' }}>
              {TRUST.map((t) => (
                <div className="t" key={t.label}>
                  <b data-count={t.end}>0</b>
                  <span>{t.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="stage rv" style={{ transitionDelay: '.28s' }}>
            <div className="browser">
              <div className="bbar">
                <i style={{ background: '#FF8A80' }} /><i style={{ background: '#FFD54F' }} /><i style={{ background: '#81E6C0' }} />
                <span className="url">🔒 beacon.sckools.com</span>
              </div>
              <div className="bhero">
                <div className="tag">ADMISSIONS OPEN 2026–27</div>
                <h4>Beacon Public School</h4>
                <p>Where curiosity meets excellence — Nursery to Grade 12</p>
                <span className="mini">Enquire now</span>
              </div>
              <div className="brow">
                <div className="bcell"><b>Courses</b>flip-card explorer</div>
                <div className="bcell"><b>Hall of Fame</b>class toppers</div>
                <div className="bcell"><b>Events</b>network feed</div>
              </div>
            </div>
            <div className="chip ch1"><span className="ci" style={{ background: 'var(--teal-soft)' }}>📥</span><div><b>New enquiry</b><span>Sunita, for Grade 3 · just now</span></div></div>
            <div className="chip ch2"><span className="ci" style={{ background: 'var(--gold-soft)' }}>🏆</span><div><b>Science Fair — LIVE</b><span>6 schools · 400+ students</span></div></div>
            <div className="chip ch3"><span className="ci" style={{ background: 'var(--violet-soft)' }}>🤝</span><div><b>Sponsor matched</b><span>Annual sports meet, funded</span></div></div>
          </div>
        </div>
      </header>

      <div className="marq" aria-hidden>
        <div className="track">
          {[...MARQUEE, ...MARQUEE].map(([em, b, rest], i) => (
            <span className="mchip" key={i}>{em} <b>{b}</b>{rest ? ` ${rest}` : ''}</span>
          ))}
        </div>
      </div>

      <section id="feats" aria-label="Features">
        <div className="wrap">
          <div className="rv"><span className="eyebrow">Everything a modern school needs</span></div>
          <h2 className="h-lg rv" style={{ transitionDelay: '.06s' }}>One platform. Zero developers needed.</h2>
          <p className="lede rv" style={{ marginTop: 14, transitionDelay: '.12s' }}>
            Edit everything yourself from a simple admin — we handle design, hosting, domains and security.
          </p>
          <p className="hint rv">↻ Click any card — flip it over and drop your number, we call you back.</p>
          <FlipFeatureCards />
        </div>
      </section>

      <section className="show-sec" aria-label="Pages included">
        <div className="wrap">
          <div className="rv"><span className="eyebrow gold">See it, don&rsquo;t imagine it</span></div>
          <h2 className="h-lg rv" style={{ transitionDelay: '.06s' }}>Every page your school needs,<br />ready on day one.</h2>
          <div className="deck rv">
            {DECK.map((d) => (
              <div className="dkw" key={d.title}>
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

      <section className="events-sec" id="events" aria-label="Events network">
        <div className="wrap">
          <div className="rv"><span className="eyebrow">🎪 The Sckools Events Network</span></div>
          <h2 className="h-lg rv" style={{ transitionDelay: '.06s' }}>Inter-school events.<br />One shared stage.</h2>
          <p className="lede rv" style={{ marginTop: 14, transitionDelay: '.12s' }}>
            Alone, a school event reaches your students. On the network, it reaches every school on Sckools — bigger crowds, real competition, and sponsors we bring to you.
          </p>

          <div className="orbit-wrap rv" aria-hidden>
            <div className="orbit o1" /><div className="orbit o2" />
            <div className="core">YOUR<br />EVENT</div>
            <div className="sat" style={{ transform: 'translate(-50%,-50%) translate(-190px,-90px)' }}>🏫 6 schools joined</div>
            <div className="sat" style={{ transform: 'translate(-50%,-50%) translate(185px,-60px)' }}>👥 <b>2,400</b> students</div>
            <div className="sat" style={{ transform: 'translate(-50%,-50%) translate(-170px,110px)' }}>🤝 sponsors matched</div>
            <div className="sat" style={{ transform: 'translate(-50%,-50%) translate(160px,130px)' }}>💰 monetized</div>
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
                  <ul>{t.items.map((it) => <li key={it}>{it}</li>)}</ul>
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
          <h2 className="h-lg rv" style={{ transitionDelay: '.06s' }}>A website is a brochure.<br />Sckools is infrastructure.</h2>
          <div className="grid vs" style={{ marginTop: 42 }}>
            <div className="col old rv">
              <h3>😴 Your current agency site</h3>
              <ul>
                <li>Built once, stale in a year — every change costs money &amp; calls</li>
                <li>Enquiries land in an email nobody checks</li>
                <li>No events, no network, no reach beyond your gate</li>
                <li>Separate (expensive) software for management</li>
              </ul>
            </div>
            <div className="col new rv" style={{ transitionDelay: '.1s' }}>
              <h3>🚀 Your school on Sckools</h3>
              <ul>
                <li>Frequent updates ship automatically — your site improves every month</li>
                <li>Every enquiry tracked, statused and followed up</li>
                <li>Students compete &amp; connect across the whole network</li>
                <li>Website + admissions + management in one subscription</li>
              </ul>
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
            <h2 className="h-lg rv">Ready to put your school<br />on a bigger stage?</h2>
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
            <span className="logo" style={{ fontSize: 16 }}><span className="s" style={{ width: 28, height: 28, fontSize: 13 }}>S</span>Sckools</span>
            <p style={{ marginTop: 8 }}>The next-gen revolution in school digital infrastructure.</p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div>
              📧 <a href={`mailto:${config.contactEmail}`}>{config.contactEmail}</a>
              {config.contactPhone ? <> · 📞 <a href={`tel:${config.contactPhone.replace(/\s/g, '')}`}>{config.contactPhone}</a></> : null}
            </div>
            <div style={{ marginTop: 6 }}>
              <a href="/pricing">Pricing</a> · <a href="#events">Events Network</a> · <a href="/owner">Owner login</a>
            </div>
          </div>
        </div>
      </footer>

      {modalInterest !== false && <CallbackModal interest={modalInterest} onClose={() => setModalInterest(false)} />}
    </div>
  );
}
