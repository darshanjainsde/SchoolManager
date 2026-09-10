'use client';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { useHydrated } from '@/lib/use-hydrated';
import { useApi } from '@/lib/use-api';
import { useSessionProbe } from '@/lib/use-session-probe';
import { useHost } from '@/components/use-host';
import { isSchoolHost, exampleSchoolHost } from '@/lib/hosts';
import { homeForRole } from '@/lib/role-routes';
import { SckoolsLogo } from '@/components/brand/sckools-logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { SportsShell } from '@/app/app/sports/shell';
import '../sk-theme.css';

/**
 * THE SPORTS TEACHER'S DOOR — the library's door, one wing over.
 *
 * The desk is a tab of the admin console (`/app/sports`). This portal exists
 * for the one login that cannot go through that door: STAFF with the SPORTS
 * job. `app/app/layout.tsx` is SCHOOL_ADMIN-only and would bounce them, so
 * `lib/role-routes.ts` sends them here, where the IDENTICAL sections render
 * inside their own topbar. An admin who lands here is sent to the console tab
 * (section kept); any other role goes to its own portal.
 */
export default function SportsLayout({ children }: { children: ReactNode }) {
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
    queryFn: () => api.get<{ role: string; name: string | null; staffRole: string | null }>('/auth/me'),
  });

  useEffect(() => {
    if (hydrated && (status === 'anon' || (status === 'authed' && audience !== 'school'))) router.replace('/login');
    if (!me.data) return;
    if (me.data.role === 'SCHOOL_ADMIN') {
      const section = pathname.startsWith('/sports/') ? pathname.slice('/sports'.length) : '';
      router.replace(`/app/sports${section}`);
      return;
    }
    if (!(me.data.role === 'STAFF' && me.data.staffRole === 'SPORTS')) {
      router.replace(homeForRole(me.data.role, me.data.staffRole));
    }
  }, [hydrated, status, audience, me.data, pathname, router]);

  if (!hydrated) return null;

  if (!isSchoolHost(host)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="max-w-md rounded-2xl border border-amber-200 bg-white p-8 text-center shadow-sm">
          <div className="mb-3 text-3xl">🏅</div>
          <h1 className="text-lg font-bold text-slate-900">Open the sports desk at your school&rsquo;s address</h1>
          <p className="mt-2 text-sm text-slate-600">
            The desk lives on your school&rsquo;s own web address (for example{' '}
            <span className="font-mono text-slate-800">{exampleSchoolHost()}</span>) — not on <span className="font-mono">{host}</span>.
          </p>
        </div>
      </div>
    );
  }

  if (status !== 'authed' || audience !== 'school') return null;

  async function handleLogout() {
    const rt = useAuthStore.getState().refreshToken;
    await api.post('/auth/logout', rt ? { refreshToken: rt } : {}).catch(() => undefined);
    clear();
    router.replace('/login');
  }

  return (
    <div className="skosx sk-shell flex h-dvh flex-col overflow-hidden">
      <header className="sk-topbar shrink-0">
        <div className="sk-topbar-inner" style={{ maxWidth: 'none' }}>
          <SckoolsLogo variant="symbol" size={30} />
          <div className="sk-who">
            <div className="n">The sports desk</div>
            <div className="s">{me.data?.name ?? host?.split(':')[0] ?? 'Sckools'}</div>
          </div>
          <div style={{ flex: 1 }} />
          <ThemeToggle />
          <button className="sk-signout" onClick={handleLogout}>
            <LogOut className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </header>

      <main className="sk-anim min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 pb-6 pt-4 md:px-6 md:py-6">
        <SportsShell base="/sports" subtitle="Tournaments, the Book of Records and the house table.">
          {children}
        </SportsShell>
      </main>
    </div>
  );
}
