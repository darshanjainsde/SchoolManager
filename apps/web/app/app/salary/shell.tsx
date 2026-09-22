'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { SALARY_SECTIONS, isSectionActive, sectionHref } from './nav-items';

export function SalaryShell({ base, subtitle, children }: { base: string; subtitle: string; children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="skosx">
      <header className="sk-pagehead">
        <div>
          <h1>Salary</h1>
          <p>{subtitle}</p>
        </div>
      </header>
      <nav className="sk-tabs" aria-label="Salary sections">
        {SALARY_SECTIONS.map((s) => {
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
