'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useAuthStore } from '@/lib/auth-store';
import { LogOut } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Owner-portal shell. Two responsibilities:
 *   1. Redirect to /platform/login when there is no platform refresh token.
 *   2. Render the sidebar + main area around every /platform/* page.
 *
 * Logout is purely client-side — the old /platform/auth/logout endpoint no
 * longer exists. We just clear the auth store and redirect.
 */
export default function PlatformLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const audience = useAuthStore((s) => s.audience);
  const clear = useAuthStore((s) => s.clear);

  const isLogin = pathname === '/platform/login';

  useEffect(() => {
    if (!isLogin && (!refreshToken || audience !== 'platform')) {
      router.replace('/platform/login');
    }
  }, [isLogin, refreshToken, audience, router]);

  // Render login page without sidebar/guard wrapper
  if (isLogin) return <>{children}</>;
  if (!refreshToken) return null;

  const items = [
    { href: '/platform', label: 'Dashboard', emoji: '📊' },
    { href: '/platform/schools', label: 'Schools', emoji: '🏫' },
    { href: '/platform/onboard', label: 'Add School', emoji: '➕' },
  ];

  function handleLogout() {
    // Client-side only logout — no server endpoint exists yet
    clear();
    router.replace('/platform/login');
  }

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="hidden w-60 flex-col bg-slate-900 text-slate-300 sm:flex shrink-0">
        {/* Logo / brand */}
        <div className="flex items-center gap-2 p-5 text-white font-extrabold text-lg">
          <span className="h-8 w-8 rounded-lg bg-indigo-600 grid place-items-center text-sm font-bold">
            S
          </span>
          <span>SkoolOS</span>
          <span className="ml-auto text-[10px] bg-indigo-600 text-white px-2 py-0.5 rounded-full font-semibold">
            OWNER
          </span>
        </div>

        {/* Nav */}
        <nav className="px-3 space-y-1 mt-2 text-sm flex-1">
          {items.map(({ href, label, emoji }) => {
            const active =
              pathname === href ||
              (href !== '/platform' && pathname.startsWith(href));
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm',
                  active
                    ? 'bg-indigo-100 text-indigo-700 font-semibold'
                    : 'text-slate-300 hover:bg-white/5',
                )}
              >
                <span>{emoji}</span>
                {label}
              </Link>
            );
          })}
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
      <main className="flex-1 overflow-auto bg-slate-100">
        {children}
      </main>
    </div>
  );
}
