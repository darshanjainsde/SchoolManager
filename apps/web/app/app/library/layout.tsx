import type { ReactNode } from 'react';
import { LibraryShell } from './shell';

/**
 * The library, as a tab of the admin console. `app/app/layout.tsx` has already
 * established the session, resolved the tenant from the host and enforced
 * SCHOOL_ADMIN, so there is nothing to guard here — this segment only adds the
 * library's own pagehead and section strip inside the console's `main`.
 *
 * The subtitle is deliberately static. Deriving it from the dashboard payload
 * would fire an extra tenant-scoped query on every one of the six sections,
 * including the five that do not need it.
 */
export default function AppLibraryLayout({ children }: { children: ReactNode }) {
  return (
    <LibraryShell base="/app/library" subtitle="Circulation, the reading hall and fines.">
      {children}
    </LibraryShell>
  );
}
