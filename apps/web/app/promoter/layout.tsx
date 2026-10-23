'use client';
import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Banknote, Handshake, LayoutDashboard, LogOut, Share2, UserRound } from 'lucide-react';
import { SckoolsLogo } from '@/components/brand/sckools-logo';
import { getPromoterToken, setPromoterToken } from '@/lib/promoter-session';
import { usePromoterMe } from '@/components/promoter/use-me';
import '../sk-theme.css';

const TABS = [
  { href: '/promoter', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/promoter/referrals', label: 'My referrals', icon: Handshake },
  { href: '/promoter/payouts', label: 'Payouts', icon: Banknote },
  { href: '/promoter/share', label: 'Share', icon: Share2 },
  { href: '/promoter/profile', label: 'Profile', icon: UserRound },
];

/**
 * Refer & Earn portal shell: the console's topbar-and-tabs recipe (the staff
 * portal's), in `.sk-*`. No session → the door on /earn. A suspended account
 * still opens, read-only, with the reason on every page.
 */
export default function PromoterLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!getPromoterToken()) router.replace('/earn#signin');
    else setReady(true);
  }, [router]);
  const me = usePromoterMe();
  const isActive = (href: string) => (href === '/promoter' ? pathname === '/promoter' : pathname === href || pathname.startsWith(href + '/'));

  if (!ready) return null;
  return (
    <div className="skosx sk-shell">
      <header className="sk-topbar">
        <div className="sk-topbar-inner">
          <SckoolsLogo variant="symbol" size={30} />
          <div className="sk-who">
            <div className="n">Refer &amp; earn</div>
            <div className="s">{me.data ? `${me.data.name} · ${me.data.code}` : 'Promoter account'}</div>
          </div>
          <div style={{ flex: 1 }} />
          <button
            className="sk-signout"
            onClick={() => { setPromoterToken(null); router.replace('/earn'); }}
          >
            <LogOut className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
        <nav className="sk-tabs" aria-label="Sections">
          {TABS.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className="sk-tab" data-active={isActive(href)}>
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="sk-main">
        {me.data?.status === 'SUSPENDED' && (
          <div className="sk-note" data-tone="bad" role="status">
            <b>Your account is paused.</b> {me.data.statusReason || 'Write to admin@sckools.com if you think this is a mistake.'} Rewards already earned are still paid.
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
