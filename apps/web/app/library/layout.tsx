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
import { LibraryShell } from '@/app/app/library/shell';
import '../sk-theme.css';

/**
 * THE LIBRARIAN'S DOOR.
 *
 * The library itself is a tab of the admin console now (`/app/library`) — the
 * sidebar stays put and it behaves like Exam Hall next door. This portal
 * exists for the one person who cannot go through that door: a
 * STAFF/LIBRARIAN. `app/app/layout.tsx` is SCHOOL_ADMIN-only and would bounce
 * her, and a sidebar of Students/Staff/Settings would be no use to her if it
 * did not — `lib/role-routes.ts` sends her straight here on login.
 *
 * So she keeps this shell — her own topbar and her own sign-out — and renders
 * the IDENTICAL sections through `LibraryShell`. The book-spine rail this file
 * used to draw is gone; the console's section strip replaced it, which is what
 * makes the two views the same screens in different frames.
 *
 * An admin who lands here (an old bookmark, a typed URL) is sent to
 * `/app/library` instead of being shown a second, near-identical portal. That
 * also retires the lone "Back to admin" link this file grew when the library
 * was a portal an admin could fall into and not climb out of.
 */
export default function LibraryLayout({ children }: { children: ReactNode }) {
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
    // An admin belongs in the console's Library tab, which carries the sidebar.
    // Sending them there rather than rendering this portal is what stops the
    // console vanishing when they click Library.
    if (me.data.role === 'SCHOOL_ADMIN') {
      const section = pathname.startsWith('/library/') ? pathname.slice('/library'.length) : '';
      router.replace(`/app/library${section}`);
      return;
    }
    // Librarian only. Any other session that reaches here (an office bookmark,
    // a student typing the URL) goes to ITS portal — the same rule every
    // portal layout enforces for itself.
    if (!(me.data.role === 'STAFF' && me.data.staffRole === 'LIBRARIAN')) {
      router.replace(homeForRole(me.data.role, me.data.staffRole));
    }
  }, [hydrated, status, audience, me.data, pathname, router]);

  if (!hydrated) return null;

  if (!isSchoolHost(host)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="max-w-md rounded-2xl border border-amber-200 bg-white p-8 text-center shadow-sm">
          <div className="mb-3 text-3xl">📚</div>
          <h1 className="text-lg font-bold text-slate-900">Open the library at your school&rsquo;s address</h1>
          <p className="mt-2 text-sm text-slate-600">
            The library lives on your school&rsquo;s own web address (for example{' '}
            <span className="font-mono text-slate-800">{exampleSchoolHost()}</span>) — not on{' '}
            <span className="font-mono">{host}</span>.
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
    // h-dvh + overflow-hidden makes the shell a fixed viewport (same mechanics
    // as the admin console): the topbar stays put and the sections scroll.
    <div className="skosx sk-shell flex h-dvh flex-col overflow-hidden">
      <header className="sk-topbar shrink-0">
        {/* The shared topbar centres at 68rem for the phone-first portals; the
            library is a desk tool and uses the whole screen. */}
        <div className="sk-topbar-inner" style={{ maxWidth: 'none' }}>
          <SckoolsLogo variant="symbol" size={30} />
          <div className="sk-who">
            <div className="n">The library</div>
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
        <LibraryShell base="/library" subtitle="Circulation, the reading hall and fines.">
          {children}
        </LibraryShell>
      </main>
    </div>
  );
}
