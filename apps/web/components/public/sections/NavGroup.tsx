'use client';

import { useRef, useState } from 'react';
import type { NavNode } from './nav-model';

type Group = Extract<NavNode, { kind: 'group' }>;

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
    setOpen(false);
  };

  const rows = [
    ...(node.href ? [{ key: `${node.key}-all`, label: `All of ${node.label}`, href: node.href, hint: null }] : []),
    ...node.children,
  ];

  return (
    <div
      className={inline ? 'ps-submenu-wrap' : 'ps-menu-wrap'}
      onMouseEnter={autoOpen}
      onMouseLeave={inline ? undefined : close}
      onFocus={autoOpen}
      onBlur={(e) => {
        if (inline) return;
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) close();
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || !open) return;
        e.stopPropagation();
        close();
        buttonRef.current?.focus();
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
      {open && (
        <div id={menuId} className={inline ? 'ps-submenu' : 'ps-menu'}>
          {rows.map((row) => (
            <a
              key={row.key}
              href={row.href}
              onClick={onNavigate}
              className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 hover:bg-black/[.04] transition"
            >
              <span className="min-w-0">
                <span className="block text-[13px] font-bold" style={{ color: 'var(--ink)' }}>
                  {row.label}
                </span>
                {row.hint && <span className="block text-[11px] text-slate-400">{row.hint}</span>}
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
