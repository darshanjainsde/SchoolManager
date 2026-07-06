'use client';

import { useState } from 'react';
import type { PublicCourse } from '@/lib/public-api';

const RANK_EMOJIS: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };
// Render order puts 1st in the middle, elevated, like a real podium.
const PODIUM_ORDER = [2, 1, 3];

export function hofCourses(courses: PublicCourse[]): PublicCourse[] {
  return courses.filter((c) => c.hallOfFame.length > 0);
}

/** Class-wise toppers podium. Switching class replays the rise animation. */
export default function HallOfFame({ courses }: { courses: PublicCourse[] }) {
  const withEntries = hofCourses(courses);
  const [activeId, setActiveId] = useState(withEntries[0]?.id);
  // Bumping the key remounts the podium, replaying the CSS animations.
  const [animKey, setAnimKey] = useState(0);

  if (withEntries.length === 0) return null;
  const active = withEntries.find((c) => c.id === activeId) ?? withEntries[0];
  const byRank = new Map(active.hallOfFame.map((h) => [h.rank, h]));

  return (
    <section id="hall-of-fame" className="text-white" style={{ background: 'linear-gradient(160deg, color-mix(in srgb, var(--ps1) 72%, #14261d), #14261d)' }}>
      <div className="max-w-6xl mx-auto px-6 py-20">
        <div className="reveal">
          <div className="text-sm font-semibold uppercase tracking-widest" style={{ color: 'var(--ps2)' }}>
            Hall of Fame
          </div>
          <h2 className="ps-head text-4xl font-bold mt-3 text-white">Our stars, class by class</h2>
        </div>

        {withEntries.length > 1 && (
          <div className="mt-8 flex flex-wrap gap-2">
            {withEntries.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  setActiveId(c.id);
                  setAnimKey((k) => k + 1);
                }}
                className={`rounded-full px-4 py-1.5 text-sm transition border ${
                  c.id === active.id
                    ? 'ps-accentbg font-bold border-transparent'
                    : 'border-white/20 text-white/80 hover:bg-white/10'
                }`}
                style={c.id === active.id ? { color: 'var(--ink)' } : undefined}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}

        <div key={animKey} className="mt-12 grid grid-cols-3 gap-4 items-end max-w-2xl">
          {PODIUM_ORDER.map((rank) => {
            const entry = byRank.get(rank);
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
                    <img src={entry.photoUrl} alt={entry.name} className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-3xl">🎓</span>
                  )}
                </div>
                <div className="text-xl -mt-3 relative z-10">{RANK_EMOJIS[rank]}</div>
                <div className="ps-head font-bold text-white text-sm md:text-base mt-1">{entry.name}</div>
                <div className="text-xs text-white/70">
                  {[entry.achievement, entry.year].filter(Boolean).join(' · ')}
                </div>
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
      </div>
    </section>
  );
}
