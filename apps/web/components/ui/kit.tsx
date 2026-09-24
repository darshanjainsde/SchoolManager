'use client';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Z } from '@/lib/z-layers';
import { useFocusTrap } from './use-focus-trap';

/**
 * THE CONSOLE KIT — the primitives every screen builds from.
 *
 * It exists because the same four UI defects kept shipping, and each one is a
 * hand-rolled layout doing what a primitive should have done:
 *
 *  · RAGGED COLUMNS. `.sk-row` is a flex row with `.sp { flex: 1 }`, so each
 *    row's trailing controls land wherever that row's text happens to end.
 *    Every list built from it has columns that do not line up. `RowList`
 *    DECLARES the column tracks once and every `Row` inherits them, so
 *    alignment is a property of the list rather than of each row's content.
 *
 *  · AN INPUT THAT OVERFLOWS ITS TRACK. `.sk-input` carries padding and a
 *    border with no `box-sizing`, so `width: 100%` overflows by its own
 *    padding. `Field` sets it, once.
 *
 *  · A HINT INSIDE THE LABEL, which makes it part of the input's accessible
 *    name ("Bank account number9 to 18 digits…"). `Field` wires it through
 *    `aria-describedby`.
 *
 *  · AN OVERLAY THAT LOSES THE THEME OR THE VIEWPORT. Rendered inline it is
 *    re-anchored by `.sk-anim`'s transform; portalled to bare `<body>` every
 *    `--sk-*` token resolves to nothing, because they are scoped to `.skosx`.
 *    `Overlay` does both correctly and pins its action bar.
 *
 * Guards in `app/sk-kit.test.ts` fail the build when a screen hand-rolls one
 * of these instead. Styles are the `sk-kit` block in `app/sk-theme.css`.
 */

/* ── lists ──────────────────────────────────────────────────────────────── */

/**
 * A list of rows whose columns line up.
 *
 * `columns` is a grid track list — `'1fr auto'`, `'1fr 8rem auto'`. Give the
 * flexible column `1fr` and fixed ones `auto` or an explicit width; the tracks
 * are shared by every row, so a long name in row 3 can never push row 3's
 * buttons out of line with row 1's.
 *
 * Below `stackAt` (560px by default) the rows collapse to one column, because
 * three columns on a phone is three columns of nothing.
 */
export function RowList({ columns, children, className = '', label }: {
  columns: string;
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <div
      className={`sk-rowlist ${className}`.trim()}
      style={{ '--sk-row-cols': columns } as CSSProperties}
      role={label ? 'list' : undefined}
      aria-label={label}
    >
      {children}
    </div>
  );
}

/** One row. Its columns come from the `RowList` above it — never from itself. */
export function Row({ children, className = '', onClick, testId, current }: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  testId?: string;
  current?: boolean;
}) {
  const props = {
    className: `sk-rowline ${className}`.trim(),
    'data-testid': testId,
    'aria-current': current ? ('true' as const) : undefined,
  };
  if (!onClick) return <div {...props} role="listitem">{children}</div>;
  return <button type="button" {...props} data-clickable onClick={onClick}>{children}</button>;
}

/**
 * One column of a row. `align="end"` right-aligns on a wide screen and goes
 * back to the left when the row stacks on a phone — a right-aligned figure
 * under a left-aligned name reads as a mistake.
 */
export function Cell({ children, align, className = '' }: {
  children?: ReactNode;
  align?: 'end';
  className?: string;
}) {
  return <div className={`sk-rowcell ${className}`.trim()} data-align={align}>{children}</div>;
}

/** The name-and-subtitle pair every row has. Both are block, whatever the element. */
export function RowTitle({ title, sub, tone }: { title: ReactNode; sub?: ReactNode; tone?: 'warn' }) {
  return (
    <>
      <span className="sk-rowtitle">{title}</span>
      {sub ? <span className="sk-rowsub" data-tone={tone}>{sub}</span> : null}
    </>
  );
}

/** A group heading inside a list — "Not on pay yet", "TGT". */
export function RowGroup({ title, caption, children }: { title: ReactNode; caption?: ReactNode; children?: ReactNode }) {
  return (
    <div className="sk-rowgroup">
      <span className="t">{title}</span>
      {caption ? <span className="c">{caption}</span> : null}
      {children}
    </div>
  );
}

/* ── forms ──────────────────────────────────────────────────────────────── */

/**
 * A labelled control.
 *
 * The label is a real `<label for>`, the hint is `aria-describedby` rather
 * than part of the name, and the control is `box-sizing: border-box` so it
 * cannot overflow its grid track. `invalid` colours the border AND sets
 * `aria-invalid`, because a red line alone says nothing to a screen reader.
 */
export function Field({ id, label, hint, invalid, children }: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  invalid?: boolean;
  children: (p: { id: string; 'aria-describedby': string | undefined; 'aria-invalid': true | undefined }) => ReactNode;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="sk-field" data-invalid={invalid || undefined}>
      <label className="sk-lab" htmlFor={id}>{label}</label>
      {children({ id, 'aria-describedby': hintId, 'aria-invalid': invalid || undefined })}
      {hint ? <span id={hintId} className="sk-fieldhint">{hint}</span> : null}
    </div>
  );
}

/** A row of fields that wraps rather than squeezing. */
export function FieldRow({ children, min = 200 }: { children: ReactNode; min?: number }) {
  return (
    <div className="sk-fieldrow" style={{ '--sk-field-min': `${min}px` } as CSSProperties}>
      {children}
    </div>
  );
}

/* ── figures ────────────────────────────────────────────────────────────── */

/**
 * Figures shown side by side to be compared.
 *
 * Fixed columns, never `auto-fit`: an auto-fit floor strands the last tile on
 * a row of its own at 390px. The FIGURE shrinks instead, so the set always
 * reads as one row — and they all carry the same unit, because "₹12.81 L"
 * beside "₹10,860" makes the reader convert before they can compare.
 */
export function Figures({ children, count }: { children: ReactNode; count: 2 | 3 | 4 }) {
  return <div className="sk-figures" data-count={count}>{children}</div>;
}

export function Figure({ value, label }: { value: ReactNode; label: ReactNode }) {
  return (
    <div className="sk-figure">
      <span className="v">{value}</span>
      <span className="h">{label}</span>
    </div>
  );
}

/* ── overlays ───────────────────────────────────────────────────────────── */

/**
 * A drawer or dialog.
 *
 * Portalled to `<body>` inside a `.skosx` wrapper at `Z.OVERLAY`: inline it
 * would be re-anchored by any ancestor transform, and on bare `<body>` every
 * design token would resolve to nothing. Focus stays inside, Escape closes,
 * the page behind does not scroll, and `footer` is pinned so the primary
 * action never scrolls out of reach.
 */
export function Overlay({ title, subtitle, onClose, footer, children, side = 'end' }: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
  /** `end` is a right-hand drawer; `center` is a dialog. */
  side?: 'end' | 'center';
}) {
  const [mounted, setMounted] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => setMounted(true), []);
  useFocusTrap(panel, onClose);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  if (!mounted) return null;

  return createPortal(
    <div
      className="skosx sk-scrim"
      data-side={side}
      style={{ zIndex: Z.OVERLAY }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={panel}
        className="sk-panel"
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
      >
        <div className="sk-panel-head">
          <div style={{ minWidth: 0 }}>
            <div className="t">{title}</div>
            {subtitle ? <div className="s">{subtitle}</div> : null}
          </div>
          <button type="button" className="sk-btn" data-size="sm" onClick={onClose}>Close</button>
        </div>
        <div className="sk-panel-body">{children}</div>
        {footer ? <div className="sk-panel-actions">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

/* ── the small stuff that kept getting hand-rolled ──────────────────────── */

/** Something to read before acting — never a bare paragraph of grey. */
export function Note({ children, tone = 'warn' }: { children: ReactNode; tone?: 'warn' | 'bad' | 'good' }) {
  return <div className="sk-note" data-tone={tone}>{children}</div>;
}

/** A list that shows a slice and says how many more, rather than a wall. */
export function ShowMore({ hidden, onShow, onLess, expanded }: {
  hidden: number; onShow: () => void; onLess?: () => void; expanded?: boolean;
}) {
  if (expanded && onLess) return <button type="button" className="sk-showmore" onClick={onLess}>Show fewer</button>;
  if (hidden <= 0) return null;
  return <button type="button" className="sk-showmore" onClick={onShow}>Show {hidden} more</button>;
}
