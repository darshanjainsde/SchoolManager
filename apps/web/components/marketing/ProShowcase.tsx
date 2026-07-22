'use client';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

/** The Pro tier, shown as a dark premium band: a left-rail accordion that
 *  explains the real features, paired with a deliberately abstract animated
 *  stage (capability, not a UI a competitor could copy). Auto-advances; pauses
 *  on hover; each pillar's stage remounts (via React key) so its motion replays. */

interface Pillar {
  id: string;
  icon: string;
  tab: string;
  tabSub: string;
  title: string;
  tagline: string;
  desc: string;
  feats: string[];
  /** --pa (accent), --pa-t (tint), --pa-g (glow), --pa-c (chip). */
  vars: CSSProperties;
  glow: string;
}

const PILLARS: Pillar[] = [
  {
    id: 'website',
    icon: '✦',
    tab: 'A living website',
    tabSub: 'never sits still',
    title: 'A website that reshapes itself.',
    tagline: 'Endless layouts, your brand — always looking new.',
    desc: 'Redesign your entire front page in minutes — no developer, no agency invoice. Pick a look, drop your photos, publish. It goes live on your own domain instantly.',
    feats: [
      'Seven first-screen layouts — full-canvas, mosaic, editorial, slideshow & more',
      'Navbar styles & colours, animated headlines, image overlays',
      'A gallery that opens into a full-screen lightbox',
      'Every change live at once — on your own domain, with SSL',
    ],
    vars: { '--pa': 'var(--violet)', '--pa-t': 'rgba(109,74,255,.22)', '--pa-g': 'rgba(109,74,255,.6)', '--pa-c': '#c9bcff' } as CSSProperties,
    glow: 'rgba(109,74,255,.5)',
  },
  {
    id: 'management',
    icon: '◉',
    tab: 'One operating system',
    tabSub: 'runs the whole school',
    title: 'One system runs the school.',
    tagline: 'Every moving part, quietly in order — in one place.',
    desc: 'The admin office, digitised. Students, staff, timetables, attendance, fees and enquiries all live in one connected engine — no spreadsheets, no scattered tools.',
    feats: [
      'Students, classes, teachers & staff records',
      'Timetables, attendance & teacher availability',
      'Assignments, announcements & the enquiry inbox',
      'Fees & invoices, tracked end to end',
    ],
    vars: { '--pa': 'var(--teal-hi)', '--pa-t': 'rgba(20,184,166,.22)', '--pa-g': 'rgba(20,184,166,.6)', '--pa-c': '#7ff0dd' } as CSSProperties,
    glow: 'rgba(20,184,166,.5)',
  },
  {
    id: 'portals',
    icon: '⇄',
    tab: 'Two portals, one rhythm',
    tabSub: 'teachers & students',
    title: 'Teachers and students, in sync.',
    tagline: 'Assignments out, work back — everyone informed.',
    desc: 'Two dedicated apps that keep your whole community moving as one. Teachers run their day; students and parents always know what’s next — all flowing from the same core.',
    feats: [
      'Teacher portal — attendance in taps, assignments & announcements',
      'Student portal — timetable, results, fees & notifications',
      'Parents and students never miss what matters',
      'Everything flows from the same management engine',
    ],
    vars: { '--pa': 'var(--coral)', '--pa-t': 'rgba(255,122,69,.22)', '--pa-g': 'rgba(255,122,69,.6)', '--pa-c': '#ffb38a' } as CSSProperties,
    glow: 'rgba(255,122,69,.4)',
  },
  {
    id: 'stage',
    icon: '❖',
    tab: 'A stage beyond the gates',
    tabSub: 'network & sponsors',
    title: 'A stage beyond your gates.',
    tagline: 'Your events radiate across the network — sponsors light up.',
    desc: 'Alone, a school event reaches your students. On the Sckools network it reaches every school — bigger crowds, real competition, and sponsors we bring to you.',
    feats: [
      'Host paid inter-school events with entry passes',
      'Published to the shared network feed — bigger audiences',
      'Sponsor matchmaking — we pitch brands to back your events',
      'Students compete and get discovered across schools',
    ],
    vars: { '--pa': 'var(--gold)', '--pa-t': 'rgba(245,166,35,.22)', '--pa-g': 'rgba(245,166,35,.6)', '--pa-c': '#ffd98a' } as CSSProperties,
    glow: 'rgba(245,166,35,.4)',
  },
];

const DUR = 6500;

function Scene({ index }: { index: number }) {
  // Abstract, non-literal motion — one per pillar. Rendered fresh on each
  // activation (parent keys it) so the animation always plays from the start.
  if (index === 0)
    return (
      <div className="pa">
        <div className="pa-canvas">
          <div className="pa-comp c1"><span className="pa-blk" /><span className="pa-line l1" /><span className="pa-line l2" /><span className="pa-accent" /></div>
          <div className="pa-comp c2"><span className="pa-blk" /><span className="pa-line l1" /><span className="pa-line l2" /><span className="pa-accent" /></div>
          <div className="pa-comp c3"><span className="pa-blk b1" /><span className="pa-blk b2" /><span className="pa-blk b3" /></div>
        </div>
      </div>
    );
  if (index === 1)
    return (
      <div className="pb">
        <div className="pb-sys">
          <div className="pb-ring r1">
            <svg viewBox="-100 -100 200 200"><line x1="0" y1="0" x2="0" y2="-82" /><line x1="0" y1="0" x2="71" y2="41" /><line x1="0" y1="0" x2="-71" y2="41" /></svg>
            <div className="pb-node" style={{ transform: 'translateY(-82px)' }}>🎓</div>
            <div className="pb-node" style={{ transform: 'rotate(120deg) translateY(-82px)' }}><span style={{ display: 'block', transform: 'rotate(-120deg)' }}>🗓️</span></div>
            <div className="pb-node" style={{ transform: 'rotate(240deg) translateY(-82px)' }}><span style={{ display: 'block', transform: 'rotate(-240deg)' }}>✅</span></div>
            <div className="pb-pulse" style={{ '--fx': '0px', '--fy': '-82px' } as CSSProperties} />
            <div className="pb-pulse" style={{ '--fx': '71px', '--fy': '41px' } as CSSProperties} />
          </div>
          <div className="pb-ring r2">
            <svg viewBox="-100 -100 200 200"><line x1="0" y1="0" x2="0" y2="60" /><line x1="0" y1="0" x2="-52" y2="-30" /><line x1="0" y1="0" x2="52" y2="-30" /></svg>
            <div className="pb-node" style={{ transform: 'translateY(60px)' }}>🧑‍🏫</div>
            <div className="pb-node" style={{ transform: 'rotate(120deg) translateY(60px)' }}><span style={{ display: 'block', transform: 'rotate(-120deg)' }}>💳</span></div>
            <div className="pb-node" style={{ transform: 'rotate(240deg) translateY(60px)' }}><span style={{ display: 'block', transform: 'rotate(-240deg)' }}>📋</span></div>
          </div>
          <div className="pb-core" />
        </div>
      </div>
    );
  if (index === 2)
    return (
      <div className="pc">
        <div className="pc-mono left"><span className="ct" /><span className="cl" style={{ top: 26, right: '30%' }} /><span className="cl" style={{ top: 38, right: '45%' }} /></div>
        <div className="pc-lane">
          <span className="pc-p a" style={{ animationDelay: '0s' }} /><span className="pc-p a" style={{ animationDelay: '.9s' }} /><span className="pc-p a" style={{ animationDelay: '1.8s' }} />
          <span className="pc-p b" style={{ animationDelay: '.45s' }} /><span className="pc-p b" style={{ animationDelay: '1.35s' }} /><span className="pc-p b" style={{ animationDelay: '2.25s' }} />
          <span className="pc-flare" />
        </div>
        <div className="pc-mono right"><span className="ct" /><span className="cl" style={{ top: 26, right: '30%' }} /><span className="cl" style={{ top: 38, right: '45%' }} /></div>
      </div>
    );
  return (
    <div className="pd">
      <div className="pd-sys">
        <div className="pd-ripple d1" /><div className="pd-ripple d2" /><div className="pd-ripple d3" />
        <div className="pd-sat" style={{ transform: 'translate(0,-120px)' }} />
        <div className="pd-sat spark" style={{ transform: 'translate(114px,-38px)' }}>🤝</div>
        <div className="pd-sat" style={{ transform: 'translate(70px,98px)' }} />
        <div className="pd-sat" style={{ transform: 'translate(-70px,98px)' }} />
        <div className="pd-sat" style={{ transform: 'translate(-114px,-38px)' }} />
        <div className="pd-core" />
      </div>
    </div>
  );
}

export default function ProShowcase({ onCallback }: { onCallback: () => void }) {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduced = useRef(false);

  const stars = useMemo(
    () => Array.from({ length: 26 }, () => ({
      left: `${(Math.random() * 100).toFixed(1)}%`,
      top: `${(Math.random() * 100).toFixed(1)}%`,
      delay: `${(Math.random() * 3.5).toFixed(2)}s`,
    })),
    [],
  );

  useEffect(() => {
    reduced.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  useEffect(() => {
    if (reduced.current || paused) return;
    const t = window.setTimeout(() => setActive((a) => (a + 1) % PILLARS.length), DUR);
    return () => window.clearTimeout(t);
  }, [active, paused]);

  const p = PILLARS[active];

  return (
    <section className="pro-band" id="pro" aria-label="Inside Pro" style={{ ['--pro-dur' as string]: `${DUR}ms` }}>
      <div className="pro-grain" aria-hidden />
      <div className="wrap">
        <div className="rv"><span className="pro-kick"><span className="dot" />The Pro tier</span></div>
        <h2 className="h-lg rv" style={{ transitionDelay: '.06s' }}>Your school, running on one quiet engine.</h2>
        <p className="lede pro-sub rv" style={{ transitionDelay: '.12s' }}>
          A website is where it starts. <em>Pro</em> is everything behind it — the system that runs the school,
          the portals that connect it, and a stage that reaches far past your gates.
        </p>

        <div
          className="pro-th rv"
          style={{ transitionDelay: '.18s', ...p.vars }}
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          <div className={`pro-rail${paused ? ' paused' : ''}`} role="tablist" aria-label="Pro features">
            {PILLARS.map((pl, i) => (
              <div className={`pro-item${i === active ? ' on' : ''}`} key={pl.id} style={pl.vars}>
                <button
                  className="pro-tab"
                  role="tab"
                  aria-selected={i === active}
                  aria-expanded={i === active}
                  onClick={() => setActive(i)}
                >
                  <span className="ic" aria-hidden>{pl.icon}</span>
                  <span className="tt"><b>{pl.tab}</b><span>{pl.tabSub}</span></span>
                  <i className="bar" aria-hidden />
                </button>
                <div className="pro-detail" role="tabpanel" hidden={i !== active}>
                  <p>{pl.desc}</p>
                  <ul className="pro-feats">
                    {pl.feats.map((f) => <li key={f}>{f}</li>)}
                  </ul>
                </div>
              </div>
            ))}
          </div>

          <div className="pro-stage">
            <div className="pro-field" aria-hidden>
              {stars.map((s, i) => (
                <span className="pro-star" key={i} style={{ left: s.left, top: s.top, animationDelay: s.delay }} />
              ))}
            </div>
            {/* key={active} remounts the scene so its abstract motion replays */}
            <div className="pro-screen" key={active} aria-hidden>
              <div className="pro-glow" style={{ width: '55%', height: '55%', left: '22%', top: '10%', background: p.glow }} />
              <Scene index={active} />
              <div className="pro-scene-label"><b>{p.title}</b><span>{p.tagline}</span></div>
            </div>
          </div>
        </div>

        <div className="pro-cta rv">
          <button className="btn btn-hot" onClick={onCallback}>Request a callback</button>
          <span className="pro-note">See your school running on Pro, live, in one call.</span>
        </div>
      </div>
    </section>
  );
}
