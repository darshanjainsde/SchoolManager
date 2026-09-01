'use client';
import { createPortal } from 'react-dom';
import { useHydrated } from '@/lib/use-hydrated';

/**
 * Mounts the print container as a DIRECT child of `<body>`.
 *
 * `press-print.css` shows the sheets with `body.press-printing > #press-print`
 * — a direct-child selector, because during a print EVERY other direct child
 * of body is hidden. A container nested inside the app tree would be hidden
 * along with its ancestors and the job would print blank pages. (Exam Hall's
 * `#eh-print` sits inline in its page tree against the same selector shape —
 * flagged for a staging print check.)
 *
 * The portal renders only after hydration (`useHydrated`, the codebase's own
 * guard) — `document` does not exist on the server, and a server/client
 * mismatch here would cost the whole subtree silently under React 19.
 */
export function PressPrintPortal({ children }: { children: React.ReactNode }) {
  const hydrated = useHydrated();
  if (!hydrated) return null;
  return createPortal(
    <div id="press-print" aria-hidden="true">{children}</div>,
    document.body,
  );
}
