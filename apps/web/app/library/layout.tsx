'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
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
import { MobileNavButton, MobileNavDrawer } from '@/components/MobileNavDrawer';
import { NAV_ITEMS } from './nav-items';
import '../sk-theme.css';

/**
 * The librarian's portal — a TOP-LEVEL segment, sibling to /portal, /teacher
 * and /staff.
 *
 * Not `/app/library`. In the App Router an ancestor layout cannot be escaped,
 * so a counter under `/app` would inherit the admin shell whatever its own
 * layout did: the admin sidebar (Students, Staff, Settings, Website), the
 * admin `['me', host]` query, and the admin layout's own
 * `role !== 'SCHOOL_ADMIN'` redirect. A librarian is a job title, not an
 * administrator.
 *
 * SCHOOL_ADMIN is admitted alongside LIBRARIAN because the API already is:
 * `LibraryDeskController` and `LibraryAdminController` both allow the pair —
 * the admin sets the library up, and stands in when the librarian is away.
 *
 * This redirect is CHROME, not authorization. What protects the data is
 * `SchoolJwtGuard + RolesGuard` on the API; this only avoids showing someone a
 * console that would refuse everything they touched.
 */
export default function LibraryLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
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

  // TEMPORARY DIAGNOSTIC — remove once the bounce is fixed.
  //
  // On staging a LIBRARIAN signs in, the router replaces to /library, and this
  // segment immediately replaces to /login. Every remote instrument lied about
  // why: cross-origin XHRs are not captured by the devtools bridge, and a
  // window.fetch wrapper recorded nothing from a client that demonstrably uses
  // fetch. So the answer has to come from inside the component that decides.
  //
  // Prints the three values the redirect below actually reads.
  useEffect(() => {
    console.log('[lib-gate]', JSON.stringify({
      hydrated,
      status,
      audience,
      host,
      meFetching: me.isFetching,
      meError: me.error ? String((me.error as Error).message) : null,
      meRole: me.data?.role ?? null,
    }));
  }, [hydrated, status, audience, host, me.isFetching, me.error, me.data]);

  useEffect(() => {
    if (hydrated && (status === 'anon' || (status === 'authed' && audience !== 'school'))) router.replace('/login');
    // Depends on `me.data`, the object — not `me.data.role`. A dependency on
    // the string alone does not change across a client-side navigation inside
    // this segment, which is exactly how the admin layout let a bounced
    // non-admin keep clicking around inside it.
    if (me.data && me.data.role !== 'LIBRARIAN' && me.data.role !== 'SCHOOL_ADMIN') {
      router.replace(homeForRole(me.data.role));
    }
  }, [hydrated, status, audience, me.data, router]);

  if (!hydrated) return null;

  if (!isSchoolHost(host)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="max-w-md rounded-2xl border border-amber-200 bg-white p-8 text-center shadow-sm">
          <div className="mb-3 text-3xl">🏫</div>
          <h1 className="text-lg font-bold text-slate-900">Open the library at your school&rsquo;s address</h1>
          <p className="mt-2 text-sm text-slate-600">
            The library counter lives on your school&rsquo;s own web address (for example{' '}
            <span className="font-mono text-slate-800">{exampleSchoolHost()}</span>) — not on{' '}
            <span className="font-mono">{host}</span>.
          </p>
        </div>
      </div>
    );
  }

  if (status !== 'authed' || audience !== 'school') return null;

  const isActive = (href: string) =>
    href === '/library' ? pathname === '/library' : pathname === href || pathname.startsWith(href + '/');

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
            <div className="n">Library</div>
            <div className="s">{host?.split(':')[0] ?? 'Sckools'}</div>
          </div>
          <div style={{ flex: 1 }} />
          <ThemeToggle />
          <button className="sk-signout" onClick={handleLogout}>
            <LogOut className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Sign out</span>
          </button>
          <MobileNavButton
            open={drawerOpen}
            onOpen={() => setDrawerOpen(true)}
            controls="library-mobile-drawer"
          />
        </div>
        <nav className="sk-tabs" aria-label="Library sections">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className="sk-tab" data-active={isActive(href)}>
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {label}
            </Link>
          ))}
        </nav>
      </header>

      <MobileNavDrawer
        id="library-mobile-drawer"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Library"
        host={host}
        sectionLabel="Sections"
        items={NAV_ITEMS}
        isActive={isActive}
        foot={
          <>
            <div style={{ padding: '8px 11px' }}>
              <ThemeToggle />
            </div>
            <button
              className="sk-nav"
              style={{ width: '100%', textAlign: 'left', background: 'none', border: 0, cursor: 'pointer' }}
              onClick={() => {
                setDrawerOpen(false);
                void handleLogout();
              }}
            >
              <LogOut className="ic" aria-hidden="true" /> Sign out
            </button>
          </>
        }
      />

      <main className="sk-main">{children}</main>
    </div>
  );
}
