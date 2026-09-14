'use client';
/**
 * The sports desk's own chrome INSIDE whatever shell hosts it: a pagehead and
 * the section strip — the library's `LibraryShell` for the next wing over.
 *
 *   /app/sports — the admin console; the sidebar stays put.
 *   /sports     — the sports teacher's own portal (see app/sports/layout.tsx).
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { isSectionActive, sectionHref, sectionsFor } from './nav-items';

export function SportsShell({ base, subtitle, children }: { base: string; subtitle: string; children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="skosx">
      <header className="sk-pagehead">
        <div>
          <h1>Sports</h1>
          <p>{subtitle}</p>
        </div>
      </header>

      <nav className="sk-tabs sk-sp-tabs" aria-label="Sports sections">
        {sectionsFor(base).map((s) => {
          const href = sectionHref(base, s.seg);
          const active = isSectionActive(pathname, base, href);
          return (
            <Link key={s.seg || 'index'} href={href} className="sk-tab" data-active={active} aria-current={active ? 'page' : undefined}>
              {s.label}
            </Link>
          );
        })}
      </nav>

      {children}
    </div>
  );
}
