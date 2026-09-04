'use client';
import { createPortal } from 'react-dom';
import { useHydrated } from '@/lib/use-hydrated';

/**
 * Mounts a print container as a DIRECT child of `<body>`.
 *
 * Both print stylesheets (`press-print.css`, exam-hall's `print.css`) show
 * their sheets with `body.<flag> > #<id>` — direct-child selectors, because
 * during a print EVERY other direct child of body is hidden. A container
 * nested inside the app tree is hidden along with its ancestors and the job
 * prints BLANK PAGES. Not a theory: reproduced with the real exam-hall
 * print.css in headless Chrome — nested renders nothing, portaled renders
 * the sheet (scratchpad eh-nested/eh-direct probe, 2 Sept 2026).
 *
 * Renders only after hydration (`useHydrated`, the codebase's own guard) —
 * `document` does not exist on the server, and a server/client mismatch
 * would cost the whole subtree silently under React 19.
 */
export function BodyPrintPortal({
  id, className, children,
}: {
  id: string; className?: string; children: React.ReactNode;
}) {
  const hydrated = useHydrated();
  if (!hydrated) return null;
  return createPortal(
    <div id={id} className={className} aria-hidden="true">{children}</div>,
    document.body,
  );
}

/** The Press's container — see press-print.css. */
export function PressPrintPortal({ children }: { children: React.ReactNode }) {
  return <BodyPrintPortal id="press-print">{children}</BodyPrintPortal>;
}
