'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Z } from '@/lib/z-layers';
import { useFocusTrap } from '@/components/ui/use-focus-trap';

/**
 * THE DRAWER every Pay panel opens in.
 *
 * Built on the console's existing overlay pattern — `order-drawer.tsx`,
 * `record-payment-dialog.tsx` and the Fees setup dialog all do exactly this —
 * after one release where it was not, and shipped see-through:
 *
 * 1. PORTAL TO <body>, INSIDE A `.skosx` WRAPPER. The console main carries
 *    `.sk-anim`, whose keyframe animates `transform` on its child; a
 *    transformed ancestor becomes the containing block for `position: fixed`,
 *    so an inline scrim sizes itself to the tall page instead of the viewport.
 *    Hence the portal. But every `--sk-*` token is declared on `.skosx`, never
 *    on `:root`, so a portal that lands on bare <body> resolves every token to
 *    nothing — transparent panel, chrome-less buttons. The wrapper carries the
 *    theme across. Both traps are named in apps/web/app/app/fees/setup/page.tsx.
 *
 * 2. `Z.OVERLAY`, from the one stacking ladder, so it can never end up under
 *    the command bar the way "Record a payment" once did.
 *
 * 3. FOCUS STAYS INSIDE, Escape closes, the page behind does not scroll.
 *
 * 4. THE ACTION BAR IS PINNED. `margin-top: auto` put it at the bottom of the
 *    content — below the fold once the form was taller than the panel, which
 *    is the very defect this drawer exists to fix. The body scrolls; the head
 *    and the footer do not.
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
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => setMounted(true), []);
  useFocusTrap(panel, onClose);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  if (!mounted) return null;

  const label = typeof title === 'string' ? title : undefined;

  return createPortal(
    <div className="skosx sk-payscrim" style={{ zIndex: Z.OVERLAY }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={panel} className="sk-paydrawer" role="dialog" aria-modal="true" aria-label={label}>
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
