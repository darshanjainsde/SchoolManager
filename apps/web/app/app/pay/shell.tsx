'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Play } from 'lucide-react';
import { PAY_SECTIONS, isSectionActive, sectionHref } from './nav-items';

export function PayShell({ base, subtitle, children }: { base: string; subtitle: string; children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="skosx">
      <header className="sk-pagehead">
        <div>
          <h1>Pay</h1>
          <p>{subtitle}</p>
        </div>
      </header>
      {/* Plain `.sk-tabs`: a page strip, left-aligned with the pagehead above
          and the cards below. The 68rem centring is the TOPBAR's, and a page
          that borrows it draws the strip floating to the right (sk-responsive
          guards this). */}
      <nav className="sk-tabs" aria-label="Pay sections">
        {PAY_SECTIONS.map((s) => {
          const href = sectionHref(base, s.seg);
          const active = isSectionActive(pathname, base, href);
          return (
            <Link key={s.seg || 'index'} href={href} className="sk-tab" data-active={active} aria-current={active ? 'page' : undefined}>
              {s.label}
            </Link>
          );
        })}
        {/* The guide, reachable from EVERY tab — it lived at the bottom of one
            screen and nobody knew it was there. Opens on the home, inline. */}
        <Link href={`${base}?guide=1`} className="sk-tab sk-tab-guide" data-active={false}>
          <Play size={12} fill="currentColor" aria-hidden="true" /> How it works
        </Link>
      </nav>
      {children}
    </div>
  );
}
