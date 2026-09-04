'use client';
/**
 * The library's own chrome INSIDE whatever shell is hosting it: a pagehead and
 * the section strip. Nothing else — no topbar, no sidebar, no sign-out.
 *
 * Two hosts render it and that is the whole point of the file existing:
 *
 *   /app/library  — the admin console. The sidebar stays put; the library is
 *                   one tab among twenty-one, exactly like Exam Hall.
 *   /library      — the librarian's own portal. She is STAFF/LIBRARIAN, the
 *                   console's role guard would bounce her, and a sidebar full
 *                   of Students/Staff/Settings would be no use to her anyway
 *                   (see `lib/role-routes.ts`). She keeps her topbar and gets
 *                   the identical sections.
 *
 * Before this, `/library` was a fourth sibling PORTAL with a book-spine rail
 * and its own sign-out, so an admin clicking Library in the sidebar had the
 * entire console swapped out from under them — which read as being thrown out
 * of the product, and was patched with a lone "Back to admin" link.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { LIBRARY_SECTIONS, isSectionActive, sectionHref } from './nav-items';

export function LibraryShell({
  base,
  subtitle,
  children,
}: {
  /** `/app/library` or `/library` — the host decides, statically. */
  base: string;
  subtitle: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  return (
    <div className="skosx">
      <header className="sk-pagehead">
        <div>
          <h1>Library</h1>
          <p>{subtitle}</p>
        </div>
      </header>

      <nav className="sk-tabs sk-lib-tabs" aria-label="Library sections">
        {LIBRARY_SECTIONS.map((s) => {
          const href = sectionHref(base, s.seg);
          const active = isSectionActive(pathname, base, href);
          return (
            <Link
              key={s.seg || 'index'}
              href={href}
              className="sk-tab"
              data-active={active}
              aria-current={active ? 'page' : undefined}
            >
              {s.label}
            </Link>
          );
        })}
      </nav>

      {children}
    </div>
  );
}
