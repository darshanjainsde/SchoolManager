'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * THE DRAWER every Pay panel opens in.
 *
 * It exists as one component because three separate bugs came from rolling it
 * inline, and all three are structural rather than cosmetic:
 *
 * 1. PORTAL, not inline. The console's main carries `.sk-anim`, whose
 *    `sk-rise` keyframe animates `transform` on its direct child with
 *    `fill-mode: both`. A transformed ancestor becomes the containing block
 *    for `position: fixed`, so a scrim rendered inside the page tree is
 *    re-anchored to that element: `inset: 0` resolves against the whole tall
 *    page instead of the viewport, the scrim becomes document-height, and
 *    scrolling reveals an endless blank drawer. It looks perfect until the
 *    page is long enough to scroll. Portalling to <body> is the only fix that
 *    does not depend on what some ancestor's stylesheet does later.
 *
 * 2. LOCK THE PAGE BEHIND IT. A modal the page scrolls behind is the same
 *    defect wearing different clothes — the list moves under a fixed panel and
 *    nothing the user does dismisses it.
 *
 * 3. THE PRIMARY ACTION IS ALWAYS VISIBLE. `margin-top: auto` puts the button
 *    at the bottom of the panel, which is below the fold the moment the body
 *    is taller than the screen. That is exactly the defect this whole drawer
 *    was introduced to fix, reappearing one level down. The footer is sticky.
 */
export function Drawer({ title, subtitle, onClose, footer, children }: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  /** The action bar. Pinned to the bottom of the panel, never scrolled away. */
  footer: ReactNode;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Escape closes it, and the page behind it does not scroll while it is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  if (!mounted) return null;

  const label = typeof title === 'string' ? title : undefined;

  return createPortal(
    <div
      className="sk-payscrim"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="sk-paydrawer">
        <div className="sk-paydrawer-head">
          <div style={{ minWidth: 0 }}>
            <div className="t">{title}</div>
            {subtitle ? <div className="s">{subtitle}</div> : null}
          </div>
          <button type="button" className="sk-btn" data-size="sm" onClick={onClose}>Close</button>
        </div>

        <div className="sk-paydrawer-body">{children}</div>

        <div className="sk-paydrawer-actions">{footer}</div>
      </div>
    </div>,
    document.body,
  );
}
