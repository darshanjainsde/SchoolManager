'use client';
import { useEffect, useMemo, useState } from 'react';
import type { TvScreen } from '@skoolos/types';
import { useHydrated } from '@/lib/use-hydrated';

/**
 * The loop itself: a handful of full-screen panels rotating on a slow clock.
 *
 * Kiosk rules: no interaction, no scroll, nothing that can wedge. Data
 * refreshes by plain reload on a long interval — no sockets, no client
 * fetch, no CORS surface; a lobby TV tolerates one frame of flash at minute
 * forty. The clock renders only after hydration, because the server cannot
 * know the second the TV will paint (the hydration-mismatch rule).
 */

const ROTATE_MS = 12_000;
const RELOAD_MS = 40 * 60_000;

type Panel =
  | { kind: 'notices'; items: TvScreen['announcements'] }
  | { kind: 'today'; items: TvScreen['eventsToday']; holiday: string | null }
  | { kind: 'birthdays'; items: TvScreen['birthdays'] }
  | { kind: 'gallery'; items: string[] }
  | { kind: 'upcoming'; items: TvScreen['eventsUpcoming'] };

function buildPanels(s: TvScreen): Panel[] {
  const panels: Panel[] = [];
  if (s.announcements.length) panels.push({ kind: 'notices', items: s.announcements });
  if (s.eventsToday.length || s.holiday) panels.push({ kind: 'today', items: s.eventsToday, holiday: s.holiday });
  if (s.birthdays.length) panels.push({ kind: 'birthdays', items: s.birthdays });
  if (s.gallery.length) panels.push({ kind: 'gallery', items: s.gallery });
  if (s.eventsUpcoming.length) panels.push({ kind: 'upcoming', items: s.eventsUpcoming });
  // A school with nothing at all still deserves a calm screen, not a 404.
  if (!panels.length) panels.push({ kind: 'today', items: [], holiday: s.holiday });
  return panels;
}

function Clock() {
  const hydrated = useHydrated();
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    if (!hydrated) return;
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, [hydrated]);
  if (!now) return <span style={{ fontVariantNumeric: 'tabular-nums' }}>&nbsp;</span>;
  return (
    <span style={{ fontVariantNumeric: 'tabular-nums' }}>
      {new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).format(now)}
    </span>
  );
}

export function TvLoop({ initial, tvKey }: { initial: TvScreen; tvKey: string }) {
  const s = initial;
  const panels = useMemo(() => buildPanels(s), [s]);
  const [idx, setIdx] = useState(0);
  const hydrated = useHydrated();

  useEffect(() => {
    if (!hydrated || panels.length <= 1) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const t = setInterval(() => setIdx((i) => (i + 1) % panels.length), reduced ? ROTATE_MS * 2 : ROTATE_MS);
    return () => clearInterval(t);
  }, [hydrated, panels.length]);

  useEffect(() => {
    if (!hydrated) return;
    const t = setTimeout(() => window.location.reload(), RELOAD_MS);
    return () => clearTimeout(t);
  }, [hydrated]);

  const panel = panels[idx % panels.length]!;

  return (
    <div
      style={{
        // Deliberately single-theme: a lobby screen is a dark stage wearing
        // the school's two colours, whatever the TV's browser prefers.
        position: 'fixed', inset: 0, overflow: 'hidden', cursor: 'none',
        background: `linear-gradient(140deg, color-mix(in srgb, ${s.school.ps1} 24%, #0d0b1a), #0d0b1a 55%, color-mix(in srgb, ${s.school.ps2} 18%, #0d0b1a))`,
        color: '#F4F2FC', fontFamily: 'system-ui, sans-serif',
        display: 'flex', flexDirection: 'column',
      }}
      data-tv-key={tvKey ? 'set' : 'missing'}
    >
      {/* Masthead */}
      <header style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '28px 44px 18px' }}>
        {s.school.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- kiosk crest, fixed box
          <img src={s.school.logoUrl} alt="" style={{ width: 56, height: 56, objectFit: 'contain' }} />
        ) : null}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.01em' }}>{s.school.name}</div>
          <div style={{ fontSize: 16, opacity: 0.75 }}>
            {s.dateLabel}
            {s.school.festival ? ` · ${s.school.festival} ✨` : ''}
          </div>
        </div>
        <div style={{ fontSize: 44, fontWeight: 700 }}><Clock /></div>
      </header>

      <div style={{ height: 3, margin: '0 44px', borderRadius: 2, background: `linear-gradient(90deg, ${s.school.ps1}, ${s.school.ps2})` }} />

      {/* The rotating stage */}
      <main key={idx} className="tv-stage" style={{ flex: 1, minHeight: 0, padding: '30px 44px 18px', display: 'flex', flexDirection: 'column' }}>
        {panel.kind === 'notices' && (
          <>
            <PanelTitle accent={s.school.ps1}>Notice board</PanelTitle>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 18, alignContent: 'start' }}>
              {panel.items.slice(0, 4).map((a, i) => (
                <div key={i} style={{ background: 'rgba(255,255,255,0.07)', borderRadius: 14, padding: '18px 22px' }}>
                  <div style={{ fontSize: 22, fontWeight: 700 }}>{a.title}</div>
                  <div style={{ fontSize: 17, opacity: 0.85, marginTop: 6, lineHeight: 1.5 }}>{a.body}</div>
                  <div style={{ fontSize: 13, opacity: 0.55, marginTop: 10 }}>{a.when}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {panel.kind === 'today' && (
          <>
            <PanelTitle accent={s.school.ps1}>Today at school</PanelTitle>
            {panel.holiday && (
              <div style={{ fontSize: 26, fontWeight: 700, marginBottom: 16 }}>
                🎊 {panel.holiday} — the calendar marks today a holiday
              </div>
            )}
            {panel.items.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {panel.items.map((e, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 16, background: 'rgba(255,255,255,0.07)', borderRadius: 14, padding: '16px 22px' }}>
                    <span style={{ fontSize: 22, fontWeight: 800, color: s.school.ps1, fontVariantNumeric: 'tabular-nums' }}>{e.time}</span>
                    <span style={{ fontSize: 24, fontWeight: 700 }}>{e.title}</span>
                    {e.venue && <span style={{ fontSize: 17, opacity: 0.7 }}>· {e.venue}</span>}
                  </div>
                ))}
              </div>
            ) : !panel.holiday ? (
              <div style={{ fontSize: 24, opacity: 0.75 }}>A regular school day. Classes as per the timetable.</div>
            ) : null}
          </>
        )}

        {panel.kind === 'birthdays' && (
          <>
            <PanelTitle accent={s.school.ps2}>Janamdin mubarak 🎂</PanelTitle>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, alignContent: 'start' }}>
              {panel.items.map((b, i) => (
                <div key={i} style={{ background: 'rgba(255,255,255,0.07)', borderRadius: 14, padding: '18px 22px', fontSize: 24, fontWeight: 700 }}>
                  {b.name}
                  {b.className && <span style={{ fontSize: 16, opacity: 0.7, fontWeight: 500 }}> · {b.className}</span>}
                </div>
              ))}
            </div>
          </>
        )}

        {panel.kind === 'gallery' && (
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12, minHeight: 0 }}>
            {panel.items.slice(0, 6).map((url, i) => (
              // eslint-disable-next-line @next/next/no-img-element -- kiosk collage from the school's own gallery
              <img key={i} src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 14, minHeight: 0 }} />
            ))}
          </div>
        )}

        {panel.kind === 'upcoming' && (
          <>
            <PanelTitle accent={s.school.ps1}>Coming up</PanelTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {panel.items.map((e, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 16, background: 'rgba(255,255,255,0.07)', borderRadius: 14, padding: '16px 22px' }}>
                  <span style={{ fontSize: 20, fontWeight: 800, color: s.school.ps2 }}>{e.when}</span>
                  <span style={{ fontSize: 24, fontWeight: 700 }}>{e.title}</span>
                  {e.venue && <span style={{ fontSize: 17, opacity: 0.7 }}>· {e.venue}</span>}
                </div>
              ))}
            </div>
          </>
        )}
      </main>

      {/* Footer: rotation dots */}
      <footer style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: '0 0 22px' }}>
        {panels.map((_, i) => (
          <span
            key={i}
            style={{
              width: 8, height: 8, borderRadius: 99,
              background: i === idx % panels.length ? s.school.ps1 : 'rgba(255,255,255,0.25)',
            }}
          />
        ))}
      </footer>

      <style>{`
        .tv-stage { animation: tv-in 600ms ease; }
        @keyframes tv-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) { .tv-stage { animation: none; } }
      `}</style>
    </div>
  );
}

function PanelTitle({ children, accent }: { children: React.ReactNode; accent: string }) {
  return (
    <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: accent, marginBottom: 18 }}>
      {children}
    </div>
  );
}
