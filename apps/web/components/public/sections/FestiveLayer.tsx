import type { FestiveTheme } from '../site-variants';
import { festivalDef } from '../site-variants';
import { SCENES } from '../festive/scenes';

/**
 * THE FESTIVE DRESS — one scene per festival, drawn inside the hero.
 *
 * Every treatment (LAYER · CHROME · HERO · WASH · NIGHT) shows the SAME scene;
 * the treatment decides how much of the page takes the festival's colours
 * (see themeRootProps), the scene decides what is drawn. The scenes live in
 * ../festive/: a drawing kit (primitives.tsx) and one file of scenes per
 * family. Deities are public-domain paintings in a frame, never drawn.
 *
 * Every position is a CONSTANT. Math.random()/Date in render desyncs the
 * server HTML from the hydration pass — that trap is in the ledger twice.
 *
 * The page-wide emoji overlay this file used to draw is gone: the owner
 * judged it — and the recoloured banner that followed it — as "all the same".
 */

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

/** Drawn once per page; the footer edge's <use> points at it. */
export function FestiveSymbols() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <defs>
        {/* a string of small bulbs: dots on a drooping thread, five lamps hanging from it */}
        <symbol id="ps-fest-bulbs" viewBox="0 0 380 34" overflow="visible" preserveAspectRatio="none">
          <path d="M-4 6q95 22 190 6t194-6" fill="none" stroke="currentColor" strokeWidth="1" opacity=".55" />
          <path d="M-4 6q95 22 190 6t194-6" fill="none" stroke="#ffd98a" strokeWidth="3.2" strokeDasharray="0 11" strokeLinecap="round" opacity=".95" />
          <g stroke="currentColor" strokeWidth="1" opacity=".7"><path d="M52 15v7M132 18v8M212 13v7M292 10v8M356 5v7" /></g>
          <g fill="#ffd27a" opacity=".38"><circle cx="52" cy="26" r="9" /><circle cx="132" cy="30" r="9" /><circle cx="212" cy="24" r="9" /><circle cx="292" cy="22" r="9" /><circle cx="356" cy="16" r="9" /></g>
          <g fill="#ffe3a3">
            {[[52, 26, 0], [132, 30, 0.4], [212, 24, 0.8], [292, 22, 0.2], [356, 16, 0.6]].map(([x, y, d]) => (
              <circle key={x} className="ps-fx-twinkle" cx={x} cy={y} r="4.5" style={{ animationDelay: `${d}s` }} />
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
 * under the words. `imageUrl` is the school's own picture for a scene that
 * shows one (resolved by the API from festiveTheme.imageAssetId); it is only
 * used when the saved theme still names that asset.
 */
export function FestiveDress({ fest, imageUrl = null }: { fest: FestiveTheme | null; imageUrl?: string | null }) {
  if (!fest) return null;
  const def = festivalDef(fest.festival);
  const Scene = SCENES[fest.festival];
  if (!def || !Scene) return null;
  return (
    <div className="ps-fest-dress" aria-hidden="true" data-fest-dress={fest.treatment} data-fest-scene={fest.variant}>
      <Scene
        variant={fest.variant}
        treatment={fest.treatment}
        night={fest.treatment === 'NIGHT'}
        imageUrl={fest.imageAssetId ? imageUrl : null}
      />
    </div>
  );
}

/** The bulb string returns along the footer's top edge on the dressed treatments. */
export function FestiveFooterEdge({ fest }: { fest: FestiveTheme | null }) {
  if (!fest || fest.treatment === 'LAYER') return null;
  const def = festivalDef(fest.festival);
  if (!def) return null;
  // Festivals that are not about lights keep a plain footer edge.
  if (new Set(['HOLI', 'GANDHI', 'INDEPENDENCE', 'REPUBLIC']).has(def.value)) return null;
  return (
    <div className="ps-fest-footedge" aria-hidden="true">
      <svg viewBox="0 0 380 34" preserveAspectRatio="none" style={{ color: 'var(--ps-accent-text)' }}>
        <use href="#ps-fest-bulbs" width="380" height="34" />
      </svg>
    </div>
  );
}
