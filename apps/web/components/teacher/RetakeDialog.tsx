'use client';
import { useEffect, useRef } from 'react';
import type { ClassDayStatus } from '@skoolos/types';

export interface RetakeDialogProps {
  className: string;
  /** Carries markedBy, present, total for the class+date being retaken. */
  status: ClassDayStatus;
  isPending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const TITLE_ID = 'retake-dialog-title';

/**
 * A real modal dialog, not a div that looks like one: it traps Tab inside the
 * panel, closes on Escape, and hands focus back to whatever opened it once it
 * unmounts. The page only decides *whether* this is mounted (via `retakeOpen`
 * state) — everything else lives here so every state is testable from props
 * alone, with no network or router involved.
 */
export function RetakeDialog({
  className,
  status,
  isPending,
  onConfirm,
  onCancel,
}: RetakeDialogProps): React.JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Captured once, on mount — this is whatever had focus right before the
    // dialog opened (normally the "Re-take attendance" trigger, since a click
    // focuses the element it clicks). Restoring it on unmount is what keeps a
    // keyboard user from losing their place once the dialog closes.
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
    // Capture phase, like the other dialog shells in this app (staff-attendance,
    // teacher drawer) — Escape must close the dialog even if a child stops
    // propagation in the bubble phase.
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      previouslyFocused?.focus();
    };
    // Only re-run if `onCancel` identity changes; `status`/`className` never
    // need to re-arm the trap.
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
        aria-labelledby={TITLE_ID}
      >
        <div className="sk-card-h">
          <h3 id={TITLE_ID}>Re-take attendance for {className}?</h3>
        </div>
        <div className="sk-card-b">
          <p>
            {status.markedBy ? `Taken by ${status.markedBy}` : 'Already taken for this class today'} —{' '}
            {status.present} of {status.total} present.
          </p>
          <p className="sk-muted">
            There is one register per class per day, so re-taking replaces it for every teacher of
            this class. The previous version is kept in the audit log.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
            <button type="button" className="sk-btn" onClick={onCancel} disabled={isPending}>
              Cancel
            </button>
            <button
              type="button"
              className="sk-btn"
              data-variant="primary"
              onClick={onConfirm}
              disabled={isPending}
            >
              {isPending ? 'Retaking…' : 'Yes, re-take attendance'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
