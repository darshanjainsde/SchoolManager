'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useAuthStore } from '@/lib/auth-store';
import { useApi } from '@/lib/use-api';
import { LayoutDashboard, School, UserPlus, LogOut, Settings } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Owner-portal shell. Two responsibilities:
 *   1. Redirect to /platform/login when there is no platform refresh token.
 *   2. Render the sidebar + topbar around every /platform/* page.
 *
 * The "owner-host detection" the plan calls for is a server concern (tenant
 * middleware on the API enforces it), so the client check here is best-effort
 * UX: if someone lands on /platform from a tenant subdomain, the API will 403
 * everything anyway.
 */
export default function PlatformLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const audience = useAuthStore((s) => s.audience);
  const clear = useAuthStore((s) => s.clear);
  const api = useApi({ audience: 'platform', hostHeader: 'owner.localhost' });

  const isLogin = pathname === '/platform/login';

  useEffect(() => {
    if (!isLogin && (!refreshToken || audience !== 'platform')) {
      router.replace('/platform/login');
    }
  }, [isLogin, refreshToken, audience, router]);

  if (isLogin) return <>{children}</>;
  if (!refreshToken) return null;

  const items = [
    { href: '/platform', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/platform/schools', label: 'Schools', icon: School },
    { href: '/platform/onboard', label: 'Onboard', icon: UserPlus },
    { href: '/platform/settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-64 flex-col border-r border-slate-200 bg-white p-4 sm:flex">
        <div className="mb-6 flex items-center gap-2 px-2">
          <div className="h-8 w-8 rounded bg-slate-900 text-center font-bold leading-8 text-white">S</div>
          <div>
            <div className="text-sm font-semibold text-slate-900">SkoolOS</div>
            <div className="text-xs text-slate-500">Owner portal</div>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {items.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || (href !== '/platform' && pathname.startsWith(href));
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-3 rounded px-3 py-2 text-sm',
                  active ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100',
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            );
          })}
        </nav>
        <button
          onClick={async () => {
            const rt = useAuthStore.getState().refreshToken;
            if (rt) {
              await api.post('/platform/auth/logout', { refreshToken: rt }).catch(() => undefined);
            }
            clear();
            router.replace('/platform/login');
          }}
          className="mt-2 flex items-center gap-3 rounded px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
        >
          <LogOut className="h-4 w-4" /> Log out
        </button>
      </aside>
      <main className="flex-1 p-6 sm:p-10">{children}</main>
    </div>
  );
}
