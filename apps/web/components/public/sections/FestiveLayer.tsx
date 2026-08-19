'use client';

import type { FestiveTheme } from '../site-variants';
import { festivalDef, festiveDecorations } from '../site-variants';

/**
 * The festive decoration layer — a fixed, pointer-transparent overlay UNDER
 * the nav (z-49 vs the nav's 50). Purely presentational: the palette work
 * (accent swap, FULL retint) happens in themeRootProps, so removing this layer
 * removes every trace of the festival.
 *
 * Every position below is a CONSTANT. Math.random()/Date in render desyncs
 * the server HTML from the hydration pass — that trap is already in the
 * ledger twice, so the "randomness" is hand-rolled tables instead.
 */

const FALL_SPOTS = [3, 9, 16, 22, 30, 37, 45, 52, 58, 66, 73, 80, 87, 93, 12, 41, 63, 84];
const FALL_DUR = [7.2, 9.1, 6.4, 8.3, 10.2, 7.7, 9.6, 6.9, 8.8, 7.4, 9.9, 6.6, 8.1, 9.3, 7.9, 8.6, 6.7, 9.4];
const FALL_DELAY = [0, 2.1, 4.3, 1.2, 3.4, 5.6, 0.8, 2.9, 5.1, 1.7, 3.9, 0.4, 2.5, 4.7, 1.9, 3.1, 5.3, 0.6];
const STAR_SPOTS: Array<[number, number]> = [[8, 6], [22, 12], [38, 4], [55, 10], [70, 5], [86, 11], [15, 18]];
const HOLI_COLORS = ['#e91e8c', '#ffc107', '#26c281', '#2196f3', '#ff5722'];

function FallField({ glyphs, colors }: { glyphs?: string[]; colors?: string[] }) {
  return (
    <>
      {FALL_SPOTS.map((left, i) => (
        <span
          key={i}
          className="ps-fx-fall"
          style={{
            left: `${left}%`,
            animationDuration: `${FALL_DUR[i]}s`,
            animationDelay: `${FALL_DELAY[i]}s`,
            ...(glyphs
              ? { fontSize: `${11 + (i % 3) * 3}px`, color: colors?.[i % (colors.length || 1)] }
              : {
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  background: colors?.[i % (colors.length || 1)] ?? '#fff',
                }),
          }}
          aria-hidden="true"
        >
          {glyphs ? glyphs[i % glyphs.length] : null}
        </span>
      ))}
    </>
  );
}

function LightRow({ colors }: { colors: string[] }) {
  return (
    <span className="ps-fx-lightrow" aria-hidden="true">
      {Array.from({ length: 16 }, (_, i) => (
        <i
          key={i}
          className="ps-fx-bulb"
          style={{
            background: colors[i % colors.length],
            boxShadow: `0 0 9px 3px ${colors[i % colors.length]}88`,
            animationDelay: `${(i % 5) * 0.3}s`,
          }}
        />
      ))}
    </span>
  );
}

function Decoration({ set }: { set: string }) {
  switch (set) {
    case 'DIYAS':
      return (
        <>
          <LightRow colors={['#ffb74d', '#ffd54f', '#ff8a65']} />
          <span className="ps-fx-diya" style={{ left: 18 }} aria-hidden="true">🪔</span>
          <span className="ps-fx-diya" style={{ right: 18, animationDelay: '.8s' }} aria-hidden="true">🪔</span>
        </>
      );
    case 'FIREWORKS':
      return (
        <>
          <span className="ps-fx-burst" style={{ top: '12%', left: '12%' }} aria-hidden="true" />
          <span className="ps-fx-burst" style={{ top: '18%', right: '10%', animationDelay: '1.1s' }} aria-hidden="true" />
          <span className="ps-fx-burst" style={{ top: '46%', left: '44%', animationDelay: '2.1s', width: 90, height: 90 }} aria-hidden="true" />
          {STAR_SPOTS.slice(0, 5).map(([l, t], i) => (
            <span key={i} className="ps-fx-star" style={{ left: `${l}%`, top: `${t + 4}%`, animationDelay: `${i * 0.4}s` }} aria-hidden="true">✨</span>
          ))}
        </>
      );
    case 'RANGOLI':
      return (
        <>
          <span className="ps-fx-rangoli" style={{ bottom: -76, left: -76 }} aria-hidden="true" />
          <span className="ps-fx-rangoli" style={{ bottom: -76, right: -76 }} aria-hidden="true" />
        </>
      );
    case 'SPLASH':
      return (
        <>
          {[['-3%', '-3%', 0], ['-4%', undefined, 1], [undefined, '18%', 2], [undefined, undefined, 3]].map((p, i) => (
            <span
              key={i}
              className="ps-fx-blob"
              style={{
                top: i < 2 ? (p[0] as string) : undefined,
                bottom: i >= 2 ? '-4%' : undefined,
                left: i === 0 ? '-3%' : i === 2 ? (p[1] as string) : undefined,
                right: i === 1 || i === 3 ? '-3%' : undefined,
                background: HOLI_COLORS[i],
                animationDelay: `${i * 0.7}s`,
              }}
              aria-hidden="true"
            />
          ))}
        </>
      );
    case 'CONFETTI':
      return <FallField colors={HOLI_COLORS} />;
    case 'LANTERNS':
      return (
        <>
          <span className="ps-fx-lantern" style={{ left: '16%' }} aria-hidden="true">🏮</span>
          <span className="ps-fx-lantern" style={{ left: '50%', animationDelay: '.7s', fontSize: 32 }} aria-hidden="true">🏮</span>
          <span className="ps-fx-lantern" style={{ left: '82%', animationDelay: '1.3s' }} aria-hidden="true">🏮</span>
        </>
      );
    case 'CRESCENT':
      return (
        <>
          <span className="ps-fx-moon" aria-hidden="true">🌙</span>
          {STAR_SPOTS.map(([l, t], i) => (
            <span key={i} className="ps-fx-star" style={{ left: `${l}%`, top: `${t}%`, animationDelay: `${i * 0.35}s` }} aria-hidden="true">⭐</span>
          ))}
        </>
      );
    case 'BUNTING':
      return (
        <span className="ps-fx-bunting" aria-hidden="true">
          {Array.from({ length: 18 }, (_, i) => (
            <i key={i} className="ps-fx-flag" style={{ background: ['#e8862a', '#f6f4ef', '#2e9d6b'][i % 3] }} />
          ))}
        </span>
      );
    case 'KITES':
      return (
        <>
          <span className="ps-fx-kite" aria-hidden="true">🪁</span>
          <span className="ps-fx-kite" style={{ animationDelay: '5.5s', fontSize: 22 }} aria-hidden="true">🪁</span>
          <span className="ps-fx-kite" style={{ animationDelay: '11s', fontSize: 33 }} aria-hidden="true">🪁</span>
        </>
      );
    case 'SNOW':
      return <FallField glyphs={['❄', '❅', '•']} colors={['#cfe3f0', '#e8f2fa', '#bcd6e8']} />;
    case 'LIGHTS':
      return <LightRow colors={['#e74c3c', '#f1c40f', '#2ecc71', '#3498db']} />;
    default:
      return null;
  }
}

export default function FestiveLayer({ fest }: { fest: FestiveTheme }) {
  const def = festivalDef(fest.festival);
  if (!def) return null;
  return (
    <div className="ps-fx" aria-hidden="true">
      {festiveDecorations(fest).map((set) => (
        <Decoration key={set} set={set} />
      ))}
    </div>
  );
}

/** The greeting strip above the nav — rendered by PublicSite so it scrolls. */
export function FestiveRibbon({ fest }: { fest: FestiveTheme }) {
  const def = festivalDef(fest.festival);
  if (!def || !fest.ribbon) return null;
  return (
    <div className="ps-fest-ribbon">
      {def.emoji} {def.greeting} {def.emoji}
    </div>
  );
}
