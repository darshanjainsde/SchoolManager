import type { ReactNode } from 'react';
import { Crest } from './GatehouseLogin';
import type { LoginTheme } from './gatehouse-theme';

/**
 * The gatehouse every password page stands in: the living background, the
 * school's identity panel on the left, the form panel on the right, and the
 * gate-open overlay. /login draws the same thing inline; /reset-password and
 * /forgot-password share THIS so neither can drift back to a bare card — which
 * is exactly what /forgot-password still was when the other two had moved on.
 *
 * Only the words change per page: the plate under the name, the footer line,
 * and what the gate says when it opens. Everything visual is login.css.
 */
export function GatehouseStage({
  theme,
  plate,
  foot,
  shaking = false,
  gate,
  children,
}: {
  theme: LoginTheme;
  /** The small label under the school name ("New password", "Reset"). */
  plate: string;
  foot: ReactNode;
  shaking?: boolean;
  /** Present → the gate-open moment, shown while `open` is true. */
  gate?: { open: boolean; title: string; sub: string };
  children: ReactNode;
}) {
  return (
    <div
      className="gh-stage"
      style={{ '--gh-p': theme.primary, '--gh-s': theme.secondary, '--gh-font': theme.fontStack } as React.CSSProperties}
    >
      <span className="gh-blob gh-b1" aria-hidden="true" />
      <span className="gh-blob gh-b2" aria-hidden="true" />
      <span className="gh-ring gh-r1" aria-hidden="true" />
      <span className="gh-ring gh-r2" aria-hidden="true" />
      <span className="gh-mote" style={{ left: '10%', top: '72%', animationDuration: '9s' }} aria-hidden="true" />
      <span className="gh-mote gh-mote-s" style={{ left: '22%', top: '88%', animationDuration: '12s', animationDelay: '2.5s' }} aria-hidden="true" />
      <span className="gh-mote" style={{ left: '48%', top: '94%', animationDuration: '10s', animationDelay: '5s' }} aria-hidden="true" />
      <span className="gh-mote gh-mote-s" style={{ left: '71%', top: '85%', animationDuration: '13s', animationDelay: '1.2s' }} aria-hidden="true" />
      <span className="gh-mote" style={{ left: '86%', top: '70%', animationDuration: '11s', animationDelay: '3.8s' }} aria-hidden="true" />

      <div className={`gh-shell${shaking ? ' gh-shake' : ''}`}>
        {/* ── Identity panel: the school half, same as sign-in ── */}
        <div className="gh-left">
          <div className="gh-left-top">
            <span className="gh-crest">
              <Crest theme={theme} />
            </span>
            <h1 className="gh-name" style={{ fontFamily: 'var(--gh-font)' }}>
              {theme.schoolName}
            </h1>
            <p className="gh-tagline">{theme.tagline}</p>
            <div className="gh-plate">
              <span className="gh-plate-text">{plate}</span>
            </div>
          </div>
          <span className="gh-watermark" aria-hidden="true">
            <Crest theme={theme} size={150} />
          </span>
          <p className="gh-foot">{foot}</p>
        </div>

        {/* ── Form panel ── */}
        <div className="gh-right">{children}</div>

        {gate && (
          <div className={`gh-gate${gate.open ? ' gh-gate-on' : ''}`} aria-hidden={!gate.open}>
            <div className="gh-gate-inner">
              <span className="gh-gate-pulse" aria-hidden="true" />
              <Crest theme={theme} size={46} />
              <p className="gh-gate-title" style={{ fontFamily: 'var(--gh-font)' }}>
                {gate.title}
              </p>
              <p className="gh-gate-sub">{gate.sub}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
