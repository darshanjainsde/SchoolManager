'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuthStore } from '@/lib/auth-store';
import { useHydrated } from '@/lib/use-hydrated';
import { LogOut, Menu, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { SckoolsLogo } from '@/components/brand/sckools-logo';

/**
 * Owner-portal shell. Two responsibilities:
 *   1. Redirect to /platform/login when there is no platform refresh token.
 *   2. Render the sidebar + main area around every /platform/* page.
 *
 * Logout is purely client-side — the old /platform/auth/logout endpoint no
 * longer exists. We just clear the auth store and redirect.
 */

const NAV_ITEMS = [
  { href: '/platform', label: 'Dashboard', emoji: '📊' },
  { href: '/platform/scale', label: 'Scale', emoji: '📈' },
  { href: '/platform/schools', label: 'Schools', emoji: '🏫' },
  { href: '/platform/onboard', label: 'Add School', emoji: '➕' },
  { href: '/platform/connect', label: 'Connect', emoji: '🔗' },
];

/** Moves focus back inside the drawer when Tab would otherwise leave it. */
function trapFocus(e: React.KeyboardEvent<HTMLDivElement>, container: HTMLDivElement | null) {
  if (e.key !== 'Tab' || !container) return;
  const focusables = container.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled])',
  );
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

function OwnerNavLink({
  href,
  label,
  emoji,
  pathname,
  onNavigate,
}: {
  href: string;
  label: string;
  emoji: string;
  pathname: string;
  onNavigate?: () => void;
}) {
  const active = pathname === href || (href !== '/platform' && pathname.startsWith(href));
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={cn(
        'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm',
        active ? 'bg-indigo-100 text-indigo-700 font-semibold' : 'text-slate-300 hover:bg-white/5',
      )}
    >
      <span>{emoji}</span>
      {label}
    </Link>
  );
}

export default function PlatformLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const hydrated = useHydrated();
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const audience = useAuthStore((s) => s.audience);
  const clear = useAuthStore((s) => s.clear);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerPanelRef = useRef<HTMLDivElement>(null);

  const isLogin = pathname === '/platform/login';

  useEffect(() => {
    if (hydrated && !isLogin && (!refreshToken || audience !== 'platform')) {
      router.replace('/platform/login');
    }
  }, [hydrated, isLogin, refreshToken, audience, router]);

  // Close the mobile drawer whenever navigation happens.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Lock body scroll while the drawer is open.
  useEffect(() => {
    if (!drawerOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [drawerOpen]);

  // Close on Escape.
  useEffect(() => {
    if (!drawerOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setDrawerOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

  // Move focus into the drawer once it mounts.
  useEffect(() => {
    if (drawerOpen) drawerPanelRef.current?.focus();
  }, [drawerOpen]);

  // Render login page without sidebar/guard wrapper
  if (isLogin) return <>{children}</>;
  // Until hydrated, render nothing so the first client paint matches the server.
  if (!hydrated) return null;
  if (!refreshToken) return null;

  function handleLogout() {
    // Client-side only logout — no server endpoint exists yet
    clear();
    router.replace('/platform/login');
  }

  return (
    <div className="flex min-h-screen flex-col sm:flex-row">
      {/* Mobile top bar — hidden at sm and above, where the sidebar takes over. */}
      <div className="flex items-center justify-between bg-slate-900 px-4 py-2.5 sm:hidden">
        <div className="flex items-center gap-2">
          <SckoolsLogo theme="dark" size={24} />
          <span className="text-[10px] bg-indigo-600 text-white px-2 py-0.5 rounded-full font-semibold">
            OWNER
          </span>
        </div>
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open menu"
          aria-expanded={drawerOpen}
          aria-controls="platform-mobile-drawer"
          className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-300 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-400"
        >
          <Menu className="h-6 w-6" aria-hidden="true" />
        </button>
      </div>

      {/* Mobile drawer — mounted only while open, so it's never tab-reachable when closed. */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 sm:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 h-full w-full bg-black/50"
          />
          <div
            id="platform-mobile-drawer"
            ref={drawerPanelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            tabIndex={-1}
            onKeyDown={(e) => trapFocus(e, drawerPanelRef.current)}
            className="sk-mobile-drawer relative flex h-full w-[260px] max-w-[80vw] flex-col bg-slate-900 text-slate-300 shadow-xl outline-none"
          >
            <div className="flex items-center justify-between gap-2 p-5">
              <div className="flex items-center gap-2">
                <SckoolsLogo theme="dark" size={28} />
                <span className="text-[10px] bg-indigo-600 text-white px-2 py-0.5 rounded-full font-semibold">
                  OWNER
                </span>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close menu"
                className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-300 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-400"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <nav className="px-3 space-y-1 mt-2 text-sm flex-1 overflow-y-auto">
              {NAV_ITEMS.map((item) => (
                <OwnerNavLink key={item.href} {...item} pathname={pathname} onNavigate={() => setDrawerOpen(false)} />
              ))}
            </nav>

            <div className="border-t border-white/10 p-4">
              <button
                onClick={handleLogout}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-white/5"
              >
                <LogOut className="h-4 w-4" /> Log out
              </button>
            </div>
          </div>
          <style jsx>{`
            .sk-mobile-drawer {
              animation: sk-drawer-in 0.22s ease-out both;
            }
            @keyframes sk-drawer-in {
              from {
                transform: translateX(-100%);
              }
              to {
                transform: translateX(0);
              }
            }
            @media (prefers-reduced-motion: reduce) {
              .sk-mobile-drawer {
                animation: none;
              }
            }
          `}</style>
        </div>
      )}

      {/* Sidebar */}
      <aside className="hidden w-60 flex-col bg-slate-900 text-slate-300 sm:flex shrink-0">
        {/* Logo / brand */}
        <div className="flex items-center gap-2 p-5">
          <SckoolsLogo theme="dark" size={30} />
          <span className="ml-auto text-[10px] bg-indigo-600 text-white px-2 py-0.5 rounded-full font-semibold">
            OWNER
          </span>
        </div>

        {/* Nav */}
        <nav className="px-3 space-y-1 mt-2 text-sm flex-1">
          {NAV_ITEMS.map((item) => (
            <OwnerNavLink key={item.href} {...item} pathname={pathname} />
          ))}
        </nav>

        {/* Logout */}
        <div className="mt-auto border-t border-white/10 p-4">
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-white/5"
          >
            <LogOut className="h-4 w-4" /> Log out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="min-w-0 flex-1 overflow-auto overflow-x-hidden bg-slate-100">
        {children}
      </main>
    </div>
  );
}
