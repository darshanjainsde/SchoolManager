'use client';
import { useRef, type ReactNode } from 'react';
import Link from 'next/link';
import { Menu, X, type LucideIcon } from 'lucide-react';
import { SckoolsLogo } from '@/components/brand/sckools-logo';

export interface MobileNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/** Moves focus back inside the drawer when Tab would otherwise leave it. */
function trapFocus(e: React.KeyboardEvent<HTMLDivElement>, container: HTMLDivElement | null) {
  if (e.key !== 'Tab' || !container) return;
  const focusables = container.querySelectorAll<HTMLElement>('a[href], button:not([disabled])');
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

/**
 * The phone's way into the sections the sidebar holds on a laptop.
 *
 * The teacher and admin shells already had a hamburger and a drawer; the
 * student and staff shells had a horizontally-scrolling tab strip instead.
 * Scrolling tabs are a legitimate pattern, but with nine sections on a 390px
 * screen only two or three are ever on screen and nothing signals that the
 * rest exist — so those portals read as having no navigation at all once you
 * leave the home page. One drawer, four shells.
 *
 * The button lives in the flow (it is not fixed), and the panel mounts ONLY
 * while open so it is never tab-reachable when closed — a hidden-but-focusable
 * menu is a keyboard trap that sighted users never see.
 */
export function MobileNavButton({
  onOpen,
  open,
  controls,
}: {
  onOpen: () => void;
  open: boolean;
  controls: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Open menu"
      aria-expanded={open}
      aria-controls={controls}
      className="sk-mobile-menu-btn"
    >
      <Menu className="h-6 w-6" aria-hidden="true" />
    </button>
  );
}

export function MobileNavDrawer({
  id,
  open,
  onClose,
  title,
  host,
  sectionLabel,
  items,
  isActive,
  foot,
}: {
  id: string;
  open: boolean;
  onClose: () => void;
  /** e.g. "Student portal" — the same words the sidebar shows on a laptop. */
  title: string;
  host?: string;
  /** The uppercase divider above the list, e.g. "Classroom". */
  sectionLabel: string;
  items: readonly MobileNavItem[];
  isActive: (href: string) => boolean;
  /** Profile link, theme toggle, sign out — whatever the shell keeps at the bottom. */
  foot?: ReactNode;
}): React.JSX.Element | null {
  const panelRef = useRef<HTMLDivElement>(null);
  if (!open) return null;

  return (
    <>
      <button type="button" aria-label="Close menu" onClick={onClose} className="sk-drawer-scrim" />
      <div
        id={id}
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        tabIndex={-1}
        onKeyDown={(e) => trapFocus(e, panelRef.current)}
        className="sk-drawer-panel"
      >
        <div
          className="sk-side-brand"
          style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}
        >
          <div>
            <SckoolsLogo variant="symbol" size={30} />
            <div className="role">{title}</div>
            {host && <div className="sub">{host.split(':')[0]}</div>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close menu" className="sk-drawer-close">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <div className="sk-navlabel">{sectionLabel}</div>
        <nav className="flex flex-col gap-[3px]">
          {items.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              onClick={onClose}
              className="sk-nav"
              data-active={isActive(href)}
            >
              <Icon className="ic" aria-hidden="true" /> {label}
            </Link>
          ))}
        </nav>
        {foot && <div className="sk-side-foot">{foot}</div>}
      </div>
    </>
  );
}
