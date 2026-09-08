'use client';

import { useEffect, useState } from 'react';
import type { PublicHallOfFame, PublicHallOfFameEntry, PublicHallOfFameGroup } from '@/lib/public-api';
import { batchLabel } from '@/lib/batch-label';

/** The layouts a school can pick in the studio (site-variants.ts lists the same values). */
export const HOF_LAYOUTS = ['PODIUM', 'MEDALS', 'SPOTLIGHT', 'SHELF', 'TIMELINE', 'YEARBOOK', 'SCOREBOARD'] as const;
export type HofLayout = (typeof HOF_LAYOUTS)[number];

const RANK_EMOJIS: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };
const RANK_WORDS: Record<number, string> = { 1: 'First', 2: 'Second', 3: 'Third' };
// Render order puts 1st in the middle, elevated, like a real podium.
const PODIUM_ORDER = [2, 1, 3];

export function hofHasEntries(hof: PublicHallOfFame | null | undefined): boolean {
  return !!hof && hof.groups.some((g) => g.entries.length > 0);
}

function groupsForYear(hof: PublicHallOfFame, year: number): PublicHallOfFameGroup[] {
  return hof.groups.filter((g) => g.entries.some((e) => e.batchYear === year));
}

function podiumOf(group: PublicHallOfFameGroup | undefined, year: number): Map<number, PublicHallOfFameEntry> {
  return new Map((group?.entries ?? []).filter((e) => e.batchYear === year).map((e) => [e.rank, e]));
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

/** A percentage in the achievement text ("98.2% · CBSE") → 98.2, else null. */
function scoreOf(achievement: string | null): number | null {
  const m = achievement?.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

function Avatar({ entry, className }: { entry: PublicHallOfFameEntry; className: string }) {
  return (
    <div className={`ps-hof-ava ${className}`}>
      {entry.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={entry.photoUrl} alt={entry.name} className="h-full w-full object-cover" loading="lazy" decoding="async" />
      ) : (
        <span aria-hidden="true">{initials(entry.name) || '🎓'}</span>
      )}
    </div>
  );
}

/**
 * Batches × groups × podium. The visitor picks a batch year and a group; the
 * chosen layout stages the three places. Layouts carry their own tone: the
 * podium, spotlight, shelf, timeline and scoreboard sit on the brand
 * gradient; the medal wall on paper; the yearbook on its cork board.
 */
export default function HallOfFame({ hof, layout }: { hof: PublicHallOfFame; layout?: string | null }) {
  const lay: HofLayout = (HOF_LAYOUTS as readonly string[]).includes(layout ?? '') ? (layout as HofLayout) : 'PODIUM';
  const [year, setYear] = useState(hof.landingYear);
  const [groupId, setGroupId] = useState<string | undefined>(groupsForYear(hof, hof.landingYear)[0]?.id);
  // Bumping the key remounts the podium, replaying the CSS animations.
  const [animKey, setAnimKey] = useState(0);

  function pickYear(y: number) {
    setYear(y);
    const gs = groupsForYear(hof, y);
    setGroupId((cur) => (gs.some((g) => g.id === cur) ? cur : gs[0]?.id));
    setAnimKey((k) => k + 1);
  }

  // A shared "Batch of 2022" link — read after mount only, so the server HTML
  // and the first client render agree (the landing year) and hydration is clean.
  useEffect(() => {
    try {
      const raw = new URLSearchParams(window.location.search).get('batch');
      const y = raw ? Number(raw) : NaN;
      if (Number.isInteger(y) && hof.years.includes(y) && y !== hof.landingYear) pickYear(y);
    } catch {
      /* no URL access — the landing year stands */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pickYearAndShare(y: number) {
    pickYear(y);
    try {
      const url = new URL(window.location.href);
      if (y === hof.landingYear) url.searchParams.delete('batch');
      else url.searchParams.set('batch', String(y));
      url.hash = 'hall-of-fame';
      window.history.replaceState(null, '', url.toString());
    } catch {
      /* history not writable here — the choice still shows */
    }
  }

  const groups = groupsForYear(hof, year);
  const active = groups.find((g) => g.id === groupId) ?? groups[0];
  const podium = podiumOf(active, year);
  const dark = lay !== 'MEDALS' && lay !== 'YEARBOOK';
  const sectionStyle = dark
    ? { background: 'linear-gradient(160deg, color-mix(in srgb, var(--ps1) 72%, #14261d), #14261d)' }
    : lay === 'YEARBOOK'
      ? { background: '#f6efe3' }
      : { background: 'color-mix(in srgb, var(--ps1) 6%, var(--paper))' };

  return (
    <section
      id="hall-of-fame"
      className={`ps-hof ps-hof-${lay.toLowerCase()} ${dark ? 'text-white' : ''}`}
      style={sectionStyle}
      data-layout={lay}
    >
      <div className="max-w-6xl mx-auto px-6 py-20">
        <div className="reveal">
          <div className="text-sm font-semibold uppercase tracking-widest" style={{ color: dark ? 'var(--ps2)' : 'var(--ps1)' }}>
            Hall of Fame
          </div>
          <h2 className={`ps-head text-4xl font-bold mt-3 ${dark ? 'text-white' : ''}`}>Our stars, class by class</h2>
        </div>

        {/* The batch chips — the timeline layout shows every batch at once, so it needs none. */}
        {lay !== 'TIMELINE' && hof.years.length > 1 && (
          <div className="mt-8 flex flex-wrap items-center gap-2" role="group" aria-label="Batch">
            <span className="ps-hof-lab">Batch of</span>
            {hof.years.map((y) => (
              <button
                key={y}
                type="button"
                onClick={() => pickYearAndShare(y)}
                className="ps-hof-chip ps-hof-year"
                data-on={y === year}
                aria-pressed={y === year}
              >
                {batchLabel(y)}
              </button>
            ))}
          </div>
        )}

        {groups.length > 1 && (
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Class">
            {groups.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => {
                  setGroupId(g.id);
                  setAnimKey((k) => k + 1);
                }}
                className="ps-hof-chip"
                data-on={g.id === active?.id}
                aria-pressed={g.id === active?.id}
              >
                {g.label}
              </button>
            ))}
          </div>
        )}

        {active && (
          <div key={animKey}>
            {lay === 'PODIUM' && <Podium podium={podium} year={year} />}
            {lay === 'MEDALS' && <MedalWall podium={podium} year={year} />}
            {lay === 'SPOTLIGHT' && <Spotlight podium={podium} year={year} />}
            {lay === 'SHELF' && <Shelf podium={podium} year={year} />}
            {lay === 'TIMELINE' && <Timeline hof={hof} group={active} />}
            {lay === 'YEARBOOK' && <Yearbook podium={podium} year={year} />}
            {lay === 'SCOREBOARD' && <Scoreboard podium={podium} year={year} group={active} />}
          </div>
        )}
      </div>
    </section>
  );
}

type PodiumProps = { podium: Map<number, PublicHallOfFameEntry>; year: number };

function caption(entry: PublicHallOfFameEntry, year: number) {
  return [entry.achievement, batchLabel(year)].filter(Boolean).join(' · ');
}

/* 1 · Podium — today's look, unchanged. */
function Podium({ podium, year }: PodiumProps) {
  return (
    <div className="mt-12 grid grid-cols-3 gap-4 items-end max-w-2xl mx-auto">
      {PODIUM_ORDER.map((rank) => {
        const entry = podium.get(rank);
        if (!entry) return <div key={rank} />;
        const first = rank === 1;
        return (
          <div key={rank} className={`ps-champ text-center ps-champ-${rank}`}>
            <div
              className={`relative mx-auto rounded-full overflow-hidden grid place-items-center bg-white/10 ${
                first ? 'h-24 w-24 md:h-28 md:w-28' : 'h-20 w-20 md:h-24 md:w-24'
              }`}
              style={{
                border: first ? '3px solid var(--ps2)' : '3px solid rgba(255,255,255,.25)',
                boxShadow: first ? '0 0 0 6px color-mix(in srgb, var(--ps2) 20%, transparent)' : undefined,
              }}
            >
              {entry.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={entry.photoUrl} alt={entry.name} className="h-full w-full object-cover" loading="lazy" decoding="async" />
              ) : (
                <span className="text-3xl">🎓</span>
              )}
            </div>
            <div className="text-xl -mt-3 relative z-10">{RANK_EMOJIS[rank]}</div>
            <div className="ps-head font-bold text-white text-sm md:text-base mt-1">{entry.name}</div>
            <div className="text-xs text-white/70">{caption(entry, year)}</div>
            <div
              className="mx-auto mt-3 w-4/5 rounded-t-xl grid place-items-center text-xl font-extrabold text-white/85"
              style={{
                height: first ? 96 : rank === 2 ? 68 : 50,
                background: first
                  ? 'linear-gradient(180deg, var(--ps2), color-mix(in srgb, var(--ps2) 55%, #000))'
                  : rank === 2
                    ? 'linear-gradient(180deg, #9fb3a8, #6c8177)'
                    : 'linear-gradient(180deg, #c98a5b, #96603a)',
              }}
            >
              {rank}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* 2 · Medal wall — portrait cards with a ribbon medal. */
function MedalWall({ podium, year }: PodiumProps) {
  return (
    <div className="ps-hof-wall reveal in">
      {[1, 2, 3].map((rank) => {
        const entry = podium.get(rank);
        if (!entry) return null;
        return (
          <div key={rank} className="ps-hof-mc">
            <span className="ps-hof-rib" aria-hidden="true" />
            <Avatar entry={entry} className="ps-hof-ava-lg" />
            <span className={`ps-hof-md ps-hof-md-${rank}`} aria-hidden="true">
              {rank}
            </span>
            <div className="ps-head font-bold text-base mt-2">{entry.name}</div>
            <div className="ps-hof-cls">
              {RANK_WORDS[rank]} · {caption(entry, year)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* 3 · Spotlight — the topper large, second and third beside. */
function Spotlight({ podium, year }: PodiumProps) {
  const first = podium.get(1);
  const rest = [2, 3].map((r) => podium.get(r)).filter((e): e is PublicHallOfFameEntry => !!e);
  return (
    <div className="ps-hof-spot reveal in">
      {first && (
        <div className="ps-hof-hero">
          <Avatar entry={first} className="ps-hof-ava-xl" />
          <div>
            <div className="ps-hof-k">Topper · Batch of {batchLabel(year)}</div>
            <div className="ps-head font-bold text-2xl md:text-3xl text-white mt-1">{first.name}</div>
            {first.achievement && <div className="text-sm text-white/80 mt-1">{first.achievement}</div>}
          </div>
        </div>
      )}
      {rest.length > 0 && (
        <div className="ps-hof-side">
          {rest.map((e) => (
            <div key={e.rank} className="ps-hof-sc">
              <Avatar entry={e} className="ps-hof-ava-sm" />
              <div className="min-w-0">
                <div className="ps-head font-bold text-white text-base truncate">{e.name}</div>
                {e.achievement && <div className="text-xs text-white/75">{e.achievement}</div>}
              </div>
              <span className="ps-hof-r">#{e.rank}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* 4 · Trophy shelf — engraved plaques, no photos needed. */
function Shelf({ podium, year }: PodiumProps) {
  return (
    <div className="ps-hof-shelf reveal in">
      <div className="ps-hof-plaques">
        {[1, 2, 3].map((rank) => {
          const entry = podium.get(rank);
          if (!entry) return null;
          return (
            <div key={rank} className="ps-hof-plq">
              <div className="ps-hof-plq-t" aria-hidden="true">
                {rank === 1 ? '🏆' : RANK_EMOJIS[rank]}
              </div>
              <div className="ps-head ps-hof-plq-nm">{entry.name}</div>
              {entry.achievement && <div className="ps-hof-plq-ach">{entry.achievement}</div>}
              <div className="ps-hof-plq-yr">Batch of {batchLabel(year)}</div>
            </div>
          );
        })}
      </div>
      <div className="ps-hof-board" aria-hidden="true" />
    </div>
  );
}

/* 5 · Batch timeline — every batch of the chosen group, side by side. */
function Timeline({ hof, group }: { hof: PublicHallOfFame; group: PublicHallOfFameGroup }) {
  const years = hof.years.filter((y) => group.entries.some((e) => e.batchYear === y));
  return (
    <div className="ps-hof-rail reveal in">
      <div className="ps-hof-years">
        {years.map((y, i) => {
          const p = podiumOf(group, y);
          return (
            <div key={y} className="ps-hof-yc" data-now={i === 0}>
              <div className="ps-head ps-hof-y">{batchLabel(y)}</div>
              <div className="ps-hof-cls">{group.label}</div>
              <div className="ps-hof-trio">
                {[1, 2, 3].map((rank) => {
                  const e = p.get(rank);
                  if (!e) return null;
                  return (
                    <span key={rank}>
                      <b>
                        <i aria-hidden="true">{RANK_EMOJIS[rank]}</i> <span>{e.name}</span>
                      </b>
                      {e.achievement && <em>{e.achievement}</em>}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* 6 · Yearbook — polaroids on a cork board. */
function Yearbook({ podium, year }: PodiumProps) {
  const tilt = ['-3deg', '2deg', '-1.5deg'];
  return (
    <div className="ps-hof-cork reveal in">
      {[1, 2, 3].map((rank, i) => {
        const entry = podium.get(rank);
        if (!entry) return null;
        return (
          <div key={rank} className="ps-hof-pol" style={{ ['--rot' as string]: tilt[i] }}>
            <span className="ps-hof-st" aria-hidden="true">
              {['⭐', '🌟', '✨'][i]}
            </span>
            <Avatar entry={entry} className="ps-hof-ava-sq" />
            <div className="ps-hof-cap">
              {entry.name}
              <small>
                {['1st', '2nd', '3rd'][i]} · {caption(entry, year)}
              </small>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* 7 · Scoreboard — leaderboard rows with a score bar. */
function Scoreboard({ podium, year, group }: PodiumProps & { group: PublicHallOfFameGroup }) {
  return (
    <div className="ps-hof-score reveal in" role="table" aria-label={`${group.label} · Batch of ${batchLabel(year)}`}>
      <div className="ps-hof-sr ps-hof-sr-h" role="row">
        <span role="columnheader">Rank</span>
        <span aria-hidden="true" />
        <span role="columnheader">Student</span>
        <span role="columnheader" className="text-right">
          Score
        </span>
        <span aria-hidden="true" />
      </div>
      {[1, 2, 3].map((rank) => {
        const e = podium.get(rank);
        if (!e) return null;
        const score = scoreOf(e.achievement);
        return (
          <div key={rank} className="ps-hof-sr" role="row">
            <span className={`ps-hof-rk ps-hof-rk-${rank}`} role="cell">
              {rank}
            </span>
            <Avatar entry={e} className="ps-hof-ava-xs" />
            <div className="min-w-0" role="cell">
              <div className="font-semibold text-white truncate">{e.name}</div>
              <div className="ps-hof-cls">
                {group.label} · Batch of {batchLabel(year)}
              </div>
            </div>
            <div className="ps-hof-pc" role="cell">
              {score != null ? `${score}%` : (e.achievement ?? '—')}
            </div>
            <div className="ps-hof-bar" aria-hidden="true">
              {score != null && <i style={{ width: `${Math.max(8, Math.min(100, (score - 60) * 2.5))}%` }} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}
