'use client';

import { useEffect, useRef, useState } from 'react';
import type { NavNode } from './nav-model';

type Group = Extract<NavNode, { kind: 'group' }>;

interface RowData {
  key: string;
  label: string;
  href: string;
  hint?: string | null;
}

/** One entry in a menu. `ps-menu-row` is also what arrow-key navigation walks. */
function Row({
  row,
  onNavigate,
  style,
}: {
  row: RowData;
  onNavigate?: () => void;
  style?: React.CSSProperties;
}) {
  return (
    <a href={row.href} onClick={onNavigate} style={style} className="ps-menu-row">
      <span className="min-w-0">
        <span className="ps-menu-row-label">{row.label}</span>
        {row.hint && <span className="ps-menu-row-hint">{row.hint}</span>}
      </span>
      <span className="ps-menu-row-arrow" aria-hidden="true">
        →
      </span>
    </a>
  );
}

/**
 * A nav group: a real button that owns a real menu.
 *
 * It replaces a CSS `:hover` dropdown hung off a link, which a keyboard could
 * not open, a touch device could not reach (the first tap navigated away) and
 * a screen reader was never told about.
 *
 * The control is a button even when the group is itself a page — the page is
 * the first row inside the menu. That is the whole reason a first tap on a
 * phone opens instead of leaving.
 */
export default function NavGroup({
  node,
  className,
  onNavigate,
  inline,
}: {
  node: Group;
  /** Trigger styling, so each bar keeps its own link treatment. */
  className?: string;
  /** Lets the mobile drawer close itself when a row is followed. */
  onNavigate?: () => void;
  /** Drawer variant: the rows expand in place instead of floating over the page. */
  inline?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = `ps-menu-${node.key}`;
  // Hover and focus open the menu BEFORE the click ever lands, so a plain
  // toggle would make a mouse click dismiss the menu the same gesture opened.
  // The first click after an automatic open confirms it instead.
  const autoOpenedRef = useRef(false);

  // Hover and focus open the menu on a pointer device. In the drawer they must
  // NOT: it opens by moving focus to its first control, which would expand
  // whichever group happens to be first before the visitor has chosen anything.
  const autoOpen = inline
    ? undefined
    : () => {
        setOpen((prev) => {
          if (!prev) autoOpenedRef.current = true;
          return true;
        });
      };

  const close = () => {
    autoOpenedRef.current = false;
    cancelClose();
    setOpen(false);
  };

  /**
   * Leaving does not close immediately.
   *
   * A pointer travelling from the tab to the third row crosses the corner of
   * the panel and, for a few pixels, is over neither. Closing on that instant
   * is the single most common reason a hover menu feels broken — the thing you
   * were reaching for vanishes under your hand. So a departure starts a timer
   * instead, and coming back cancels it.
   *
   * The delay is longer when the pointer left DOWNWARD, i.e. toward the panel:
   * that is somebody on their way in, and they get the benefit of the doubt.
   * Leaving upward or sideways is somebody moving on, and closes briskly.
   */
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const closeAfterGrace = (e: React.MouseEvent<HTMLDivElement>) => {
    cancelClose();
    const rect = wrapRef.current?.getBoundingClientRect();
    const headingForPanel = rect ? e.clientY >= rect.top : false;
    closeTimer.current = setTimeout(() => setOpen(false), headingForPanel ? 400 : 120);
  };

  // A timer that outlives its component would call setState on nothing.
  useEffect(() => cancelClose, []);

  const rowLinks = (): HTMLAnchorElement[] =>
    Array.from(wrapRef.current?.querySelectorAll<HTMLAnchorElement>('.ps-menu-row, .ps-submenu a') ?? []);
  const focusRow = (i: number) => rowLinks()[i]?.focus();

  const rows = [
    ...(node.href ? [{ key: `${node.key}-all`, label: `All of ${node.label}`, href: node.href, hint: null }] : []),
    ...node.children,
  ];

  return (
    <div
      ref={wrapRef}
      className={inline ? 'ps-submenu-wrap' : 'ps-menu-wrap'}
      onMouseEnter={
        inline
          ? undefined
          : () => {
              cancelClose();
              autoOpen?.();
            }
      }
      onMouseLeave={inline ? undefined : closeAfterGrace}
      onFocus={autoOpen}
      onBlur={(e) => {
        if (inline) return;
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) close();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          close();
          buttonRef.current?.focus();
          return;
        }
        // Arrow keys walk the rows. Without them the only way through a menu is
        // Tab, which leaves it and carries on into the rest of the bar.
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        if (!open) {
          setOpen(true);
          autoOpenedRef.current = false;
          // The rows do not exist until the next paint.
          requestAnimationFrame(() => focusRow(0));
          return;
        }
        const links = rowLinks();
        const here = links.indexOf(document.activeElement as HTMLAnchorElement);
        if (e.key === 'ArrowDown') {
          focusRow(here < 0 ? 0 : Math.min(here + 1, links.length - 1));
        } else if (here <= 0) {
          // Past the top is the tab that opened it — never nothing.
          buttonRef.current?.focus();
        } else {
          focusRow(here - 1);
        }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => {
          if (open && autoOpenedRef.current) {
            autoOpenedRef.current = false;
            return;
          }
          setOpen((o) => !o);
        }}
        className={className}
      >
        {node.label} <span className="text-[10px] opacity-60" aria-hidden="true">▾</span>
      </button>
      {open &&
        (inline ? (
          <div id={menuId} className="ps-submenu">
            {rows.map((row) => (
              <Row key={row.key} row={row} onNavigate={onNavigate} />
            ))}
          </div>
        ) : (
          /* Two elements, not one. The OUTER is the hit area and starts flush
             against the tab — its own padding is what puts the visible card
             10px lower, so the gap a pointer crosses is inside the menu rather
             than between it and the tab. That bridge is what stops the panel
             shutting under the cursor. */
          <div id={menuId} className="ps-menu">
            <div className="ps-menu-card">
              {rows.map((row, i) => (
                <Row
                  key={row.key}
                  row={row}
                  onNavigate={onNavigate}
                  /* Rows arrive just behind the panel, in reading order. The
                     delay is a custom property so one CSS rule can drop the
                     whole stagger under reduced motion. */
                  style={{ '--i': i } as React.CSSProperties}
                />
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}
