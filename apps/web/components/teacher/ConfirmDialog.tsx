'use client';
import { useEffect, useRef } from 'react';

export interface ConfirmDialogProps {
  /** Must be unique on the page — wired to the panel's `aria-labelledby`. */
  titleId: string;
  title: React.ReactNode;
  /** The explanatory body — one or more paragraphs. */
  children: React.ReactNode;
  isPending: boolean;
  confirmLabel: string;
  pendingLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A real modal dialog shell shared by every confirm-before-you-act flow in
 * the teacher portal: Tab is trapped inside the panel, Escape closes it, and
 * focus returns to whatever opened it once it unmounts. Lifted out of
 * `RetakeDialog` (Task 4) so the leave-cancel confirmation in the requests
 * queue (Task 5) doesn't reimplement the same focus-trap/Escape logic — the
 * two callers only differ in title, body copy and button labels.
 */
export function ConfirmDialog({
  titleId,
  title,
  children,
  isPending,
  confirmLabel,
  pendingLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: ConfirmDialogProps): React.JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Captured once, on mount — this is whatever had focus right before the
    // dialog opened (normally the trigger, since a click focuses the element
    // it clicks). Restoring it on unmount is what keeps a keyboard user from
    // losing their place once the dialog closes.
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusables = panel?.querySelectorAll<HTMLElement>(FOCUSABLE);
    focusables?.[0]?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
        return;
      }
      if (e.key === 'Tab' && panel) {
        const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    // Capture phase, like the other dialog shells in this app — Escape must
    // close the dialog even if a child stops propagation in the bubble phase.
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      previouslyFocused?.focus();
    };
    // Only re-run if `onCancel` identity changes; the rest of the content
    // never needs to re-arm the trap.
  }, [onCancel]);

  return (
    <div
      className="sk-drawer-scrim"
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div
        ref={panelRef}
        className="sk-card"
        style={{ width: '100%', maxWidth: 440 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="sk-card-h">
          <h3 id={titleId}>{title}</h3>
        </div>
        <div className="sk-card-b">
          {children}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
            <button type="button" className="sk-btn" onClick={onCancel} disabled={isPending}>
              {cancelLabel}
            </button>
            <button
              type="button"
              className="sk-btn"
              data-variant="primary"
              onClick={onConfirm}
              disabled={isPending}
            >
              {isPending ? pendingLabel : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
