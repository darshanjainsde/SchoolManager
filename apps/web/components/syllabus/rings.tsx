import type { ReactNode } from 'react';

/**
 * Two concentric rings, nothing more. Each ring means one thing and is
 * named in the legend; colour alone never carries the fact (dataviz rule).
 *   - management: outer green = taught, inner indigo = expected by today
 *   - student:    outer green = taught, inner blue = revised by me
 * Numbers beside the rings are set in ink tokens, never the ring colour.
 */
export interface RingSpec {
  pct: number;
  /** A CSS colour, normally `var(--sk-…)`. */
  color: string;
  label: string;
}

export function Rings({ outer, inner, size = 96, stroke = 10, children, testId }: { outer: RingSpec; inner: RingSpec; size?: number; stroke?: number; children?: ReactNode; testId?: string }) {
  const c = size / 2;
  const rOut = c - stroke / 2;
  const rIn = rOut - stroke - 3;
  const arc = (r: number, pct: number) => {
    const len = 2 * Math.PI * r;
    const clamped = Math.max(0, Math.min(100, pct));
    return { strokeDasharray: `${(len * clamped) / 100} ${len}` };
  };
  const label = `${outer.label} ${outer.pct}%, ${inner.label} ${inner.pct}%`;
  return (
    <div className="sk-syl-rings" style={{ width: size, height: size }} data-testid={testId}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={label}>
        <circle className="sk-syl-track" cx={c} cy={c} r={rOut} strokeWidth={stroke} />
        <circle className="sk-syl-track" cx={c} cy={c} r={rIn} strokeWidth={stroke} />
        <circle className="sk-syl-arc" cx={c} cy={c} r={rOut} strokeWidth={stroke} stroke={outer.color} style={arc(rOut, outer.pct)} data-ring="outer" />
        <circle className="sk-syl-arc" cx={c} cy={c} r={rIn} strokeWidth={stroke} stroke={inner.color} style={arc(rIn, inner.pct)} data-ring="inner" />
      </svg>
      {children ? <div className="sk-syl-rings-centre">{children}</div> : null}
    </div>
  );
}

export function RingLegend({ outer, inner }: { outer: RingSpec; inner: RingSpec }) {
  return (
    <dl className="sk-syl-legend">
      {[outer, inner].map((r) => (
        <div key={r.label}>
          <dt><i style={{ background: r.color }} aria-hidden="true" />{r.label}</dt>
          <dd>{r.pct}%</dd>
        </div>
      ))}
    </dl>
  );
}

export const TAUGHT_COLOR = 'var(--sk-good)';
export const EXPECTED_COLOR = 'var(--sk-brand)';
export const REVISED_COLOR = 'var(--sk-t1)';

/** Taught vs expected-by-today: the pair teachers and the office read. */
export function PaceRings({ pct, expectedPct, size, stroke, testId }: { pct: number; expectedPct: number; size?: number; stroke?: number; testId?: string }) {
  return (
    <Rings outer={{ pct, color: TAUGHT_COLOR, label: 'Taught' }} inner={{ pct: expectedPct, color: EXPECTED_COLOR, label: 'Expected by today' }} size={size} stroke={stroke} testId={testId}>
      <b>{pct}%</b>
    </Rings>
  );
}

/** Taught vs revised-by-me: the pair a child reads. */
export function StudyRings({ pct, revisedPct, size, stroke, testId }: { pct: number; revisedPct: number; size?: number; stroke?: number; testId?: string }) {
  return (
    <Rings outer={{ pct, color: TAUGHT_COLOR, label: 'Taught' }} inner={{ pct: revisedPct, color: REVISED_COLOR, label: 'Revised by me' }} size={size} stroke={stroke} testId={testId}>
      <b>{pct}%</b>
    </Rings>
  );
}
