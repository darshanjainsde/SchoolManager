import './console-skeleton.css';
import { SckoolsLogo } from '@/components/brand/sckools-logo';

/**
 * What a console shows while it is working out who you are.
 *
 * Every console layout used to `return null` twice on the way in — once until
 * React had hydrated, once until the boot probe had answered — so the
 * prerendered HTML for /app, /portal, /teacher and the rest contained a <body>
 * tag and 249 bytes, with no visible text at all. The page was correct, fast to
 * serve, and completely blank for about 870 ms: the JavaScript had to arrive
 * and a round trip to Mumbai had to come back before anything could be drawn.
 * On a school's wi-fi and a three-year-old Android that blank is the whole
 * perceived slowness of the product.
 *
 * This is what goes there instead. It is deliberately DUMB: no hooks, no
 * storage reads, no host, nothing that can differ between the server and the
 * browser's first paint. That is what makes it safe to render during hydration
 * — the mismatch risk that forced the `null` in the first place comes from
 * reading localStorage while rendering, and there is none of that here.
 *
 * It carries no data and claims none. A skeleton that guessed at rows would be
 * a lie the moment the real ones differed; these are plainly placeholders, and
 * the geometry is sized to the real chrome so nothing jumps when it arrives.
 */

/** One shimmering placeholder block. */
function Bar({ w, h = 12, className = '' }: { w: string; h?: number; className?: string }) {
  return (
    <div
      className={`sk-skel-bar ${className}`}
      style={{ width: w, height: h, borderRadius: h >= 24 ? 10 : 5 }}
      aria-hidden="true"
    />
  );
}

export interface ConsoleSkeletonProps {
  /**
   * `side` — a dark rail on the left, as /app, /platform and /teacher wear on a
   * wide screen. `top` — a single bar across the top, as /portal wears.
   */
  chrome: 'side' | 'top';
  /** Named in the rail so a reload lands somewhere recognisable, not anonymous. */
  label: string;
}

export function ConsoleSkeleton({ chrome, label }: ConsoleSkeletonProps) {
  return (
    <div className="sk-skel" role="status" aria-busy="true">
      {/* One live region for the whole screen. Screen readers should hear
          "loading" once, not once per placeholder block. */}
      <span className="sk-skel-sr">Loading {label}…</span>

      {chrome === 'side' ? (
        <div className="sk-skel-split">
          <aside className="sk-skel-rail" aria-hidden="true">
            <div className="sk-skel-brand">
              <SckoolsLogo theme="dark" size={28} />
              <span className="sk-skel-role">{label}</span>
            </div>
            <div className="sk-skel-nav">
              {[...Array(7)].map((_, i) => (
                <div key={i} className="sk-skel-navrow">
                  <Bar w="18px" h={18} />
                  <Bar w={`${58 + ((i * 17) % 34)}%`} />
                </div>
              ))}
            </div>
          </aside>
          <main className="sk-skel-main">
            <Content />
          </main>
        </div>
      ) : (
        <div className="sk-skel-stack">
          <header className="sk-skel-top" aria-hidden="true">
            <SckoolsLogo variant="symbol" size={30} />
            <span className="sk-skel-role sk-skel-role-top">{label}</span>
            <div className="sk-skel-spacer" />
            <Bar w="30px" h={30} />
            <Bar w="76px" h={30} />
          </header>
          <main className="sk-skel-main">
            <Content />
          </main>
        </div>
      )}

    </div>
  );
}

/** The page body: a heading, a row of tiles, and a list. */
function Content() {
  return (
    <div className="sk-skel-page" aria-hidden="true">
      <Bar w="min(320px, 62%)" h={28} />
      <Bar w="min(460px, 84%)" h={12} className="sk-skel-sub" />
      <div className="sk-skel-tiles">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="sk-skel-tile">
            <Bar w="52%" h={10} />
            <Bar w="38%" h={22} />
          </div>
        ))}
      </div>
      <div className="sk-skel-rows">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="sk-skel-row">
            <Bar w="26px" h={26} />
            <Bar w={`${34 + ((i * 23) % 30)}%`} />
            <div className="sk-skel-spacer" />
            <Bar w="64px" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default ConsoleSkeleton;
