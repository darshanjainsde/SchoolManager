'use client';
import Link from 'next/link';
import type { ComponentType, ReactNode } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { RowList } from './kit';

/**
 * THE HUB PATTERN — the front page of a section (Fees, Reports & Documents,
 * Print Store, Onboarding, Pay).
 *
 * Every hub is the same room as every other console page: full width, the
 * page's own padding and nothing else. Then three rows in a fixed order, so a
 * person who has learnt one desk has learnt them all:
 *
 *   header   title · subtitle UNDER it · one primary action on the right
 *   numbers  `HubKpis`  — four figures, one tone each, a hint under every one
 *   doors    `HubDoors` — where to go from here, one row on a laptop
 *   list     `HubList`  — a live table, so the page is never 60% empty
 *
 * It exists because three hubs drifted three ways at once: boxed to 1024px
 * with a gap on both sides, the subtitle beside the title instead of under
 * it, four doors wrapping 3 + 1, and nothing below them. `app/app/hub-pages.
 * test.ts` fails the build if a hub leaves the pattern again.
 */

export function HubPage({ title, subtitle, action, children }: {
  title: ReactNode;
  subtitle: ReactNode;
  /** The one thing to do from here — a Link or button styled `sk-btn`. */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="sk-hub">
      <header className="sk-pagehead sk-hubhead">
        <div className="sk-hubtitle">
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        {action ? <div className="sk-hubact">{action}</div> : null}
      </header>
      <div className="sk-hubstack">{children}</div>
    </div>
  );
}

/** The numbers row. Four tiles read as one object; give each a tone only when it means something. */
export function HubKpis({ children }: { children: ReactNode }) {
  return <div className="sk-kpis sk-hubkpis">{children}</div>;
}

export function HubKpi({ href, label, value, hint, tone }: {
  href?: string;
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'good' | 'warn' | 'bad';
}) {
  const body = (
    <>
      <div className="lab">{label}</div>
      <div className="n">{value}</div>
      {hint ? <div className="hint">{hint}</div> : null}
    </>
  );
  // `a.sk-kpi:hover` lifts the tile, so a linked figure reads as a door on its own.
  if (href) return <Link href={href} className="sk-kpi" data-tone={tone}>{body}</Link>;
  return <div className="sk-kpi" data-tone={tone}>{body}</div>;
}

/**
 * The doors row. auto-FIT at a 260px floor: with three or four doors in a wide
 * container the row fills the width and its right edge lines up with the
 * tiles above (auto-fill would leave empty tracks); 260 clears a door's text
 * on a wide monitor where every column parks at the minimum.
 */
export function HubDoors({ children }: { children: ReactNode }) {
  return <div className="sk-cardgrid sk-hubdoors">{children}</div>;
}

export function HubDoor({ href, onClick, title, meta, icon: Icon, tint }: {
  href?: string;
  onClick?: () => void;
  title: ReactNode;
  meta: ReactNode;
  icon: ComponentType<{ size?: number; 'aria-hidden'?: boolean | 'true' }>;
  tint: string;
}) {
  const inner = (
    <>
      <span className="av" style={{ background: tint }}><Icon size={20} aria-hidden="true" /></span>
      {/* Blocks, not spans: `.nm`/`.meta` carry no display of their own and
          ran together on one line when written inline. */}
      <span className="sk-hubdoor-text">
        <span className="nm">{title}</span>
        <span className="meta">{meta}</span>
      </span>
      <ArrowUpRight size={16} className="shrink-0" style={{ color: 'var(--sk-ink-3)' }} aria-hidden="true" />
    </>
  );
  if (href) return <Link href={href} className="sk-entity sk-press sk-hubdoor">{inner}</Link>;
  return <button type="button" onClick={onClick} className="sk-entity sk-press sk-hubdoor">{inner}</button>;
}

/**
 * The live list. A card with a title, an optional "All →" and a `RowList`
 * whose columns every row inherits — never a stack of per-row flex boxes.
 * With nothing to show it says so in one line rather than drawing an empty
 * table.
 */
export function HubList({ title, more, columns, label, count, empty, children }: {
  title: ReactNode;
  more?: { href: string; label: string };
  /** Grid tracks shared by every row — `'minmax(0,1.6fr) minmax(0,1fr) auto auto'`. */
  columns: string;
  label: string;
  /** How many rows `children` holds; 0 renders `empty`. */
  count: number;
  empty: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="sk-card sk-hublist" aria-label={label}>
      <div className="sk-card-h sk-hublist-h">
        <h3>{title}</h3>
        {more ? <Link href={more.href} className="sk-hubmore">{more.label} →</Link> : null}
      </div>
      <div className="sk-card-b">
        {count > 0
          ? <RowList columns={columns} label={label}>{children}</RowList>
          : <p className="sk-state" style={{ margin: 0 }}>{empty}</p>}
      </div>
    </section>
  );
}
