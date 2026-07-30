'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LayoutDashboard, LogOut } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { useHydrated } from '@/lib/use-hydrated';
import { useApi } from '@/lib/use-api';
import { useSessionProbe } from '@/lib/use-session-probe';
import { useHost } from '@/components/use-host';
import { isSchoolHost, exampleSchoolHost } from '@/lib/hosts';
import { homeForRole } from '@/lib/role-routes';
import { SckoolsLogo } from '@/components/brand/sckools-logo';
import { ThemeToggle } from '@/components/theme-toggle';
import '../sk-theme.css';

// Deliberately one entry: this portal is a first cut ("currently minimal" —
// see the Phase 4 Task 3 brief) covering only the caller's own attendance.
// A single-item tab strip still follows the same topbar+tabs shell as
// /portal and /teacher so a future Leave tab (once the staff-leave data
// model exists) slots in without a layout rewrite.
export const NAV_ITEMS = [{ href: '/staff', label: 'Home', icon: LayoutDashboard }];

export default function StaffLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const hydrated = useHydrated();
  const host = useHost();
  const status = useAuthStore((s) => s.status);
  const audience = useAuthStore((s) => s.audience);
  const api = useApi({ audience: 'school', hostHeader: host });
  useSessionProbe(api, 'school', !!host);
  const clear = useAuthStore((s) => s.clear);

  const me = useQuery({
    queryKey: ['me'],
    enabled: status === 'authed' && audience === 'school' && !!host,
    queryFn: () => api.get<{ role: string }>('/auth/me'),
  });

  useEffect(() => {
    if (hydrated && (status === 'anon' || (status === 'authed' && audience !== 'school'))) router.replace('/login');
    // STAFF-only — a TEACHER/SCHOOL_ADMIN/STUDENT session that lands here
    // (direct navigation, a stale bookmark, ...) is sent to ITS OWN portal,
    // never left inside this one.
    if (me.data && me.data.role !== 'STAFF') router.replace(homeForRole(me.data.role));
  }, [hydrated, status, audience, me.data, router]);

  if (!hydrated) return null;

  if (!isSchoolHost(host)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="max-w-md rounded-2xl border border-amber-200 bg-white p-8 text-center shadow-sm">
          <div className="mb-3 text-3xl">🏫</div>
          <h1 className="text-lg font-bold text-slate-900">Open the staff portal at your school&rsquo;s address</h1>
          <p className="mt-2 text-sm text-slate-600">
            The staff portal lives on your school&rsquo;s own web address (for example{' '}
            <span className="font-mono text-slate-800">{exampleSchoolHost()}</span>) — not on{' '}
            <span className="font-mono">{host}</span>.
          </p>
        </div>
      </div>
    );
  }

  if (status !== 'authed' || audience !== 'school') return null;

  const isActive = (href: string) =>
    href === '/staff' ? pathname === '/staff' : pathname === href || pathname.startsWith(href + '/');

  async function handleLogout() {
    const rt = useAuthStore.getState().refreshToken;
    await api.post('/auth/logout', rt ? { refreshToken: rt } : {}).catch(() => undefined);
    clear();
    router.replace('/login');
  }

  return (
    <div className="skosx sk-shell">
      <header className="sk-topbar">
        <div className="sk-topbar-inner">
          <SckoolsLogo variant="symbol" size={30} />
          <div className="sk-who">
            <div className="n">Staff portal</div>
            <div className="s">{host?.split(':')[0] ?? 'Sckools'}</div>
          </div>
          <div style={{ flex: 1 }} />
          <ThemeToggle />
          <button className="sk-signout" onClick={handleLogout}>
            <LogOut className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
        <nav className="sk-tabs" aria-label="Staff portal sections">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className="sk-tab" data-active={isActive(href)}>
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {label}
            </Link>
          ))}
        </nav>
      </header>

      <main className="sk-main">{children}</main>
    </div>
  );
}
