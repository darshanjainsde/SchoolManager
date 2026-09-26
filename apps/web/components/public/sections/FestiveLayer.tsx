import type { FestivalDef, FestiveTheme } from '../site-variants';
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

function RiseField({ glyphs, count = 10 }: { glyphs: string[]; count?: number }) {
  return (
    <>
      {FALL_SPOTS.slice(0, count).map((left, i) => (
        <span
          key={i}
          className="ps-fx-rise"
          style={{
            left: `${left}%`,
            fontSize: `${16 + (i % 3) * 6}px`,
            animationDuration: `${FALL_DUR[i] + 2}s`,
            animationDelay: `${FALL_DELAY[i]}s`,
          }}
          aria-hidden="true"
        >
          {glyphs[i % glyphs.length]}
        </span>
      ))}
    </>
  );
}

/** A swaying garland of glyphs strung along the top edge (marigold torans). */
function GarlandRow({ glyphs }: { glyphs: string[] }) {
  return (
    <span className="ps-fx-garland" aria-hidden="true">
      {Array.from({ length: 14 }, (_, i) => (
        <i key={i} className="ps-fx-gitem" style={{ animationDelay: `${(i % 4) * 0.45}s` }}>
          {glyphs[i % glyphs.length]}
        </i>
      ))}
    </span>
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

/** Every set the switch below can draw — guard-tested against FESTIVALS so a
 *  festival can never declare a variant that silently renders nothing. */
export const DECORATION_SETS = [
  'DIYAS', 'FIREWORKS', 'RANGOLI', 'SPLASH', 'CONFETTI', 'LANTERNS', 'CRESCENT',
  'BUNTING', 'KITES', 'SNOW', 'LIGHTS', 'MARIGOLD', 'GARBA', 'PETALS', 'TRICOLOR',
  'GOLDDUST', 'BALLOONS', 'SUN', 'PEACOCK', 'DOODLES', 'BOOKS', 'HARVEST',
  'CRAYONS', 'GLOW', 'GIFTS', 'RAKHI', 'MITHAI',
] as const;

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
    case 'MARIGOLD':
      return <GarlandRow glyphs={['🌼', '🌺', '🌼', '🍃']} />;
    case 'GARBA':
      return <FallField colors={['#c41e3a', '#e8b923', '#ff4e88', '#0e7c4a']} />;
    case 'PETALS':
      return <FallField glyphs={['🌸', '🌼', '🌺']} colors={['#e8862a', '#e0558a', '#d3492f']} />;
    case 'TRICOLOR':
      return <FallField colors={['#e8862a', '#f6f4ef', '#2e9d6b']} />;
    case 'GOLDDUST':
      return <FallField glyphs={['✦', '✨', '•']} colors={['#e5c77b', '#c0c0c0', '#b8912f']} />;
    case 'BALLOONS':
      return <RiseField glyphs={['🎈', '🎈', '🎉']} />;
    case 'SUN':
      return (
        <>
          <span className="ps-fx-sun" aria-hidden="true">☀️</span>
          {STAR_SPOTS.slice(0, 4).map(([l, t], i) => (
            <span key={i} className="ps-fx-star" style={{ left: `${l}%`, top: `${t + 6}%`, animationDelay: `${i * 0.5}s` }} aria-hidden="true">✨</span>
          ))}
        </>
      );
    case 'PEACOCK':
      return (
        <>
          <span className="ps-fx-perch" style={{ left: 16 }} aria-hidden="true">🦚</span>
          <span className="ps-fx-perch" style={{ right: 16, animationDelay: '1.2s' }} aria-hidden="true">🦚</span>
          <FallField glyphs={['🪶']} colors={['#1b6ca8', '#0f9b8e']} />
        </>
      );
    case 'DOODLES':
      return <FallField glyphs={['⭐', '🚀', '✏️', '🖍️', '⚽']} colors={['#e74c3c', '#2196f3', '#ffc107', '#2ecc71']} />;
    case 'BOOKS':
      return <FallField glyphs={['📚', '✏️', '🍎', '⭐']} colors={['#1f3a5f', '#c0392b', '#b8912f']} />;
    case 'HARVEST':
      return (
        <>
          <span className="ps-fx-perch" style={{ left: 14 }} aria-hidden="true">🌾</span>
          <span className="ps-fx-perch" style={{ right: 14, animationDelay: '.9s' }} aria-hidden="true">🌾</span>
          {STAR_SPOTS.slice(0, 4).map(([l, t], i) => (
            <span key={i} className="ps-fx-star" style={{ left: `${l}%`, top: `${t + 8}%`, animationDelay: `${i * 0.45}s` }} aria-hidden="true">✨</span>
          ))}
        </>
      );
    case 'CRAYONS':
      return <LightRow colors={['#e74c3c', '#2196f3', '#ffc107', '#2ecc71', '#e91e8c']} />;
    case 'GLOW':
      return <LightRow colors={['#e5c77b', '#f2d789', '#d9b45e']} />;
    case 'GIFTS':
      return <FallField glyphs={['🎁', '⭐', '❄']} colors={['#c0392b', '#e8b923', '#cfe3f0']} />;
    case 'RAKHI':
      return (
        <>
          <span className="ps-fx-rakhi" style={{ top: 96, left: -34 }} aria-hidden="true" />
          <span className="ps-fx-rakhi" style={{ bottom: -34, right: -34, animationDelay: '3s', width: 150, height: 150 }} aria-hidden="true" />
        </>
      );
    case 'MITHAI':
      return <FallField glyphs={['🎁', '🍬', '✨']} colors={['#e63946', '#f25287', '#d4a017']} />;
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


/* ══════════════════════════════════════════════════════════════════════════
   THE DRESS — what CHROME, HERO, WASH and NIGHT draw. (LAYER keeps the
   decoration sets above.)

   Three marks, drawn once as <symbol>s and reused: a string of small bulbs,
   a thin line rangoli, a clay diya. Chosen from the references the owner
   approved — a bulb string along the top, one framed lamp, a rangoli set in
   the ground — and deliberately NOT a garland, fireworks or falling glyphs.
   No filters, no images: a phone paints this in one pass. Every animation is
   opacity/transform only and answers to --motion / reduced-motion in CSS.
   ══════════════════════════════════════════════════════════════════════════ */

/** Which drawn marks a festival's dress uses. Bulbs and bokeh for nearly all;
 *  the rangoli and the diya only where they belong. */
export function festiveMarks(def: FestivalDef): { bulbs: boolean; rangoli: boolean; diya: boolean } {
  const rangoli = new Set(['DIWALI', 'DURGA', 'NAVRATRI', 'ONAM', 'UGADI', 'SANKRANTI', 'GANESH', 'VASANT', 'GURUNANAK']);
  const diya = new Set(['DIWALI', 'DURGA', 'GURUNANAK', 'LOHRI', 'JANMASHTAMI', 'GANESH']);
  const noBulbs = new Set(['HOLI', 'GANDHI', 'INDEPENDENCE', 'REPUBLIC']);
  return { bulbs: !noBulbs.has(def.value), rangoli: rangoli.has(def.value), diya: diya.has(def.value) };
}

/** Drawn once per page; every <use> below points at these. */
export function FestiveSymbols() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="ps-fest-g-flame"><stop offset="0" stopColor="#ffcf7a" stopOpacity=".78" /><stop offset=".45" stopColor="#f2a13a" stopOpacity=".28" /><stop offset="1" stopColor="#f2a13a" stopOpacity="0" /></radialGradient>
        <radialGradient id="ps-fest-g-pool"><stop offset="0" stopColor="#f2a13a" stopOpacity=".4" /><stop offset="1" stopColor="#f2a13a" stopOpacity="0" /></radialGradient>
        {/* clay diya: uneven rim, dark oil, wick, teardrop flame, light on the floor */}
        <symbol id="ps-fest-diya" viewBox="-30 -40 60 52" overflow="visible">
          <ellipse cx="0" cy="6" rx="34" ry="7" fill="url(#ps-fest-g-pool)" />
          <circle cx="0" cy="-14" r="20" fill="url(#ps-fest-g-flame)" />
          <path d="M-20 0c-1 6 6 11 20 11s21-5 20-11c0-2-2-2-3-2h-34c-1 0-3 0-3 2z" fill="#9a4b2a" />
          <path d="M-20-1q20-5 40 0q-2-3-20-4t-20 4z" fill="#b86a40" />
          <ellipse cx="0" cy="-1.5" rx="15" ry="2.6" fill="#3a1a0d" />
          <path d="M0-2v-4" stroke="#2a1208" strokeWidth="1.4" strokeLinecap="round" />
          <g className="ps-fest-flame"><path d="M0-5c4-6 5-12 .6-21C-4.6-17-4-11 0-5z" fill="#ffb84a" /><path d="M0-7c2-4 2.5-8 .3-13C-2.2-15-2-11 0-7z" fill="#fff1c2" /></g>
        </symbol>
        {/* line rangoli: eight petals, sixteen inner, a ring of dots — thin, for the ground */}
        <symbol id="ps-fest-rangoli" viewBox="-80 -80 160 160" overflow="visible">
          <g fill="none" stroke="currentColor" strokeWidth="1.3">
            <circle r="76" /><circle r="62" /><circle r="12" />
            {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => <ellipse key={a} cx="0" cy="-44" rx="11" ry="26" transform={`rotate(${a})`} />)}
            {[22.5, 45, 67.5, 90, 112.5, 135, 157.5, 180, 202.5, 225, 247.5, 270, 292.5, 315, 337.5, 360].map((a) => <ellipse key={a} cx="0" cy="-24" rx="5" ry="12" transform={`rotate(${a})`} />)}
            <circle r="69" strokeWidth="3" strokeDasharray="0 9" strokeLinecap="round" />
          </g>
        </symbol>
        {/* a string of small bulbs: dots on a drooping thread, five lamps hanging from it */}
        <symbol id="ps-fest-bulbs" viewBox="0 0 380 34" overflow="visible" preserveAspectRatio="none">
          <path d="M-4 6q95 22 190 6t194-6" fill="none" stroke="currentColor" strokeWidth="1" opacity=".55" />
          <path d="M-4 6q95 22 190 6t194-6" fill="none" stroke="#ffd98a" strokeWidth="3.2" strokeDasharray="0 11" strokeLinecap="round" opacity=".95" />
          <g stroke="currentColor" strokeWidth="1" opacity=".7"><path d="M52 15v7M132 18v8M212 13v7M292 10v8M356 5v7" /></g>
          <g fill="#ffd27a" opacity=".38"><circle cx="52" cy="26" r="9" /><circle cx="132" cy="30" r="9" /><circle cx="212" cy="24" r="9" /><circle cx="292" cy="22" r="9" /><circle cx="356" cy="16" r="9" /></g>
          <g fill="#ffe3a3">
            {[[52, 26, 0], [132, 30, 0.4], [212, 24, 0.8], [292, 22, 0.2], [356, 16, 0.6]].map(([x, y, d]) => (
              <circle key={x} className="ps-fest-bulb" cx={x} cy={y} r="4.5" style={{ animationDelay: `${d}s` }} />
            ))}
          </g>
        </symbol>
      </defs>
    </svg>
  );
}

/**
 * The hero's dress. Rendered INSIDE the hero section, after its background
 * layers and before its copy, so document order stacks it: over the photo,
 * under the words. Positions are constants — server and client must agree.
 */
export function FestiveDress({ fest }: { fest: FestiveTheme | null }) {
  if (!fest || fest.treatment === 'LAYER') return null;
  const def = festivalDef(fest.festival);
  if (!def) return null;
  const marks = festiveMarks(def);
  const showBokeh = fest.treatment !== 'CHROME';
  return (
    <div className="ps-fest-dress" aria-hidden="true" data-fest-dress={fest.treatment}>
      {showBokeh && <div className="ps-fest-bokeh" />}
      {marks.bulbs && (
        <svg className="ps-fest-bulbs" viewBox="0 0 380 34" preserveAspectRatio="none" style={{ color: 'var(--ps-hero-accent)' }}>
          <use href="#ps-fest-bulbs" width="380" height="34" />
        </svg>
      )}
      {(marks.rangoli || marks.diya) && (
        <svg className="ps-fest-corner" viewBox="0 0 220 200" style={{ color: 'var(--ps-hero-accent)' }}>
          {marks.rangoli && <use className="ps-fest-rangoli" href="#ps-fest-rangoli" x="40" y="20" width="180" height="180" />}
          {marks.diya && <use href="#ps-fest-diya" x="118" y="146" width="56" height="48" />}
          {marks.diya && <use href="#ps-fest-diya" x="60" y="160" width="40" height="34" />}
        </svg>
      )}
    </div>
  );
}

/** The bulb string returns along the footer's top edge on the dressed treatments. */
export function FestiveFooterEdge({ fest }: { fest: FestiveTheme | null }) {
  if (!fest || fest.treatment === 'LAYER') return null;
  const def = festivalDef(fest.festival);
  if (!def || !festiveMarks(def).bulbs) return null;
  return (
    <div className="ps-fest-footedge" aria-hidden="true">
      <svg viewBox="0 0 380 34" preserveAspectRatio="none" style={{ color: 'var(--ps-accent-text)' }}>
        <use href="#ps-fest-bulbs" width="380" height="34" />
      </svg>
    </div>
  );
}
