'use client';
import { useEffect, useRef, type ReactNode } from 'react';

/**
 * The console's modal frame: a scrim, an `.sk-card` dialog, focus moved in,
 * Tab trapped, Escape and a scrim click closing it.
 *
 * Lived as a private copy in the Students and Staff-attendance pages until the
 * Active Roster work needed a third (Mark as left) and a fourth (Remove from
 * this school). One shell, so every dialog traps focus the same way.
 */
export default function DialogShell({
  onClose,
  labelledBy,
  maxWidth = 420,
  children,
}: {
  onClose: () => void;
  labelledBy: string;
  maxWidth?: number;
  children: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    const focusable = el?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    focusable?.[0]?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === 'Tab' && el) {
        const items = Array.from(
          el.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        );
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
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(15, 30, 24, 0.5)',
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={containerRef}
        className="sk-card"
        style={{ width: '100%', maxWidth }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
      >
        {children}
      </div>
    </div>
  );
}
