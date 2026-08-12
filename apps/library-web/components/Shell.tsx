'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { clearSession, readClaims, readSession, type TokenClaims } from '@/lib/session';

const ROLE_LABEL: Record<TokenClaims['role'], string> = {
  ORG_OWNER: 'Owner',
  LIBRARIAN: 'Librarian',
  ASSISTANT: 'Assistant',
  MEMBER: 'Member',
};

/**
 * Nav is filtered by role for CLARITY, never for security — every one of
 * these routes is enforced server-side, where the authz matrix asserts each
 * role against each endpoint. Hiding a link the API would refuse is a
 * courtesy; relying on it would not be.
 */
const NAV = [
  { group: 'Today', items: [
    { href: '/console', label: 'Dashboard', icon: '◧', roles: ['ORG_OWNER', 'LIBRARIAN', 'ASSISTANT'] },
    { href: '/console/desk', label: 'Circulation desk', icon: '⌗', roles: ['ORG_OWNER', 'LIBRARIAN', 'ASSISTANT'] },
  ]},
  { group: 'Collection', items: [
    { href: '/console/catalogue', label: 'Catalogue', icon: '▤', roles: ['ORG_OWNER', 'LIBRARIAN', 'ASSISTANT', 'MEMBER'] },
  ]},
  { group: 'People', items: [
    { href: '/console/holds', label: 'Holds', icon: '⎘', roles: ['ORG_OWNER', 'LIBRARIAN', 'ASSISTANT'] },
    { href: '/console/overdue', label: 'Overdue', icon: '⚑', roles: ['ORG_OWNER', 'LIBRARIAN', 'ASSISTANT'] },
    { href: '/console/fines', label: 'Fines', icon: '₹', roles: ['ORG_OWNER', 'LIBRARIAN'] },
  ]},
] as const;

export function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [claims, setClaims] = useState<TokenClaims | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const s = readSession();
    if (!s) {
      router.replace('/login');
      return;
    }
    setClaims(readClaims(s.accessToken));
    setChecked(true);
  }, [router]);

  // Render nothing until the session check has run, rather than flashing the
  // shell to someone who is about to be bounced to /login.
  if (!checked) return null;

  const role = claims?.role ?? 'MEMBER';
  const initials = (claims?.sub ?? '?').slice(0, 2).toUpperCase();

  return (
    <div className="lbx-shell">
      <nav className="lbx-rail" aria-label="Library sections">
        <div className="lbx-brand">
          <div className="lbx-tassel" aria-hidden="true">S</div>
          <div>
            <b>Sckools Library</b>
            <span>{ROLE_LABEL[role]}</span>
          </div>
        </div>

        {NAV.map((g) => {
          const items = g.items.filter((i) => (i.roles as readonly string[]).includes(role));
          if (!items.length) return null;
          return (
            <div className="lbx-navgroup" key={g.group}>
              <span className="lbx-lbl">{g.group}</span>
              {items.map((i) => (
                <Link
                  key={i.href}
                  href={i.href}
                  className="lbx-nav"
                  aria-current={pathname === i.href ? 'page' : undefined}
                >
                  <span className="lbx-ico" aria-hidden="true">{i.icon}</span>
                  {i.label}
                </Link>
              ))}
            </div>
          );
        })}

        <div className="lbx-railfoot">
          <div className="lbx-who">
            <div className="lbx-av" aria-hidden="true">{initials}</div>
            <div style={{ minWidth: 0 }}>
              <b>{ROLE_LABEL[role]}</b>
              <span>
                <button
                  className="lbx-btn ghost"
                  style={{ padding: '0 .3rem', fontSize: '.7rem', border: 0 }}
                  onClick={() => { clearSession(); router.replace('/login'); }}
                >
                  Sign out
                </button>
              </span>
            </div>
          </div>
        </div>
      </nav>

      <main className="lbx-main">{children}</main>
    </div>
  );
}
